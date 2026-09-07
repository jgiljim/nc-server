<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Support;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\DBAL\Schema\Table;
use OCP\DB\ISchemaWrapper;

/**
 * Real doctrine/dbal Schema underneath — exercises migrations against actual
 * schema-diffing behaviour rather than a hand-rolled mock, without requiring
 * a full Nextcloud server checkout in this repository.
 */
final class FakeSchemaWrapper implements ISchemaWrapper
{
    public function __construct(private Schema $schema)
    {
    }

    public function getTable(string $tableName): Table
    {
        return $this->schema->getTable($tableName);
    }

    public function hasTable(string $tableName): bool
    {
        return $this->schema->hasTable($tableName);
    }

    public function createTable(string $tableName): Table
    {
        return $this->schema->createTable($tableName);
    }

    public function dropTable(string $tableName): void
    {
        $this->schema->dropTable($tableName);
    }

    public function getTables(): array
    {
        return $this->schema->getTables();
    }

    public function getTableNames(): array
    {
        return $this->schema->getTableNames();
    }

    public function unwrap(): Schema
    {
        return $this->schema;
    }
}
