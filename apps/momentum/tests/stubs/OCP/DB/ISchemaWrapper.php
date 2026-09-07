<?php

declare(strict_types=1);

namespace OCP\DB;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\DBAL\Schema\Table;

/**
 * Test-only stub reproducing the slice of \OCP\DB\ISchemaWrapper's public
 * signature that this app's migrations call. Never shipped to production —
 * see glue-app/composer.json "autoload-dev" (OCP\ is not in "autoload").
 * At runtime inside Nextcloud, the real server-provided wrapper (backed by
 * the same doctrine/dbal Schema this stub wraps) is used instead.
 */
interface ISchemaWrapper
{
    public function getTable(string $tableName): Table;

    public function hasTable(string $tableName): bool;

    public function createTable(string $tableName): Table;

    public function dropTable(string $tableName): void;

    public function getTables(): array;

    public function getTableNames(): array;
}
