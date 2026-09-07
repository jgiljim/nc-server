<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Migration;

use Doctrine\DBAL\Schema\Schema;
use OCA\Momentum\Migration\Version000001Date20260717120000;
use OCA\Momentum\Tests\Support\FakeSchemaWrapper;
use OCA\Momentum\Tests\Support\NullOutput;
use PHPUnit\Framework\TestCase;

final class Version000001Date20260717120000Test extends TestCase
{
    public function testCreatesTenantMappingTableWithExpectedColumns(): void
    {
        $migration = new Version000001Date20260717120000();
        $wrapper = new FakeSchemaWrapper(new Schema());

        $result = $migration->changeSchema(new NullOutput(), fn () => $wrapper, []);

        self::assertNotNull($result);
        self::assertTrue($result->hasTable(Version000001Date20260717120000::TABLE_NAME));

        $table = $result->getTable(Version000001Date20260717120000::TABLE_NAME);

        $id = $table->getColumn('id');
        self::assertSame('bigint', $id->getType()->getName());
        self::assertTrue($id->getAutoincrement());
        self::assertTrue($id->getNotnull());

        $userGroupId = $table->getColumn('user_group_id');
        self::assertSame('string', $userGroupId->getType()->getName());
        self::assertSame(64, $userGroupId->getLength());
        self::assertTrue($userGroupId->getNotnull());

        $tenantId = $table->getColumn('tenant_id');
        self::assertSame('bigint', $tenantId->getType()->getName());
        self::assertTrue($tenantId->getNotnull());

        $backendUrl = $table->getColumn('backend_url');
        self::assertSame('text', $backendUrl->getType()->getName());
        self::assertTrue($backendUrl->getNotnull());

        $createdAt = $table->getColumn('created_at');
        self::assertSame('datetime', $createdAt->getType()->getName());
        self::assertTrue($createdAt->getNotnull());

        self::assertSame(['id'], $table->getPrimaryKey()?->getColumns());
        self::assertTrue($table->hasIndex('momentum_tenants_ugid_uniq'));
        self::assertTrue($table->getIndex('momentum_tenants_ugid_uniq')->isUnique());
        self::assertSame(['user_group_id'], $table->getIndex('momentum_tenants_ugid_uniq')->getColumns());
    }

    public function testIsIdempotentWhenTableAlreadyExists(): void
    {
        $migration = new Version000001Date20260717120000();
        $schema = new Schema();
        $schema->createTable(Version000001Date20260717120000::TABLE_NAME);
        $wrapper = new FakeSchemaWrapper($schema);

        $result = $migration->changeSchema(new NullOutput(), fn () => $wrapper, []);

        self::assertNotNull($result);
        self::assertTrue($result->hasTable(Version000001Date20260717120000::TABLE_NAME));
        self::assertCount(0, $result->getTable(Version000001Date20260717120000::TABLE_NAME)->getColumns());
    }
}
