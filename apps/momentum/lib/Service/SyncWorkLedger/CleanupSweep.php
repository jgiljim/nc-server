<?php

declare(strict_types=1);

namespace OCA\Momentum\Service\SyncWorkLedger;

use DateInterval;
use DateTimeImmutable;
use OCA\Momentum\Db\SyncWorkLedgerRepository;

/**
 * Periodic backstop sweep for the sync-work ledger (db.md § Cleanup /
 * retention, M7.4). Both halves are defensive — the fast paths
 * ({@see \OCA\Momentum\Db\SyncWorkLedgerRepository::markSynced()} and
 * `markDeliveredTerminal()`) already delete a row as soon as its work is
 * done:
 *
 *  1. Deletes any `phase = 'synced'` row whose `synced_at` is older than the
 *     retention window (default 1h, `ledger_retention_ms`) — catches a row
 *     that somehow survived past its own delete-on-set tick.
 *  2. Re-checks `awaiting` rows against `GET /internal/status` and drops any
 *     whose `doc_id` is omitted from the response: the file was deleted
 *     from Nextcloud (or never ingested) before a terminal result was ever
 *     produced, so {@see StatusPollPass} would otherwise poll it forever
 *     (api.md § GET /internal/status: "the poller treats a
 *     persistently-omitted awaiting row as delete-cleanup").
 *
 * `phase = 'dead'` rows are deliberately left alone by both halves: they are
 * the dead-letter store an operator triages by hand (db.md § Attempts cap
 * and dead-letter tier), and a dead-letter store that deletes itself is not
 * one.
 *
 * Intended to run once per NC `ITimedJob` tick, alongside the drain pass
 * (M5.3) and the status-poll pass (M7.2).
 */
final class CleanupSweep
{
    private const DEFAULT_LIMIT = 200;

    /** api.md § GET /internal/status: "Max 200 per call; the poller batches." */
    private const MAX_BATCH = 200;

    public function __construct(
        private readonly SyncWorkLedgerRepository $repository,
        private readonly StatusPollClient $client,
    ) {
    }

    public function run(
        DateTimeImmutable $now,
        int $retentionSeconds,
        int $limit = self::DEFAULT_LIMIT,
    ): CleanupSweepResult {
        $cutoff = $now->sub(new DateInterval('PT' . max(0, $retentionSeconds) . 'S'));
        $syncedDeleted = $this->repository->deleteSyncedOlderThan($cutoff);

        $rows = $this->repository->claimAwaiting($limit);
        if ($rows === []) {
            return new CleanupSweepResult($syncedDeleted, 0, 0);
        }

        $rowsByDocId = [];
        foreach ($rows as $row) {
            $rowsByDocId[$row->docId] = $row;
        }

        $present = [];
        foreach (array_chunk(array_keys($rowsByDocId), self::MAX_BATCH) as $docIdBatch) {
            foreach ($this->client->getStatuses($docIdBatch) as $item) {
                $present[$item->docId] = true;
            }
        }

        $orphaned = 0;
        foreach ($rowsByDocId as $docId => $row) {
            if (!isset($present[$docId])) {
                $this->repository->deleteOrphanedAwaiting($row->id);
                $orphaned++;
            }
        }

        return new CleanupSweepResult($syncedDeleted, count($rows), $orphaned);
    }
}
