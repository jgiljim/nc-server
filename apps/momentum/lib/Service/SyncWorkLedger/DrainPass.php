<?php

declare(strict_types=1);

namespace OCA\Momentum\Service\SyncWorkLedger;

use DateInterval;
use DateTimeImmutable;
use OCA\Momentum\Db\SyncWorkLedgerRepository;
use OCA\Momentum\Db\SyncWorkLedgerRow;
use Psr\Log\LoggerInterface;

/**
 * Outbound half of the sync-work ledger's two-pass drain/poll (db.md §
 * Nextcloud-DB Glue-App Tables): claims `enqueued` rows past their
 * `next_retry`, POSTs each to the Doc-Mgr Backend, and on a 2xx ack commits
 * `phase = 'sent'` bookkeeping (sent_at/sent_etag) before the follow-up
 * write that either drops the row (`target = 'access'` or
 * `event_type = 'deleted'` — nothing left to sync back) or advances it to
 * `awaiting` the inbound status-poll pass (M7.2). A process that dies
 * between those two writes leaves the row recoverable by
 * {@see StuckSentRecoverySweep} (review.md G30/G34). A non-2xx response
 * reschedules the row with exponential backoff until it exhausts the
 * attempts cap, at which point the row is dead-lettered
 * (`phase = 'dead'`, db.md § Attempts cap and dead-letter tier) with an
 * operator alert instead of retrying forever. Intended to run once per NC
 * `ITimedJob` tick alongside the status-poll pass.
 */
final class DrainPass
{
    /**
     * Rows claimed per pass. PUBLIC as of M102.20 so `DrainJob` can read it as
     * the fallback for the `ledger_drain_limit` app-config key, the same way it
     * already does for `ledger_max_attempts`.
     *
     * This number is the only lever on how long a user's own upload stays
     * invisible to list/search: filter B (`access_projection`) is populated
     * through this ledger, so a document is not returned by list/search/vector
     * until its `access` row drains, and at a 60s tick a burst of N rows takes
     * ceil(N/limit) minutes. Direct fetch by id is unaffected — thin-A is live
     * per-request — which is what makes the asymmetry easy to miss: open the
     * document and it works, search for it and it is not there yet.
     */
    public const DEFAULT_LIMIT = 50;

    /**
     * Delivery attempts a row gets before it is dead-lettered (db.md §
     * Attempts cap and dead-letter tier). Matches the Doc-Mgr Job Queue's
     * documented `job_max_attempts` budget so both queues give up after the
     * same number of tries. `DrainJob` overrides it from the app config key
     * `ledger_max_attempts`; a cap of 0 (or less) disables the tier and
     * restores the original retry-forever behaviour.
     */
    public const DEFAULT_MAX_ATTEMPTS = 10;

    public function __construct(
        private readonly SyncWorkLedgerRepository $repository,
        private readonly EventDeliveryClient $client,
        private readonly LoggerInterface $logger,
    ) {
    }

    public function run(
        DateTimeImmutable $now,
        int $limit = self::DEFAULT_LIMIT,
        int $maxAttempts = self::DEFAULT_MAX_ATTEMPTS,
    ): DrainPassResult {
        $rows = $this->repository->claimDue($now, $limit);

        $delivered = 0;
        $retried = 0;
        $deadLettered = 0;

        foreach ($rows as $row) {
            $outcome = $this->deliver($row, $now, $maxAttempts);

            match ($outcome) {
                self::DELIVERED => $delivered++,
                self::RETRIED => $retried++,
                self::DEAD_LETTERED => $deadLettered++,
            };
        }

        return new DrainPassResult(count($rows), $delivered, $retried, $deadLettered);
    }

    private const DELIVERED = 'delivered';
    private const RETRIED = 'retried';
    private const DEAD_LETTERED = 'dead_lettered';

    /**
     * @return self::DELIVERED|self::RETRIED|self::DEAD_LETTERED
     */
    private function deliver(SyncWorkLedgerRow $row, DateTimeImmutable $now, int $maxAttempts): string
    {
        $path = $row->target === 'access' ? '/internal/access' : '/internal/events';
        $response = $this->client->post($path, $row->payload);

        if (!$response->isSuccess()) {
            $attempts = $row->attempts + 1;

            // The attempts cap (backlog/to_change.md § G62 item 2): a
            // permanently rejected row retried forever holds a slot in every
            // subsequent LIMIT-bounded claim, which is how >50 poison rows
            // could stop new ingest draining altogether. Dead-lettering
            // takes it out of the queue while keeping the payload for the
            // operator. A cap of 0 or less means "no cap" — the pre-G62
            // retry-forever behaviour, kept as the escape hatch.
            if ($maxAttempts > 0 && $attempts >= $maxAttempts) {
                $this->repository->markDeadLettered($row->id, $attempts, $now);

                // The operator alert (pairs with G63's alerting layer, which
                // reads the same event as momentum_sync_ledger_rows{phase="dead"}):
                // this is silent data loss for that document until someone
                // looks, so it is an error, not retry noise.
                $this->logger->error(
                    'Sync-work-ledger row dead-lettered after {attempts} failed delivery attempts: '
                        . 'target={target} event_type={eventType} doc_id={docId} last_status={status}',
                    [
                        'id' => $row->id,
                        'attempts' => $attempts,
                        'target' => $row->target,
                        'eventType' => $row->eventType,
                        'docId' => $row->docId,
                        'status' => $response->statusCode,
                    ],
                );

                return self::DEAD_LETTERED;
            }

            $nextRetry = $now->add(new DateInterval('PT' . RetryBackoff::secondsAfter($attempts) . 'S'));
            $this->repository->scheduleRetry($row->id, $attempts, $nextRetry);

            return self::RETRIED;
        }

        $sentEtag = isset($row->payload['etag']) ? (string) $row->payload['etag'] : null;
        $this->repository->markSent($row->id, $sentEtag, $now);

        if ($row->target === 'access' || $row->eventType === 'deleted') {
            $this->repository->markDeliveredTerminal($row->id);
        } else {
            $this->repository->markDeliveredAwaiting($row->id, $sentEtag, $now);
        }

        return self::DELIVERED;
    }
}
