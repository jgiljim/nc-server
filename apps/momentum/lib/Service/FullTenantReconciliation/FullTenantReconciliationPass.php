<?php

declare(strict_types=1);

namespace OCA\Momentum\Service\FullTenantReconciliation;

use DateTimeImmutable;
use OCA\Momentum\AppInfo\Application;
use OCA\Momentum\Db\ScopedReconcileTaskRepository;
use OCA\Momentum\Service\TenantMapper;
use OCP\IConfig;
use OCP\IGroupManager;
use Psr\Log\LoggerInterface;

/**
 * The "enqueue" half of full-tenant access reconciliation (M6.9; db.md
 * Access-projection maintenance — full-tenant scope; operations.md Access
 * Reconciliation). Unlike the scoped/bulk path (M6.8), there is no
 * triggering ACL event to enumerate an affected file set from — this is the
 * periodic backstop for transitions that fire no signal at all (e.g.
 * time-based share expiry). On its configured interval (default daily) it
 * walks every registered tenant, and for each enqueues one
 * {@see ScopedReconcileTaskRepository} row per group member — reusing the
 * exact same paced-batch-walk fan-out `ScopedReconciliationPass` already
 * drains for scoped tasks, rather than a bespoke full-tenant walk. This
 * bounds the fan-out from a full-tenant recompute the same way M6.8 bounds
 * a single admin action: one enqueue per user, not one synchronous
 * resolution per file.
 */
final class FullTenantReconciliationPass
{
    private const CONFIG_KEY_LAST_RUN = 'full_tenant_reconcile_last_run_at';
    public const DEFAULT_INTERVAL_SECONDS = 86400;

    public function __construct(
        private readonly TenantMapper $tenantMapper,
        private readonly IGroupManager $groupManager,
        private readonly ScopedReconcileTaskRepository $tasks,
        private readonly IConfig $config,
        private readonly LoggerInterface $logger,
    ) {
    }

    public function run(DateTimeImmutable $now, int $intervalSeconds = self::DEFAULT_INTERVAL_SECONDS): FullTenantReconciliationPassResult
    {
        $lastRun = (int) $this->config->getAppValue(Application::APP_ID, self::CONFIG_KEY_LAST_RUN, '0');

        if ($lastRun !== 0 && ($now->getTimestamp() - $lastRun) < $intervalSeconds) {
            return new FullTenantReconciliationPassResult(false, 0, 0);
        }

        $mappings = $this->tenantMapper->listAll();
        $tasksEnqueued = 0;

        foreach ($mappings as $mapping) {
            $group = $this->groupManager->get($mapping->groupId);

            if ($group === null) {
                $this->logger->info(
                    'Skipping full-tenant reconciliation for tenant {tenant}: group {group} no longer exists',
                    ['tenant' => $mapping->tenantId, 'group' => $mapping->groupId],
                );

                continue;
            }

            foreach ($group->getUsers() as $user) {
                $this->tasks->enqueue($mapping->tenantId, 'tenant', $user->getUID(), null, $now);
                $tasksEnqueued++;
            }
        }

        $this->config->setAppValue(Application::APP_ID, self::CONFIG_KEY_LAST_RUN, (string) $now->getTimestamp());

        return new FullTenantReconciliationPassResult(true, count($mappings), $tasksEnqueued);
    }
}
