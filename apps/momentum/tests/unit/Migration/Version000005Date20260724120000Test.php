<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Migration;

use Doctrine\DBAL\Schema\Schema;
use OCA\Momentum\Migration\Version000002Date20260717140000;
use OCA\Momentum\Migration\Version000005Date20260724120000;
use OCA\Momentum\Tests\Support\FakeSchemaWrapper;
use OCA\Momentum\Tests\Support\NullOutput;
use PHPUnit\Framework\TestCase;

final class Version000005Date20260724120000Test extends TestCase
{
    public function testAddsTheSentPhasePartialIndex(): void
    {
        $schema = new Schema();
        (new Version000002Date20260717140000())->changeSchema(new NullOutput(), fn () => new FakeSchemaWrapper($schema), []);

        $migration = new Version000005Date20260724120000();
        $wrapper = new FakeSchemaWrapper($schema);

        $result = $migration->changeSchema(new NullOutput(), fn () => $wrapper, []);

        self::assertNotNull($result);
        $table = $result->getTable(Version000005Date20260724120000::TABLE_NAME);

        self::assertTrue($table->hasIndex('momentum_sync_ledger_sent_idx'));
        $sentIdx = $table->getIndex('momentum_sync_ledger_sent_idx');
        self::assertSame(['sent_at'], $sentIdx->getColumns());
        self::assertSame("phase = 'sent'", $sentIdx->getOption('where'));
    }

    public function testIsIdempotentWhenIndexAlreadyExists(): void
    {
        $schema = new Schema();
        (new Version000002Date20260717140000())->changeSchema(new NullOutput(), fn () => new FakeSchemaWrapper($schema), []);
        (new Version000005Date20260724120000())->changeSchema(new NullOutput(), fn () => new FakeSchemaWrapper($schema), []);

        $migration = new Version000005Date20260724120000();
        $wrapper = new FakeSchemaWrapper($schema);

        $result = $migration->changeSchema(new NullOutput(), fn () => $wrapper, []);

        self::assertNotNull($result);
        self::assertTrue($result->getTable(Version000005Date20260724120000::TABLE_NAME)->hasIndex('momentum_sync_ledger_sent_idx'));
    }
}
