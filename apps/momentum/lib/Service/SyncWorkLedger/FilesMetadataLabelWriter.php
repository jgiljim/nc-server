<?php

declare(strict_types=1);

namespace OCA\Momentum\Service\SyncWorkLedger;

use OCA\Momentum\Exception\AmbiguousTenantMappingException;
use OCA\Momentum\Exception\NoTenantMappingException;
use OCA\Momentum\Service\TenantMapper;
use OCP\Files\IRootFolder;
use OCP\FilesMetadata\IFilesMetadataManager;
use OCP\SystemTag\ISystemTag;
use OCP\SystemTag\ISystemTagManager;
use OCP\SystemTag\ISystemTagObjectMapper;
use OCP\SystemTag\TagNotFoundException;
use Psr\Log\LoggerInterface;

/**
 * The real {@see LabelWriter}: writes a polled {@see StatusItem} to Nextcloud
 * FilesMetadata (the `momentum-*` keys frontend.md's columns table reads —
 * `momentum-type`, `momentum-direction`, `momentum-status`,
 * `momentum-reviewed`) and mirrors the document type as a Nextcloud
 * SystemTag so it also surfaces in the native Tags view (frontend.md § Label
 * Access Control). FilesMetadata rides Nextcloud's own per-user ACL —
 * metadata travels with the file node, delivered only to users who can read
 * it — so no separate visibility check is needed for *who sees* a label once
 * written. SystemTags are instance-global by construction, though (review.md
 * G66 item 2: "global user-visible tags let tenant B infer tenant A's
 * document-type usage" — M12's precedent is "lazy tag creation +
 * `oc_systemtag_group` scoping per customer group"), so the mirrored tag is
 * created restricted (`userVisible = false`) and its allowed-groups list is
 * grown to include the acting tenant's NC customer group — shared across
 * tenants using the same fixed-catalog doc type, but each tenant only sees
 * the types its own group has been added to.
 *
 * Neither ACL says anything about whether a write *should* happen at all,
 * though: `item->docId` is a Nextcloud-instance-wide fileId, not itself
 * tenant-scoped, so a `GET /internal/status` response naming the wrong
 * `doc_id` for its tenant (backend bug or compromise) would otherwise get
 * blindly written to whatever file happens to have that id — possibly one
 * belonging to a different tenant entirely (backlog/to_change.md § G66 item
 * 3). Before writing, this class re-resolves `docId`'s actual Nextcloud
 * owner to a tenant via {@see TenantMapper} and requires it to match
 * `item->tenantId` (the tenant the poll request was actually scoped to,
 * per {@see HttpStatusPollClient}'s own ledger-payload grouping) — a
 * mismatch, a missing owner, or a deleted file all skip the write rather
 * than erroring, mirroring {@see EventDispatcherNotifyPushDispatcher}'s
 * `getById()` fail-open-to-skip posture.
 */
final class FilesMetadataLabelWriter implements LabelWriter
{
    private const OBJECT_TYPE = 'files';

    public function __construct(
        private readonly IFilesMetadataManager $filesMetadataManager,
        private readonly ISystemTagManager $tagManager,
        private readonly ISystemTagObjectMapper $tagObjectMapper,
        private readonly IRootFolder $rootFolder,
        private readonly TenantMapper $tenantMapper,
        private readonly LoggerInterface $logger,
    ) {
    }

    public function write(StatusItem $item): void
    {
        if (!$this->belongsToPollingTenant($item)) {
            return;
        }

        $metadata = $this->filesMetadataManager->getMetadata($item->docId, true);
        $metadata->setString('momentum-status', $item->status);
        $metadata->setBool('momentum-reviewed', $item->reviewed);

        if ($item->docType !== null) {
            $metadata->setString('momentum-type', $item->docType);
        }
        if ($item->direction !== null) {
            $metadata->setString('momentum-direction', $item->direction);
        }

        $this->filesMetadataManager->saveMetadata($metadata);

        if ($item->docType !== null) {
            $this->mirrorTag($item);
        }
    }

    private function mirrorTag(StatusItem $item): void
    {
        $groupId = $this->tenantMapper->groupIdForTenant($item->tenantId);
        if ($groupId === null) {
            $this->logger->warning(
                'Momentum: skipping SystemTag mirror for doc {docId} — tenant {tenantId} has no registered NC customer group.',
                ['app' => 'momentum', 'docId' => $item->docId, 'tenantId' => $item->tenantId],
            );

            return;
        }

        $tag = $this->findOrCreateTag($item->docType);
        $this->scopeTagToTenantGroup($tag, $groupId);
        $this->tagObjectMapper->assignTags((string) $item->docId, self::OBJECT_TYPE, [$tag->getId()]);
    }

    private function belongsToPollingTenant(StatusItem $item): bool
    {
        $node = $this->rootFolder->getById($item->docId)[0] ?? null;

        if ($node === null) {
            $this->logger->info(
                'Momentum label write skipped: doc {docId} no longer exists in Nextcloud.',
                ['docId' => $item->docId],
            );

            return false;
        }

        $owner = $node->getOwner();

        if ($owner === null) {
            $this->logger->warning(
                'Momentum label write skipped: doc {docId} has no resolvable Nextcloud owner.',
                ['docId' => $item->docId],
            );

            return false;
        }

        try {
            $mapping = $this->tenantMapper->resolve($owner);
        } catch (NoTenantMappingException | AmbiguousTenantMappingException $e) {
            $this->logger->warning(
                'Momentum label write skipped: doc {docId} owner tenant resolution failed: {reason}',
                ['docId' => $item->docId, 'reason' => $e->getMessage()],
            );

            return false;
        }

        if ($mapping->tenantId !== $item->tenantId) {
            $this->logger->warning(
                'Momentum label write skipped: doc {docId} belongs to tenant {ownerTenantId}, not the'
                    . ' polling tenant {pollTenantId}.',
                ['docId' => $item->docId, 'ownerTenantId' => $mapping->tenantId, 'pollTenantId' => $item->tenantId],
            );

            return false;
        }

        return true;
    }

    private function findOrCreateTag(string $docType): ISystemTag
    {
        try {
            return $this->tagManager->getTag($docType, false, true);
        } catch (TagNotFoundException) {
            return $this->tagManager->createTag($docType, false, true);
        }
    }

    private function scopeTagToTenantGroup(ISystemTag $tag, string $groupId): void
    {
        $groupIds = $this->tagManager->getTagGroups($tag);
        if (in_array($groupId, $groupIds, true)) {
            return;
        }

        $this->tagManager->setTagGroups($tag, [...$groupIds, $groupId]);
    }
}
