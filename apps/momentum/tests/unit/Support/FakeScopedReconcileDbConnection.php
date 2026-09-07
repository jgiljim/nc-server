<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Support;

use OCP\DB\IResult;
use OCP\IDBConnection;

/**
 * In-memory stand-in for {@see IDBConnection}, understanding exactly the
 * handful of SQL shapes {@see \OCA\Momentum\Db\DbScopedReconcileTaskRepository}
 * issues against `oc_momentum_scoped_reconcile_tasks` — mirrors
 * `FakeSyncLedgerDbConnection`.
 */
final class FakeScopedReconcileDbConnection implements IDBConnection
{
    /** @var array<int, array<string, mixed>> */
    private array $rows = [];
    private int $nextId = 1;

    public function executeStatement(string $sql, array $params = [], array $types = []): int
    {
        if (str_contains($sql, 'INSERT INTO')) {
            [$tenantId, $scope, $ownerUid, $rootFileId, $status, $createdAt, $updatedAt] = $params;
            $id = $this->nextId++;
            $this->rows[$id] = [
                'id' => $id,
                'tenant_id' => $tenantId,
                'scope' => $scope,
                'owner_uid' => $ownerUid,
                'root_file_id' => $rootFileId,
                'cursor_file_id' => null,
                'status' => $status,
                'created_at' => $createdAt,
                'updated_at' => $updatedAt,
            ];

            return 1;
        }

        if (str_contains($sql, 'SET cursor_file_id = ?, updated_at = ? WHERE id = ?')) {
            [$cursorFileId, $updatedAt, $id] = $params;
            if (!isset($this->rows[$id])) {
                return 0;
            }
            $this->rows[$id]['cursor_file_id'] = $cursorFileId;
            $this->rows[$id]['updated_at'] = $updatedAt;

            return 1;
        }

        if (str_contains($sql, "SET status = 'done', updated_at = ? WHERE id = ?")) {
            [$updatedAt, $id] = $params;
            if (!isset($this->rows[$id])) {
                return 0;
            }
            $this->rows[$id]['status'] = 'done';
            $this->rows[$id]['updated_at'] = $updatedAt;

            return 1;
        }

        throw new \RuntimeException('FakeScopedReconcileDbConnection: unrecognized statement: ' . $sql);
    }

    public function executeQuery(string $sql, array $params = [], array $types = []): IResult
    {
        if (str_contains($sql, "WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1")) {
            $matches = array_values(array_filter(
                $this->rows,
                fn (array $row) => $row['status'] === 'pending',
            ));

            usort($matches, fn (array $a, array $b) => $a['created_at'] <=> $b['created_at']);
            $matches = array_slice($matches, 0, 1);

            $projected = array_map(
                fn (array $row) => [
                    'id' => $row['id'],
                    'tenant_id' => $row['tenant_id'],
                    'scope' => $row['scope'],
                    'owner_uid' => $row['owner_uid'],
                    'root_file_id' => $row['root_file_id'],
                    'cursor_file_id' => $row['cursor_file_id'],
                ],
                $matches,
            );

            return new FakeResult($projected);
        }

        throw new \RuntimeException('FakeScopedReconcileDbConnection: unrecognized query: ' . $sql);
    }

    public function lastInsertId(?string $table = null): int
    {
        return $this->nextId - 1;
    }

    public function beginTransaction(): bool
    {
        return true;
    }

    public function commit(): bool
    {
        return true;
    }

    public function rollBack(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function row(int $id): ?array
    {
        return $this->rows[$id] ?? null;
    }

    public function count(): int
    {
        return count($this->rows);
    }
}
