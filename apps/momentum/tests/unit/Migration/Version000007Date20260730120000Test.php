<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Migration;

use Doctrine\DBAL\Schema\Schema;
use OCA\Momentum\Migration\Version000002Date20260717140000;
use OCA\Momentum\Migration\Version000007Date20260730120000;
use OCA\Momentum\Tests\Support\FakeSchemaWrapper;
use OCA\Momentum\Tests\Support\NullOutput;
use PHPUnit\Framework\TestCase;

final class Version000007Date20260730120000Test extends TestCase
{
    private function buildSchemaAfterEarlierMigrations(): Schema
    {
        $schema = new Schema();
        $wrapper = new FakeSchemaWrapper($schema);
        (new Version000002Date20260717140000())->changeSchema(new NullOutput(), fn () => $wrapper, []);

        return $schema;
    }

    public function testAddsTheDeadAtColumnAndItsPhaseScopedIndex(): void
    {
        $schema = $this->buildSchemaAfterEarlierMigrations();

        $result = (new Version000007Date20260730120000())
            ->changeSchema(new NullOutput(), fn () => new FakeSchemaWrapper($schema), []);

        self::assertNotNull($result);
        $table = $result->getTable(Version000002Date20260717140000::TABLE_NAME);

        self::assertTrue($table->hasColumn('dead_at'));
        self::assertFalse($table->getColumn('dead_at')->getNotnull());

        self::assertTrue($table->hasIndex('momentum_ledger_dead_idx'));
        $deadIdx = $table->getIndex('momentum_ledger_dead_idx');
        self::assertSame(['dead_at'], $deadIdx->getColumns());
        self::assertSame("phase = 'dead'", $deadIdx->getOption('where'));
        self::assertLessThanOrEqual(30, strlen($deadIdx->getName()));
    }

    public function testIsIdempotentWhenAlreadyApplied(): void
    {
        $schema = $this->buildSchemaAfterEarlierMigrations();
        $wrapper = new FakeSchemaWrapper($schema);
        (new Version000007Date20260730120000())->changeSchema(new NullOutput(), fn () => $wrapper, []);

        $result = (new Version000007Date20260730120000())
            ->changeSchema(new NullOutput(), fn () => new FakeSchemaWrapper($schema), []);

        self::assertNotNull($result);
        $table = $result->getTable(Version000002Date20260717140000::TABLE_NAME);
        self::assertTrue($table->hasColumn('dead_at'));
        self::assertTrue($table->hasIndex('momentum_ledger_dead_idx'));
    }
}
