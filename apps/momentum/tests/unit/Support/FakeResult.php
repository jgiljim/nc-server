<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Support;

use OCP\DB\IResult;

/**
 * In-memory {@see IResult}: wraps the row set {@see FakeSyncLedgerDbConnection}
 * computed for one `executeQuery()` call.
 */
final class FakeResult implements IResult
{
    /**
     * @param list<array<string, mixed>> $rows
     */
    public function __construct(private array $rows)
    {
    }

    public function fetch(): array|false
    {
        return array_shift($this->rows) ?? false;
    }

    public function fetchAll(): array
    {
        return $this->rows;
    }

    public function rowCount(): int
    {
        return count($this->rows);
    }

    public function closeCursor(): bool
    {
        return true;
    }
}
