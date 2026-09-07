<?php

declare(strict_types=1);

namespace OCP;

use OCP\DB\IResult;

/**
 * Test-only stub reproducing the slice of \OCP\IDBConnection's public
 * signature that this app's repositories call (raw parameterized SQL, no
 * query builder). Never shipped to production — see glue-app/composer.json
 * "autoload-dev" (OCP\ is not in "autoload"). At runtime inside Nextcloud,
 * the real server-provided connection (talking to NC's own configured DB)
 * is used instead.
 */
interface IDBConnection
{
    /**
     * @param array<int|string, mixed> $params
     * @param array<int|string, mixed> $types
     */
    public function executeQuery(string $sql, array $params = [], array $types = []): IResult;

    /**
     * @param array<int|string, mixed> $params
     * @param array<int|string, mixed> $types
     */
    public function executeStatement(string $sql, array $params = [], array $types = []): int;

    public function lastInsertId(?string $table = null): int;

    public function beginTransaction(): bool;

    public function commit(): bool;

    public function rollBack(): bool;
}
