<?php

declare(strict_types=1);

namespace OCA\Momentum\Listener;

use DateTimeImmutable;
use DateTimeInterface;
use OCA\Momentum\Db\SyncWorkLedgerRepository;
use OCA\Momentum\Exception\AmbiguousTenantMappingException;
use OCA\Momentum\Exception\NoTenantMappingException;
use OCA\Momentum\Service\AccessResolver;
use OCA\Momentum\Service\TenantMapper;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\IUserManager;
use OCP\Share\Events\ShareCreatedEvent;
use OCP\Share\Events\ShareDeletedEvent;
use OCP\Share\IShare;
use Psr\Log\LoggerInterface;

/**
 * The other half of the Access resolver (architecture.md § ⑨): "on create
 * … and on share/mount events, recomputes the file's authoritative
 * visible-uid set … and posts it to `POST /internal/access`." A direct
 * share/unshare resolves exactly the one affected file — bulk visibility
 * changes (group membership, group-folder ACL edits) are the scoped/full
 * reconciliation passes (M6.8/M6.9), not this listener.
 */
final class ShareEventListener implements IEventListener
{
    public function __construct(
        private readonly IUserManager $userManager,
        private readonly TenantMapper $tenantMapper,
        private readonly AccessResolver $accessResolver,
        private readonly SyncWorkLedgerRepository $ledger,
        private readonly ITimeFactory $timeFactory,
        private readonly LoggerInterface $logger,
    ) {
    }

    public function handle(Event $event): void
    {
        if ($event instanceof ShareCreatedEvent) {
            $this->resolve($event->getShare());
            return;
        }

        if ($event instanceof ShareDeletedEvent) {
            $this->resolve($event->getShare());
        }
    }

    private function resolve(IShare $share): void
    {
        $owner = $this->userManager->get($share->getShareOwner());

        if ($owner === null) {
            return;
        }

        try {
            $mapping = $this->tenantMapper->resolve($owner);
        } catch (NoTenantMappingException | AmbiguousTenantMappingException $e) {
            $this->logger->info(
                'Dropping share event: {reason}',
                ['reason' => $e->getMessage()],
            );

            return;
        }

        $node = $share->getNode();
        $uids = $this->accessResolver->resolveUids($node);
        $now = new DateTimeImmutable('@' . $this->timeFactory->getTime());

        $this->ledger->enqueue('access', null, $node->getId(), [
            'tenant_id' => $mapping->tenantId,
            'doc_id' => $node->getId(),
            'uids' => $uids,
            'resolved_at' => $now->format(DateTimeInterface::RFC3339_EXTENDED),
            // Without this, HttpEventDeliveryClient::post() defaults it to ''
            // and builds a hostless URL — confirmed live, 2026-07-28: every
            // row enqueued from here failed forever with Nextcloud's own
            // "Could not detect any host" SSRF guard, since the ledger has no
            // dead-letter tier (RetryBackoff's own docblock: "just keeps
            // retrying"). LedgerFilesystemEventSink's own two enqueue('access', ...)
            // calls already include this; this listener never did.
            'backend_url' => $mapping->backendUrl,
            // Same gap as backend_url above, one layer deeper: without this,
            // HttpEventDeliveryClient::post() mints a token with an empty
            // nc_user_id claim, which EdDSAVerifier.Verify() (backend) rejects
            // outright — "missing nc_user_id claim" — a 401 on every attempt.
            // Confirmed live, 2026-07-28, right after fixing backend_url:
            // delivery started reaching the backend at all, and every one of
            // this listener's rows immediately failed with a 401 instead.
            'nc_user_id' => $owner->getUID(),
        ], $now);
    }
}
