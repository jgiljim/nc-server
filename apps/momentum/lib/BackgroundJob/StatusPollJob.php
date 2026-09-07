<?php

declare(strict_types=1);

namespace OCA\Momentum\BackgroundJob;

use OCA\Momentum\Service\SyncWorkLedger\StatusPollPass;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\TimedJob;
use Psr\Log\LoggerInterface;

/**
 * The NC `ITimedJob` driving the inbound half of the sync-work ledger's
 * two-pass drain/poll (db.md § Two-pass drain/poll; M10.8), mirroring
 * {@see ReconciliationJob}'s existing, correctly-registered pattern. Each
 * tick runs {@see StatusPollPass::run()} once, pulling polled document
 * statuses/labels back into Nextcloud.
 */
final class StatusPollJob extends TimedJob
{
    private const TICK_INTERVAL_SECONDS = 300;

    public function __construct(
        ITimeFactory $time,
        private readonly StatusPollPass $statusPollPass,
        private readonly LoggerInterface $logger,
    ) {
        parent::__construct($time);
        $this->setInterval(self::TICK_INTERVAL_SECONDS);
    }

    protected function run(mixed $argument): void
    {
        $result = $this->statusPollPass->run();

        if ($result->polled > 0) {
            $this->logger->info(
                'Status-poll pass: {polled} rows polled, {updated} status updates, {synced} synced terminal, {pushed} notify_push emitted',
                [
                    'polled' => $result->polled,
                    'updated' => $result->updated,
                    'synced' => $result->synced,
                    'pushed' => $result->pushed,
                ],
            );
        }
    }
}
