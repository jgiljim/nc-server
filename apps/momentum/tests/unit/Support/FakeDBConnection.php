<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Support;

use OCP\DB\IResult;
use OCP\IDBConnection;

/**
 * In-memory stand-in for the `oc_momentum_tenants` table content, matching
 * rows by `user_group_id` the same way TenantMapper's `IN (...)` query would.
 */
final class FakeDBConnection implements IDBConnection
{
    /** @var array<int, array{user_group_id: string, tenant_id: int, backend_url: string}> */
    private array $rows;

    /**
     * @param array<int, array{user_group_id: string, tenant_id: int, backend_url: string}> $rows
     */
    public function __construct(array $rows = [])
    {
        $this->rows = $rows;
    }

    public function executeQuery(string $sql, array $params = [], array $types = []): IResult
    {
        if ($params === []) {
            return new FakeResult(array_values($this->rows));
        }

        // TenantMapper::backendUrlForTenant() filters by tenant_id (an int),
        // never by user_group_id (a string) — dispatch on the WHERE clause
        // so both query shapes match against the right column.
        $column = str_contains($sql, 'WHERE tenant_id') ? 'tenant_id' : 'user_group_id';

        $matched = array_values(array_filter(
            $this->rows,
            static fn (array $row): bool => in_array($row[$column], $params, true),
        ));

        return new FakeResult($matched);
    }

    public function executeStatement(string $sql, array $params = [], array $types = []): int
    {
        throw new \RuntimeException('FakeDBConnection: executeStatement() is not used by TenantMapper.');
    }

    public function lastInsertId(?string $table = null): int
    {
        throw new \RuntimeException('FakeDBConnection: lastInsertId() is not used by TenantMapper.');
    }

    public function beginTransaction(): bool
    {
        throw new \RuntimeException('FakeDBConnection: beginTransaction() is not used by TenantMapper.');
    }

    public function commit(): bool
    {
        throw new \RuntimeException('FakeDBConnection: commit() is not used by TenantMapper.');
    }

    public function rollBack(): bool
    {
        throw new \RuntimeException('FakeDBConnection: rollBack() is not used by TenantMapper.');
    }
}
