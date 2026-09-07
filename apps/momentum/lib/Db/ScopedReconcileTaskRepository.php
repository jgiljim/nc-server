<?php

declare(strict_types=1);

namespace OCA\Momentum\Db;

use DateTimeImmutable;

/**
 * Access to `oc_momentum_scoped_reconcile_tasks` (db.md Access-projection
 * maintenance — scoped scope; operations.md Access Reconciliation, G12).
 * One row represents one bulk-reconcile task — a group-membership change or
 * group-folder ACL edit enqueues exactly one row here, however many files
 * are affected, and {@see \OCA\Momentum\Service\ScopedReconciliationPass}
 * walks it in paced batches across ticks. Kept as an interface so the pass
 * can be unit-tested against a hand-written in-memory fake rather than a
 * real Nextcloud DB connection — mirroring `SyncWorkLedgerRepository`.
 */
interface ScopedReconcileTaskRepository
{
    /**
     * Writes the single task row for a scoped/bulk visibility change.
     * `$rootFileId` is null when the affected subtree *is* the owner's own
     * home folder (e.g. a group-membership change — resolving that one
     * user's whole tree already recomputes visibility for everyone else via
     * `AccessResolver::resolveUids`'s `getAccessList` expansion); non-null
     * when it's a specific folder/mount subtree (e.g. a group-folder ACL
     * edit).
     */
    public function enqueue(
        int $tenantId,
        string $scope,
        string $ownerUid,
        ?int $rootFileId,
        DateTimeImmutable $now,
    ): int;

    /**
     * The oldest still-pending task, or null if none is due. Single-task
     * claim per call, mirroring one `ITimedJob` tick doing one paced batch.
     */
    public function claimNextPending(DateTimeImmutable $now): ?ScopedReconcileTaskRow;

    /**
     * More files remain past this batch — record the last-processed file
     * id so the next tick resumes instead of re-walking from the start.
     */
    public function advanceCursor(int $id, int $cursorFileId, DateTimeImmutable $now): void;

    /**
     * The walk reached the end of the subtree — nothing left to do.
     */
    public function markDone(int $id, DateTimeImmutable $now): void;
}
