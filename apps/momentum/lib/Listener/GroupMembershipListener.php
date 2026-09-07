<?php

declare(strict_types=1);

namespace OCA\Momentum\Listener;

use DateTimeImmutable;
use OCA\Momentum\Db\ScopedReconcileTaskRepository;
use OCA\Momentum\Exception\AmbiguousTenantMappingException;
use OCA\Momentum\Exception\NoTenantMappingException;
use OCA\Momentum\Service\TenantMapper;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Group\Events\UserAddedEvent;
use OCP\Group\Events\UserRemovedEvent;
use OCP\IUser;
use Psr\Log\LoggerInterface;

/**
 * The scoped-reconciliation trigger side for group-membership changes
 * (db.md Access-projection maintenance — scoped scope; operations.md Access
 * Reconciliation, G12). A single admin adding/removing one user from a
 * group can change that user's visibility into an arbitrary number of
 * group-folder-mounted files — instead of resolving each affected file
 * synchronously in the admin's request (flooding the sync-work ledger),
 * this writes **one** {@see ScopedReconcileTaskRepository} row rooted at the
 * affected user's own home folder. Re-resolving every file reachable there
 * via `AccessResolver::resolveUids()` (which expands group access through
 * Nextcloud's own `getAccessList`) recomputes the correct multi-user visible
 * set for every file the membership change touched — walked in paced
 * batches by {@see \OCA\Momentum\Service\ScopedReconciliation\ScopedReconciliationPass}
 * (M6.8/M6.9), not here.
 */
final class GroupMembershipListener implements IEventListener
{
    public function __construct(
        private readonly TenantMapper $tenantMapper,
        private readonly ScopedReconcileTaskRepository $tasks,
        private readonly ITimeFactory $timeFactory,
        private readonly LoggerInterface $logger,
    ) {
    }

    public function handle(Event $event): void
    {
        if ($event instanceof UserAddedEvent) {
            $this->enqueue($event->getUser());
            return;
        }

        if ($event instanceof UserRemovedEvent) {
            $this->enqueue($event->getUser());
        }
    }

    private function enqueue(IUser $user): void
    {
        try {
            $mapping = $this->tenantMapper->resolve($user);
        } catch (NoTenantMappingException | AmbiguousTenantMappingException $e) {
            $this->logger->info(
                'Dropping group-membership event: {reason}',
                ['reason' => $e->getMessage()],
            );

            return;
        }

        $now = new DateTimeImmutable('@' . $this->timeFactory->getTime());

        $this->tasks->enqueue($mapping->tenantId, 'group', $user->getUID(), null, $now);
    }
}
