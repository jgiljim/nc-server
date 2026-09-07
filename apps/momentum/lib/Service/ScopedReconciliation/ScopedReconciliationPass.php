<?php

declare(strict_types=1);

namespace OCA\Momentum\Service\ScopedReconciliation;

use DateTimeImmutable;
use DateTimeInterface;
use OCA\Momentum\Db\ScopedReconcileTaskRepository;
use OCA\Momentum\Db\ScopedReconcileTaskRow;
use OCA\Momentum\Db\SyncWorkLedgerRepository;
use OCA\Momentum\Service\AccessResolver;
use OCA\Momentum\Service\TenantMapper;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\Files\Node;
use OCP\Files\NotFoundException;
use Psr\Log\LoggerInterface;

/**
 * The "paced batch walk" half of scoped/bulk access reconciliation (M6.8;
 * db.md Access-projection maintenance — scoped scope; operations.md Access
 * Reconciliation, G12). A group-membership change or group-folder ACL edit
 * enqueues exactly **one** {@see ScopedReconcileTaskRepository} row
 * describing the affected subtree; this pass claims one such task per
 * invocation and walks it in a bounded batch of at most `$limit` files
 * (default 1000), posting a per-file `target='access'` row to the sync-work
 * ledger for each — reusing the identical resolved-set-replace path
 * `LedgerFilesystemEventSink`/`ShareEventListener` already drain through, per
 * db.md ("reuses the reconciliation code path"). If the subtree has more
 * files than fit in one batch, the task's cursor advances and it stays
 * `pending` for the next `ITimedJob` tick (M6.9) to continue — this is what
 * bounds a single admin action to one enqueue plus a rate-limited walk,
 * instead of flooding the ledger with thousands of synchronous rows in one
 * shot.
 */
final class ScopedReconciliationPass
{
    private const DEFAULT_LIMIT = 1000;

    public function __construct(
        private readonly ScopedReconcileTaskRepository $tasks,
        private readonly IRootFolder $rootFolder,
        private readonly AccessResolver $accessResolver,
        private readonly SyncWorkLedgerRepository $ledger,
        private readonly TenantMapper $tenantMapper,
        private readonly LoggerInterface $logger,
    ) {
    }

    public function run(DateTimeImmutable $now, int $limit = self::DEFAULT_LIMIT): ScopedReconciliationPassResult
    {
        $task = $this->tasks->claimNextPending($now);

        if ($task === null) {
            return new ScopedReconciliationPassResult(false, 0, false);
        }

        $root = $this->resolveRoot($task);

        if ($root === null) {
            $this->tasks->markDone($task->id, $now);

            return new ScopedReconciliationPassResult(true, 0, true);
        }

        // Looked up once per task, by tenant_id rather than
        // re-deriving it from the owner's current group membership
        // (TenantMapper::resolve()) — see backendUrlForTenant()'s own
        // docblock for why. A tenant deleted while this task was pending
        // has nothing left to notify, so the task is dropped the same way
        // resolveRoot()'s own "owner has no home folder" case is.
        $backendUrl = $this->tenantMapper->backendUrlForTenant($task->tenantId);

        if ($backendUrl === null) {
            $this->logger->info(
                'Dropping scoped-reconcile task: tenant {tenant_id} is no longer registered',
                ['tenant_id' => $task->tenantId],
            );
            $this->tasks->markDone($task->id, $now);

            return new ScopedReconciliationPassResult(true, 0, true);
        }

        $files = $this->collectFiles($root);
        usort($files, static fn (File $a, File $b) => $a->getId() <=> $b->getId());

        $cursor = $task->cursorFileId;
        $pending = $cursor === null
            ? $files
            : array_values(array_filter($files, static fn (File $f) => $f->getId() > $cursor));

        $batch = array_slice($pending, 0, max(0, $limit));

        foreach ($batch as $node) {
            $this->resolveAndEnqueue($task, $node, $backendUrl, $now);
        }

        $done = count($batch) === count($pending);

        if ($done) {
            $this->tasks->markDone($task->id, $now);
        } else {
            $last = $batch[count($batch) - 1];
            $this->tasks->advanceCursor($task->id, $last->getId(), $now);
        }

        return new ScopedReconciliationPassResult(true, count($batch), $done);
    }

    private function resolveRoot(ScopedReconcileTaskRow $task): ?Folder
    {
        try {
            $ownerFolder = $this->rootFolder->getUserFolder($task->ownerUid);
        } catch (NotFoundException $e) {
            $this->logger->info(
                'Dropping scoped-reconcile task: owner has no home folder ({owner})',
                ['owner' => $task->ownerUid, 'exception' => $e],
            );

            return null;
        }

        if ($task->rootFileId === null) {
            return $ownerFolder;
        }

        $root = $ownerFolder->getById($task->rootFileId)[0] ?? null;

        return $root instanceof Folder ? $root : null;
    }

    /**
     * @return list<File>
     */
    private function collectFiles(Folder $folder): array
    {
        $files = [];

        foreach ($folder->getDirectoryListing() as $child) {
            if ($child instanceof Folder) {
                array_push($files, ...$this->collectFiles($child));
            } elseif ($child instanceof File) {
                $files[] = $child;
            }
        }

        return $files;
    }

    private function resolveAndEnqueue(ScopedReconcileTaskRow $task, Node $node, string $backendUrl, DateTimeImmutable $now): void
    {
        $uids = $this->accessResolver->resolveUids($node);

        $this->ledger->enqueue('access', null, $node->getId(), [
            'tenant_id' => $task->tenantId,
            'doc_id' => $node->getId(),
            'uids' => $uids,
            'resolved_at' => $now->format(DateTimeInterface::RFC3339_EXTENDED),
            // Same gap as ShareEventListener had (Phase 26, M26.1/M26.4):
            // without these, HttpEventDeliveryClient builds a hostless URL
            // (rejected by Nextcloud's own SSRF guard) and mints a token
            // with an empty nc_user_id claim (rejected by the backend's
            // EdDSAVerifier) — every row from this pass failed forever.
            // Confirmed live, 2026-07-29: a batch of scoped-reconciliation
            // rows from group-membership changes on the test corpus tenant
            // hit the exact same "Could not detect any host" retry loop.
            'backend_url' => $backendUrl,
            'nc_user_id' => $task->ownerUid,
        ], $now);
    }
}
