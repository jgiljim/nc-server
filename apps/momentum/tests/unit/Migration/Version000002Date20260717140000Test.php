<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Migration;

use Doctrine\DBAL\Schema\Schema;
use OCA\Momentum\Migration\Version000002Date20260717140000;
use OCA\Momentum\Tests\Support\FakeSchemaWrapper;
use OCA\Momentum\Tests\Support\NullOutput;
use PHPUnit\Framework\TestCase;

final class Version000002Date20260717140000Test extends TestCase
{
    public function testCreatesSyncWorkLedgerTableWithExpectedColumns(): void
    {
        $migration = new Version000002Date20260717140000();
        $wrapper = new FakeSchemaWrapper(new Schema());

        $result = $migration->changeSchema(new NullOutput(), fn () => $wrapper, []);

        self::assertNotNull($result);
        self::assertTrue($result->hasTable(Version000002Date20260717140000::TABLE_NAME));

        $table = $result->getTable(Version000002Date20260717140000::TABLE_NAME);

        $id = $table->getColumn('id');
        self::assertSame('bigint', $id->getType()->getName());
        self::assertTrue($id->getAutoincrement());
        self::assertTrue($id->getNotnull());

        $target = $table->getColumn('target');
        self::assertSame('string', $target->getType()->getName());
        self::assertSame(16, $target->getLength());
        self::assertTrue($target->getNotnull());

        $eventType = $table->getColumn('event_type');
        self::assertSame('string', $eventType->getType()->getName());
        self::assertSame(16, $eventType->getLength());
        self::assertFalse($eventType->getNotnull());

        $docId = $table->getColumn('doc_id');
        self::assertSame('bigint', $docId->getType()->getName());
        self::assertFalse($docId->getNotnull());

        $phase = $table->getColumn('phase');
        self::assertSame('string', $phase->getType()->getName());
        self::assertSame(16, $phase->getLength());
        self::assertTrue($phase->getNotnull());

        $lastStatus = $table->getColumn('last_status');
        self::assertSame('string', $lastStatus->getType()->getName());
        self::assertSame(16, $lastStatus->getLength());
        self::assertFalse($lastStatus->getNotnull());

        $sentEtag = $table->getColumn('sent_etag');
        self::assertSame('string', $sentEtag->getType()->getName());
        self::assertSame(64, $sentEtag->getLength());
        self::assertFalse($sentEtag->getNotnull());

        $payload = $table->getColumn('payload');
        self::assertSame('json', $payload->getType()->getName());
        self::assertTrue($payload->getNotnull());

        $attempts = $table->getColumn('attempts');
        self::assertSame('integer', $attempts->getType()->getName());
        self::assertTrue($attempts->getNotnull());

        $nextRetry = $table->getColumn('next_retry');
        self::assertSame('datetime', $nextRetry->getType()->getName());
        self::assertFalse($nextRetry->getNotnull());

        $createdAt = $table->getColumn('created_at');
        self::assertSame('datetime', $createdAt->getType()->getName());
        self::assertTrue($createdAt->getNotnull());

        $sentAt = $table->getColumn('sent_at');
        self::assertSame('datetime', $sentAt->getType()->getName());
        self::assertFalse($sentAt->getNotnull());

        $syncedAt = $table->getColumn('synced_at');
        self::assertSame('datetime', $syncedAt->getType()->getName());
        self::assertFalse($syncedAt->getNotnull());

        self::assertSame(['id'], $table->getPrimaryKey()?->getColumns());

        self::assertTrue($table->hasIndex('momentum_sync_ledger_enqueued_idx'));
        $enqueuedIdx = $table->getIndex('momentum_sync_ledger_enqueued_idx');
        self::assertSame(['next_retry'], $enqueuedIdx->getColumns());
        self::assertSame("phase = 'enqueued'", $enqueuedIdx->getOption('where'));

        self::assertTrue($table->hasIndex('momentum_sync_ledger_awaiting_idx'));
        $awaitingIdx = $table->getIndex('momentum_sync_ledger_awaiting_idx');
        self::assertSame(['doc_id'], $awaitingIdx->getColumns());
        self::assertSame("phase = 'awaiting'", $awaitingIdx->getOption('where'));

        self::assertTrue($table->hasIndex('momentum_sync_ledger_synced_idx'));
        $syncedIdx = $table->getIndex('momentum_sync_ledger_synced_idx');
        self::assertSame(['synced_at'], $syncedIdx->getColumns());
        self::assertSame("phase = 'synced'", $syncedIdx->getOption('where'));
    }

    public function testIsIdempotentWhenTableAlreadyExists(): void
    {
        $migration = new Version000002Date20260717140000();
        $schema = new Schema();
        $schema->createTable(Version000002Date20260717140000::TABLE_NAME);
        $wrapper = new FakeSchemaWrapper($schema);

        $result = $migration->changeSchema(new NullOutput(), fn () => $wrapper, []);

        self::assertNotNull($result);
        self::assertTrue($result->hasTable(Version000002Date20260717140000::TABLE_NAME));
        self::assertCount(0, $result->getTable(Version000002Date20260717140000::TABLE_NAME)->getColumns());
    }
}
