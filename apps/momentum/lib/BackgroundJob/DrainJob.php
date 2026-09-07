<?php

declare(strict_types=1);

namespace OCA\Momentum\BackgroundJob;

use DateTimeImmutable;
use OCA\Momentum\AppInfo\Application;
use OCA\Momentum\Service\SyncWorkLedger\DrainPass;
use OCA\Momentum\Service\SyncWorkLedger\StuckSentRecoverySweep;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\TimedJob;
use OCP\IConfig;
use Psr\Log\LoggerInterface;

/**
 * The `ITimedJob` driving the outbound half of the sync-work ledger's
 * two-pass drain/poll (M5.3; db.md § Two-pass drain/poll): each tick,
 * {@see DrainPass::run()} claims due `enqueued` rows and delivers them to
 * the Doc-Mgr Backend. Mirrors {@see ReconciliationJob}'s registration
 * pattern (constructor-injected pass class + `info.xml` `<background-jobs>`
 * entry).
 *
 * Also runs the stuck-`sent`-row recovery sweep (M14.4; db.md § Stuck-`sent`-
 * row recovery sweep, review.md G30/G34) on the same tick, gated behind a
 * staleness threshold (`sent_at` older than `status_poll_interval_ms`) so it
 * never races this job's own in-flight advance-on-2xx write a moment later.
 */
final class DrainJob extends TimedJob
{
    /**
     * Strictly shorter than the pinned `* * * * *` (60s) cron period
     * (M177.5) — equal to it, not below it, is what produced M179.2's
     * defect: NC's cron only executes a `TimedJob` on the *first* check that
     * lands at-or-past its interval, so a tick equal to a periodic cron's
     * period is satisfied on every other check, doubling the effective
     * period. The cron is already at the finest granularity a crontab
     * expresses, so the tick — not the cron — is what has to move to make
     * the cron the only floor, matching the `ceil(N / ledger_drain_limit)`
     * *minutes* arithmetic architecture.md § ⑨ already assumes.
     */
    private const TICK_INTERVAL_SECONDS = 30;
    private const DEFAULT_STATUS_POLL_INTERVAL_SECONDS = 300;

    public function __construct(
        ITimeFactory $time,
        private readonly DrainPass $drainPass,
        private readonly StuckSentRecoverySweep $stuckSentRecoverySweep,
        private readonly IConfig $config,
        private readonly LoggerInterface $logger,
    ) {
        parent::__construct($time);
        $this->setInterval(self::TICK_INTERVAL_SECONDS);
    }

    protected function run(mixed $argument): void
    {
        $now = new DateTimeImmutable('@' . $this->time->getTime());

        $result = $this->drainPass->run($now, limit: $this->drainLimit(), maxAttempts: $this->maxAttempts());

        if ($result->claimed > 0) {
            $this->logger->info(
                'Sync-work-ledger drain pass: {claimed} claimed, {delivered} delivered, {retried} retried, '
                    . '{deadLettered} dead-lettered',
                [
                    'claimed' => $result->claimed,
                    'delivered' => $result->delivered,
                    'retried' => $result->retried,
                    'deadLettered' => $result->deadLettered,
                ],
            );
        }

        $recovery = $this->stuckSentRecoverySweep->run($now, $this->statusPollIntervalSeconds());

        if ($recovery->claimed > 0) {
            $this->logger->info(
                'Sync-work-ledger stuck-sent recovery sweep: {claimed} claimed, {advanced} advanced, {deleted} deleted',
                ['claimed' => $recovery->claimed, 'advanced' => $recovery->advanced, 'deleted' => $recovery->deleted],
            );
        }
    }

    /**
     * The dead-letter attempts cap (db.md § Attempts cap and dead-letter
     * tier), read from the app config on every tick so an operator can raise
     * it — or set it to 0 to restore unbounded retry — without a redeploy.
     * Wired here rather than left to `DrainPass`'s default so the documented
     * setting is actually honoured (the G49 class of gap).
     */
    private function maxAttempts(): int
    {
        return (int) $this->config->getAppValue(
            Application::APP_ID,
            'ledger_max_attempts',
            (string) DrainPass::DEFAULT_MAX_ATTEMPTS,
        );
    }

    /**
     * Rows claimed per tick (M102.20), read from the app config on every tick so
     * an operator can raise it without a redeploy — the same treatment
     * `ledger_max_attempts` already gets, and for the same reason: a documented
     * setting nobody honours is the G49 class of gap. Until this was wired, the
     * limit was DrainPass's hardcoded default with no way to change it.
     *
     * It is the only lever on how long a user's own upload stays invisible to
     * list/search. Filter B (`access_projection`) is populated through this
     * ledger, so a document is not returned by list/search/vector until its
     * `access` row drains; at this job's 60s tick a burst of N rows takes
     * ceil(N/limit) minutes. Direct fetch by id is unaffected (thin-A is live
     * per-request). The e2e isolation suite enqueues ~80 rows per run, i.e. two
     * ticks at the default — which is why it forces this job between polls
     * rather than waiting on cron.
     *
     * A configured value of 0 or below is CLAMPED to the default rather than
     * honoured. Unlike `ledger_max_attempts`, where 0 documents "retry forever",
     * there is no useful reading of "drain no rows": it would stall the ledger
     * silently and leave every upload permanently invisible to search.
     */
    private function drainLimit(): int
    {
        $configured = (int) $this->config->getAppValue(
            Application::APP_ID,
            'ledger_drain_limit',
            (string) DrainPass::DEFAULT_LIMIT,
        );

        return $configured > 0 ? $configured : DrainPass::DEFAULT_LIMIT;
    }

    private function statusPollIntervalSeconds(): int
    {
        $intervalMs = (int) $this->config->getAppValue(
            Application::APP_ID,
            'status_poll_interval_ms',
            (string) (self::DEFAULT_STATUS_POLL_INTERVAL_SECONDS * 1000),
        );

        return intdiv(max(0, $intervalMs), 1000);
    }
}
