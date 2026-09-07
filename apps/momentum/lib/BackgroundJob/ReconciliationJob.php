<?php

declare(strict_types=1);

namespace OCA\Momentum\BackgroundJob;

use DateTimeImmutable;
use OCA\Momentum\AppInfo\Application;
use OCA\Momentum\Service\FullTenantReconciliation\FullTenantReconciliationPass;
use OCA\Momentum\Service\ScopedReconciliation\ScopedReconciliationPass;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\TimedJob;
use OCP\IConfig;
use Psr\Log\LoggerInterface;

/**
 * The single Nextcloud `ITimedJob` driving both halves of access
 * reconciliation (M6.9; db.md Access-projection maintenance; operations.md
 * Access Reconciliation). Ticks on a short, fixed interval — NC's own
 * `ITimedJob` scheduling only supports one interval per job class, so the
 * daily full-tenant cadence is tracked internally by
 * {@see FullTenantReconciliationPass} (via an app-config timestamp) rather
 * than by the job's own tick rate:
 *
 * - Every tick, {@see FullTenantReconciliationPass::run()} is asked whether
 *   the full-tenant backstop is due; if so, it enqueues one scoped-reconcile
 *   task per group member across every registered tenant and records the
 *   run.
 * - Every tick also drains up to {@see self::MAX_SCOPED_TASKS_PER_TICK}
 *   pending scoped-reconcile tasks via {@see ScopedReconciliationPass::run()}
 *   — the exact same paced batch walk M6.8 built for group/group-folder
 *   triggers, reused here for the full-tenant-enqueued tasks too, so
 *   enumeration cost (however many users a tenant has) is bounded the same
 *   way file-count cost already is.
 */
final class ReconciliationJob extends TimedJob
{
    private const TICK_INTERVAL_SECONDS = 300;
    private const MAX_SCOPED_TASKS_PER_TICK = 10;

    public function __construct(
        ITimeFactory $time,
        private readonly FullTenantReconciliationPass $fullTenantPass,
        private readonly ScopedReconciliationPass $scopedPass,
        private readonly IConfig $config,
        private readonly LoggerInterface $logger,
    ) {
        parent::__construct($time);
        $this->setInterval(self::TICK_INTERVAL_SECONDS);
    }

    protected function run(mixed $argument): void
    {
        $now = new DateTimeImmutable('@' . $this->time->getTime());

        $fullTenantResult = $this->fullTenantPass->run($now, $this->fullTenantReconcileIntervalSeconds());

        if ($fullTenantResult->ran) {
            $this->logger->info(
                'Full-tenant reconciliation backstop ran: {tenants} tenants, {tasks} scoped-reconcile tasks enqueued',
                ['tenants' => $fullTenantResult->tenantsEnumerated, 'tasks' => $fullTenantResult->tasksEnqueued],
            );
        }

        $tasksProcessed = 0;
        $filesResolved = 0;

        while ($tasksProcessed < self::MAX_SCOPED_TASKS_PER_TICK) {
            $passResult = $this->scopedPass->run($now);

            if (!$passResult->claimed) {
                break;
            }

            $tasksProcessed++;
            $filesResolved += $passResult->filesResolved;
        }

        if ($tasksProcessed > 0) {
            $this->logger->info(
                'Scoped-reconciliation paced walk: {tasks} task batches processed, {files} files resolved',
                ['tasks' => $tasksProcessed, 'files' => $filesResolved],
            );
        }
    }

    /**
     * The full-tenant reconciliation backstop cadence (operations.md's
     * "configurable interval"), read from the app config on every tick so an
     * operator can shorten or lengthen it without a redeploy — mirrors how
     * {@see DrainJob} wires `ledger_max_attempts`/`status_poll_interval_ms`
     * (the G49 class of gap).
     */
    private function fullTenantReconcileIntervalSeconds(): int
    {
        return (int) $this->config->getAppValue(
            Application::APP_ID,
            'full_tenant_reconcile_interval_seconds',
            (string) FullTenantReconciliationPass::DEFAULT_INTERVAL_SECONDS,
        );
    }
}
