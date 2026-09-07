<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Migration;

use Doctrine\DBAL\Schema\Schema;
use OCA\Momentum\Migration\Version000002Date20260717140000;
use OCA\Momentum\Migration\Version000004Date20260718110000;
use OCA\Momentum\Tests\Support\FakeSchemaWrapper;
use OCA\Momentum\Tests\Support\NullOutput;
use PHPUnit\Framework\TestCase;

final class Version000004Date20260718110000Test extends TestCase
{
    public function testAddsLastReviewedColumnToTheLedgerTable(): void
    {
        $schema = new Schema();
        (new Version000002Date20260717140000())->changeSchema(new NullOutput(), fn () => new FakeSchemaWrapper($schema), []);

        $migration = new Version000004Date20260718110000();
        $wrapper = new FakeSchemaWrapper($schema);

        $result = $migration->changeSchema(new NullOutput(), fn () => $wrapper, []);

        self::assertNotNull($result);
        $table = $result->getTable(Version000004Date20260718110000::TABLE_NAME);

        $lastReviewed = $table->getColumn('last_reviewed');
        self::assertSame('boolean', $lastReviewed->getType()->getName());
        self::assertFalse($lastReviewed->getNotnull());
    }

    public function testIsIdempotentWhenColumnAlreadyExists(): void
    {
        $schema = new Schema();
        (new Version000002Date20260717140000())->changeSchema(new NullOutput(), fn () => new FakeSchemaWrapper($schema), []);
        (new Version000004Date20260718110000())->changeSchema(new NullOutput(), fn () => new FakeSchemaWrapper($schema), []);

        $migration = new Version000004Date20260718110000();
        $wrapper = new FakeSchemaWrapper($schema);

        $result = $migration->changeSchema(new NullOutput(), fn () => $wrapper, []);

        self::assertNotNull($result);
        self::assertTrue($result->getTable(Version000004Date20260718110000::TABLE_NAME)->hasColumn('last_reviewed'));
    }
}
