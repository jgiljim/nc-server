<?php

declare(strict_types=1);

namespace OCA\Momentum\Service\SyncWorkLedger;

use DateTimeImmutable;
use OCA\Momentum\AppInfo\Application;
use OCA\Momentum\Db\SyncWorkLedgerRepository;
use OCA\Momentum\Exception\AmbiguousTenantMappingException;
use OCA\Momentum\Exception\NoTenantMappingException;
use OCA\Momentum\Service\TenantMapper;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\File;
use OCP\Files\IRootFolder;
use OCP\Files\NotFoundException;
use OCP\IConfig;
use OCP\IUser;
use Psr\Log\LoggerInterface;

/**
 * M68.6 (backlog/v1.md; api.md § PATCH /documents/{public_id} "Nextcloud
 * mode"): puts a document's sync-work ledger row back to `awaiting` after a
 * `doc_type` correction or `POST .../reprocess` — both push the document
 * straight back to `pending` on the Doc-Mgr Backend, but its ledger row may
 * already be `phase = 'synced'` (and therefore deleted, db.md § Cleanup/
 * retention) from the document's first, already-completed run through the
 * pipeline. Without this, the status-poll pass never looks at the document
 * again, so NC's `momentum-*` FilesMetadata/SystemTag keep showing the
 * stale label indefinitely (see {@see \OCA\Momentum\Db\SyncWorkLedgerRepository::rearmAwaiting()}).
 *
 * The one piece this needs that the caller (`ApiProxyController`, which only
 * ever sees the document's `public_id`) cannot supply directly is the
 * document's Nextcloud `fileId` — `documents.id` is deliberately never
 * serialized on any read surface (db.md § `documents.id`), by design, to
 * keep a guessable storage-backend identifier out of the public API. This
 * class recovers it the same way {@see \OCA\Momentum\Service\LedgerFilesystemEventSink}
 * always has it in hand: by resolving a real Nextcloud {@see File} node —
 * here, via the document's owner-relative `path` (api.md § GET
 * /documents/{public_id}) under the *acting* user's own home folder.
 *
 * That resolution is necessarily best-effort: `rel_path` is owner-relative,
 * so it only resolves correctly when the acting user is the file's actual
 * owner (the common case this product is built around — see
 * `LedgerFilesystemEventSink`'s own `owner_uid` vs. acting-user distinction).
 * A share recipient correcting a document they don't own, or any other
 * resolution failure, is logged and skipped rather than erroring — the
 * Doc-Mgr Backend's write already succeeded by the time this runs, so
 * failing the request over a label-mirroring side effect would be a strictly
 * worse outcome. This mirrors the fail-open-to-skip posture
 * {@see FilesMetadataLabelWriter} already uses for the same class of
 * "can't resolve the file" condition.
 */
final class LedgerRearmer
{
    public function __construct(
        private readonly TenantMapper $tenantMapper,
        private readonly IRootFolder $rootFolder,
        private readonly SyncWorkLedgerRepository $ledger,
        private readonly ITimeFactory $timeFactory,
        private readonly IConfig $config,
        private readonly LoggerInterface $logger,
    ) {
    }

    public function rearm(IUser $user, string $relPath): void
    {
        try {
            $mapping = $this->tenantMapper->resolve($user);
        } catch (NoTenantMappingException|AmbiguousTenantMappingException $e) {
            $this->logger->info(
                'Momentum: skipping sync-work ledger re-arm for {uid} — {reason}',
                ['uid' => $user->getUID(), 'reason' => $e->getMessage()],
            );

            return;
        }

        try {
            $node = $this->rootFolder->getUserFolder($user->getUID())->get($relPath);
        } catch (NotFoundException $e) {
            $this->logger->info(
                'Momentum: skipping sync-work ledger re-arm — could not resolve {path} under {uid}\'s own folder',
                ['path' => $relPath, 'uid' => $user->getUID(), 'exception' => $e],
            );

            return;
        }

        if (!$node instanceof File) {
            return;
        }

        $now = new DateTimeImmutable('@' . $this->timeFactory->getTime());
        $ncInstanceId = (int) $this->config->getAppValue(Application::APP_ID, 'nc_instance_id', '0');

        $this->ledger->rearmAwaiting($node->getId(), [
            'tenant_id' => $mapping->tenantId,
            'nc_instance_id' => $ncInstanceId,
            'doc_id' => $node->getId(),
            'event_type' => 'updated',
            'mime_type' => $node->getMimetype(),
            'path' => $node->getPath(),
            'etag' => $node->getEtag(),
            'mtime' => $node->getMTime(),
            'owner_uid' => $node->getOwner()?->getUID() ?? '',
            'nc_user_id' => $user->getUID(),
            'backend_url' => $mapping->backendUrl,
        ], $now);
    }
}
