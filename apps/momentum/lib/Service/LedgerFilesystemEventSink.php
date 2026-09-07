<?php

declare(strict_types=1);

namespace OCA\Momentum\Service;

use DateTimeImmutable;
use DateTimeInterface;
use OCA\Momentum\AppInfo\Application;
use OCA\Momentum\Db\SyncWorkLedgerRepository;
use OCA\Momentum\Exception\AmbiguousTenantMappingException;
use OCA\Momentum\Exception\NoTenantMappingException;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\Node;
use OCP\IConfig;
use OCP\IUserSession;
use Psr\Log\LoggerInterface;

/**
 * The real {@see FilesystemEventSink}, replacing the {@see
 * LoggingFilesystemEventSink} placeholder now that the tenant mapper (M5.4)
 * and sync-work ledger (M5.3) have landed. Writes the `target='events'`
 * ingest row for every allowlisted event and, on `created`, an accompanying
 * `target='access'` row seeded via {@see AccessResolver} — the create-time
 * seeding db.md/architecture.md § ⑨ require so the uploading owner's own
 * document is not invisible from every list/search until an unrelated share
 * event fires (review.md G4/S1).
 */
final class LedgerFilesystemEventSink implements FilesystemEventSink
{
    public function __construct(
        private readonly IUserSession $userSession,
        private readonly TenantMapper $tenantMapper,
        private readonly AccessResolver $accessResolver,
        private readonly SyncWorkLedgerRepository $ledger,
        private readonly ITimeFactory $timeFactory,
        private readonly IConfig $config,
        private readonly LoggerInterface $logger,
    ) {
    }

    public function handle(Node $node, string $eventType): void
    {
        $user = $this->userSession->getUser();

        if ($user === null) {
            // No acting user in this request (e.g. an occ/background-triggered
            // write) — there is no one to resolve a tenant for.
            return;
        }

        try {
            $mapping = $this->tenantMapper->resolve($user);
        } catch (NoTenantMappingException | AmbiguousTenantMappingException $e) {
            $this->logger->info(
                'Dropping filesystem event: {reason}',
                ['reason' => $e->getMessage(), 'fileId' => $node->getId()],
            );

            return;
        }

        $now = new DateTimeImmutable('@' . $this->timeFactory->getTime());
        $ncInstanceId = (int) $this->config->getAppValue(Application::APP_ID, 'nc_instance_id', '0');

        $this->ledger->enqueue('events', $eventType, $node->getId(), [
            'tenant_id' => $mapping->tenantId,
            'nc_instance_id' => $ncInstanceId,
            'doc_id' => $node->getId(),
            'event_type' => $eventType,
            'mime_type' => $node->getMimetype(),
            'path' => $node->getPath(),
            'etag' => $node->getEtag(),
            'mtime' => $node->getMTime(),
            // Sourced from the Node's own owner, not the acting user above —
            // required by the pipeline's Nextcloud-mode file-fetch step
            // (backlog/v1.md M18.0/M18.1), which needs the uid whose
            // getUserFolder() the file actually lives under.
            'owner_uid' => $node->getOwner()?->getUID() ?? '',
            // Drain-time-only fields (changelog.md B2 — the identity token is
            // minted fresh per drain, never here), stripped by the delivery
            // client before the payload above goes out as the wire body.
            'nc_user_id' => $user->getUID(),
            'backend_url' => $mapping->backendUrl,
        ], $now);

        if ($eventType !== 'created') {
            return;
        }

        $uids = $this->accessResolver->resolveUids($node);

        $this->ledger->enqueue('access', null, $node->getId(), [
            'tenant_id' => $mapping->tenantId,
            'doc_id' => $node->getId(),
            'uids' => $uids,
            'resolved_at' => $now->format(DateTimeInterface::RFC3339_EXTENDED),
            'nc_user_id' => $user->getUID(),
            'backend_url' => $mapping->backendUrl,
        ], $now);
    }
}
