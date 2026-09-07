<?php

declare(strict_types=1);

namespace OCA\Momentum\Db;

use DateTimeImmutable;
use OCP\IDBConnection;

/**
 * `IDBConnection`-backed implementation of {@see ScopedReconcileTaskRepository}.
 * Raw parameterized SQL rather than a query builder, mirroring
 * `DbSyncWorkLedgerRepository` — the table is simple enough that the
 * builder buys nothing, and `*PREFIX*` is Nextcloud's documented
 * placeholder for the configured table prefix in raw SQL.
 */
final class DbScopedReconcileTaskRepository implements ScopedReconcileTaskRepository
{
    private const TABLE = '*PREFIX*momentum_scoped_reconcile';

    public function __construct(private IDBConnection $db)
    {
    }

    public function enqueue(
        int $tenantId,
        string $scope,
        string $ownerUid,
        ?int $rootFileId,
        DateTimeImmutable $now,
    ): int {
        $this->db->executeStatement(
            'INSERT INTO ' . self::TABLE
                . ' (tenant_id, scope, owner_uid, root_file_id, status, created_at, updated_at)'
                . ' VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                $tenantId,
                $scope,
                $ownerUid,
                $rootFileId,
                'pending',
                $now->format('Y-m-d H:i:s'),
                $now->format('Y-m-d H:i:s'),
            ],
        );

        // See DbSyncWorkLedgerRepository::enqueue()'s comment — lastInsertId()
        // requires the table name (Postgres has no implicit last-insert-id),
        // confirmed via a live install, 2026-07-25.
        return $this->db->lastInsertId(self::TABLE);
    }

    public function claimNextPending(DateTimeImmutable $now): ?ScopedReconcileTaskRow
    {
        $result = $this->db->executeQuery(
            'SELECT id, tenant_id, scope, owner_uid, root_file_id, cursor_file_id FROM ' . self::TABLE
                . " WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1",
        );

        $rows = $result->fetchAll();
        $result->closeCursor();

        if ($rows === []) {
            return null;
        }

        $row = $rows[0];

        return new ScopedReconcileTaskRow(
            (int) $row['id'],
            (int) $row['tenant_id'],
            (string) $row['scope'],
            (string) $row['owner_uid'],
            $row['root_file_id'] !== null ? (int) $row['root_file_id'] : null,
            $row['cursor_file_id'] !== null ? (int) $row['cursor_file_id'] : null,
        );
    }

    public function advanceCursor(int $id, int $cursorFileId, DateTimeImmutable $now): void
    {
        $this->db->executeStatement(
            'UPDATE ' . self::TABLE . ' SET cursor_file_id = ?, updated_at = ? WHERE id = ?',
            [$cursorFileId, $now->format('Y-m-d H:i:s'), $id],
        );
    }

    public function markDone(int $id, DateTimeImmutable $now): void
    {
        $this->db->executeStatement(
            "UPDATE " . self::TABLE . " SET status = 'done', updated_at = ? WHERE id = ?",
            [$now->format('Y-m-d H:i:s'), $id],
        );
    }
}
