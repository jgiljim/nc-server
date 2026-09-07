<?php

declare(strict_types=1);

namespace OCA\Momentum\BackgroundJob;

use DateTimeImmutable;
use OCA\Momentum\AppInfo\Application;
use OCA\Momentum\Service\SyncWorkLedger\CleanupSweep;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\TimedJob;
use OCP\IConfig;
use Psr\Log\LoggerInterface;

/**
 * The `ITimedJob` driving the sync-work ledger's cleanup sweep (M7.4/M10.9;
 * db.md § Cleanup / retention). {@see CleanupSweep} has full unit coverage
 * but was never wired to an actual scheduled job — this class is that
 * wiring, mirroring {@see ReconciliationJob}'s registration pattern:
 * constructor-injected, declared in `appinfo/info.xml`'s
 * `<background-jobs>` block, no manual DI in `Application::register()`.
 *
 * Ticks on a fixed interval well inside the retention window
 * (`ledger_retention_ms`, NC `IAppConfig`, default 1h) so a `synced` row
 * never lingers much past its own window, and `awaiting` rows are
 * re-checked against `/internal/status` for delete-cleanup.
 */
final class CleanupSweepJob extends TimedJob
{
    private const TICK_INTERVAL_SECONDS = 900;
    private const DEFAULT_RETENTION_SECONDS = 3600;

    public function __construct(
        ITimeFactory $time,
        private readonly CleanupSweep $cleanupSweep,
        private readonly IConfig $config,
        private readonly LoggerInterface $logger,
    ) {
        parent::__construct($time);
        $this->setInterval(self::TICK_INTERVAL_SECONDS);
    }

    protected function run(mixed $argument): void
    {
        $now = new DateTimeImmutable('@' . $this->time->getTime());

        $result = $this->cleanupSweep->run($now, $this->retentionSeconds());

        if ($result->syncedDeleted > 0 || $result->orphanedDeleted > 0) {
            $this->logger->info(
                'Sync-work ledger cleanup sweep: {syncedDeleted} synced rows deleted, '
                    . '{awaitingChecked} awaiting rows checked, {orphanedDeleted} orphaned rows deleted',
                [
                    'syncedDeleted' => $result->syncedDeleted,
                    'awaitingChecked' => $result->awaitingChecked,
                    'orphanedDeleted' => $result->orphanedDeleted,
                ],
            );
        }
    }

    private function retentionSeconds(): int
    {
        $retentionMs = (int) $this->config->getAppValue(
            Application::APP_ID,
            'ledger_retention_ms',
            (string) (self::DEFAULT_RETENTION_SECONDS * 1000),
        );

        return intdiv(max(0, $retentionMs), 1000);
    }
}
