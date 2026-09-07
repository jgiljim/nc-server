<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Migration;

use Doctrine\DBAL\Schema\Schema;
use OCA\Momentum\Migration\Version000003Date20260718090000;
use OCA\Momentum\Tests\Support\FakeSchemaWrapper;
use OCA\Momentum\Tests\Support\NullOutput;
use PHPUnit\Framework\TestCase;

final class Version000003Date20260718090000Test extends TestCase
{
    public function testCreatesScopedReconcileTableWithExpectedColumns(): void
    {
        $migration = new Version000003Date20260718090000();
        $wrapper = new FakeSchemaWrapper(new Schema());

        $result = $migration->changeSchema(new NullOutput(), fn () => $wrapper, []);

        self::assertNotNull($result);
        self::assertTrue($result->hasTable(Version000003Date20260718090000::TABLE_NAME));

        $table = $result->getTable(Version000003Date20260718090000::TABLE_NAME);

        $id = $table->getColumn('id');
        self::assertSame('bigint', $id->getType()->getName());
        self::assertTrue($id->getAutoincrement());
        self::assertTrue($id->getNotnull());

        $tenantId = $table->getColumn('tenant_id');
        self::assertSame('bigint', $tenantId->getType()->getName());
        self::assertTrue($tenantId->getNotnull());

        $scope = $table->getColumn('scope');
        self::assertSame('string', $scope->getType()->getName());
        self::assertSame(32, $scope->getLength());
        self::assertTrue($scope->getNotnull());

        $ownerUid = $table->getColumn('owner_uid');
        self::assertSame('string', $ownerUid->getType()->getName());
        self::assertSame(64, $ownerUid->getLength());
        self::assertTrue($ownerUid->getNotnull());

        $rootFileId = $table->getColumn('root_file_id');
        self::assertSame('bigint', $rootFileId->getType()->getName());
        self::assertFalse($rootFileId->getNotnull());

        $cursorFileId = $table->getColumn('cursor_file_id');
        self::assertSame('bigint', $cursorFileId->getType()->getName());
        self::assertFalse($cursorFileId->getNotnull());

        $status = $table->getColumn('status');
        self::assertSame('string', $status->getType()->getName());
        self::assertSame(16, $status->getLength());
        self::assertTrue($status->getNotnull());
        self::assertSame('pending', $status->getDefault());

        $createdAt = $table->getColumn('created_at');
        self::assertSame('datetime', $createdAt->getType()->getName());
        self::assertTrue($createdAt->getNotnull());

        $updatedAt = $table->getColumn('updated_at');
        self::assertSame('datetime', $updatedAt->getType()->getName());
        self::assertTrue($updatedAt->getNotnull());

        self::assertSame(['id'], $table->getPrimaryKey()?->getColumns());

        self::assertTrue($table->hasIndex('momentum_scoped_reconcile_pending_idx'));
        $pendingIdx = $table->getIndex('momentum_scoped_reconcile_pending_idx');
        self::assertSame(['created_at'], $pendingIdx->getColumns());
        self::assertSame("status = 'pending'", $pendingIdx->getOption('where'));
    }

    public function testIsIdempotentWhenTableAlreadyExists(): void
    {
        $migration = new Version000003Date20260718090000();
        $schema = new Schema();
        $schema->createTable(Version000003Date20260718090000::TABLE_NAME);
        $wrapper = new FakeSchemaWrapper($schema);

        $result = $migration->changeSchema(new NullOutput(), fn () => $wrapper, []);

        self::assertNotNull($result);
        self::assertTrue($result->hasTable(Version000003Date20260718090000::TABLE_NAME));
        self::assertCount(0, $result->getTable(Version000003Date20260718090000::TABLE_NAME)->getColumns());
    }
}
