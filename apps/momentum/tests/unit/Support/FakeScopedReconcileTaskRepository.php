<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Support;

use DateTimeImmutable;
use OCA\Momentum\Db\ScopedReconcileTaskRepository;
use OCA\Momentum\Db\ScopedReconcileTaskRow;

/**
 * Hand-written in-memory {@see ScopedReconcileTaskRepository}, for testing
 * trigger listeners without a database of any kind.
 */
final class FakeScopedReconcileTaskRepository implements ScopedReconcileTaskRepository
{
    /** @var array<int, array{tenantId: int, scope: string, ownerUid: string, rootFileId: ?int, cursor: ?int, status: string}> */
    private array $rows = [];
    private int $nextId = 1;

    public function enqueue(
        int $tenantId,
        string $scope,
        string $ownerUid,
        ?int $rootFileId,
        DateTimeImmutable $now,
    ): int {
        $id = $this->nextId++;
        $this->rows[$id] = [
            'tenantId' => $tenantId,
            'scope' => $scope,
            'ownerUid' => $ownerUid,
            'rootFileId' => $rootFileId,
            'cursor' => null,
            'status' => 'pending',
        ];

        return $id;
    }

    public function claimNextPending(DateTimeImmutable $now): ?ScopedReconcileTaskRow
    {
        foreach ($this->rows as $id => $row) {
            if ($row['status'] === 'pending') {
                return new ScopedReconcileTaskRow(
                    $id,
                    $row['tenantId'],
                    $row['scope'],
                    $row['ownerUid'],
                    $row['rootFileId'],
                    $row['cursor'],
                );
            }
        }

        return null;
    }

    public function advanceCursor(int $id, int $cursorFileId, DateTimeImmutable $now): void
    {
        $this->rows[$id]['cursor'] = $cursorFileId;
    }

    public function markDone(int $id, DateTimeImmutable $now): void
    {
        $this->rows[$id]['status'] = 'done';
    }

    /**
     * @return list<array{tenantId: int, scope: string, ownerUid: string, rootFileId: ?int, cursor: ?int, status: string}>
     */
    public function all(): array
    {
        return array_values($this->rows);
    }

    public function count(): int
    {
        return count($this->rows);
    }
}
