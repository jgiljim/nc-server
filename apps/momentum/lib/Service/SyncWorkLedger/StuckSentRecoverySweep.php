<?php

declare(strict_types=1);

namespace OCA\Momentum\Service\SyncWorkLedger;

use DateInterval;
use DateTimeImmutable;
use OCA\Momentum\Db\SyncWorkLedgerRepository;

/**
 * Third sweep pass of the sync-work ledger's drain/poll (db.md § Stuck-`sent`-
 * row recovery sweep, review.md G30/G34): a row can only be observed at
 * `phase = 'sent'` if the process died between {@see DrainPass}'s 2xx-ack
 * bookkeeping write and its follow-up write (advance to `awaiting`, or drop
 * for `target = 'access'` / `event_type = 'deleted'`). Delivery is already
 * confirmed by the time `phase = 'sent'` is committed, so this never re-POSTs
 * to the Doc-Mgr Backend — it only finishes that interrupted local write.
 *
 * Gated behind a staleness threshold (`sent_at` older than
 * `status_poll_interval_ms`) so it never races the drain pass's own
 * in-flight advance a moment later. Both outcomes are idempotent no-ops if
 * the original write had, in fact, already landed — {@see
 * SyncWorkLedgerRepository::claimStuckSent()} only ever returns rows still
 * resting at `phase = 'sent'`. Intended to run once per NC `ITimedJob` tick
 * alongside the drain pass.
 */
final class StuckSentRecoverySweep
{
    private const DEFAULT_LIMIT = 200;

    public function __construct(private readonly SyncWorkLedgerRepository $repository)
    {
    }

    public function run(
        DateTimeImmutable $now,
        int $stalenessSeconds,
        int $limit = self::DEFAULT_LIMIT,
    ): StuckSentRecoverySweepResult {
        $cutoff = $now->sub(new DateInterval('PT' . max(0, $stalenessSeconds) . 'S'));
        $rows = $this->repository->claimStuckSent($cutoff, $limit);

        $advanced = 0;
        $deleted = 0;

        foreach ($rows as $row) {
            if ($row->target === 'access' || $row->eventType === 'deleted') {
                $this->repository->markDeliveredTerminal($row->id);
                $deleted++;
            } else {
                $this->repository->markDeliveredAwaiting($row->id, $row->sentEtag, $row->sentAt);
                $advanced++;
            }
        }

        return new StuckSentRecoverySweepResult(count($rows), $advanced, $deleted);
    }
}
