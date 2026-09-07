<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Migration;

use Doctrine\DBAL\Schema\Schema;
use OCA\Momentum\Migration\Version000002Date20260717140000;
use OCA\Momentum\Migration\Version000003Date20260718090000;
use OCA\Momentum\Migration\Version000006Date20260729120000;
use OCA\Momentum\Tests\Support\FakeSchemaWrapper;
use OCA\Momentum\Tests\Support\NullOutput;
use PHPUnit\Framework\TestCase;

final class Version000006Date20260729120000Test extends TestCase
{
    private function buildSchemaAfterEarlierMigrations(): Schema
    {
        $schema = new Schema();
        $wrapper = new FakeSchemaWrapper($schema);
        (new Version000002Date20260717140000())->changeSchema(new NullOutput(), fn () => $wrapper, []);
        (new Version000003Date20260718090000())->changeSchema(new NullOutput(), fn () => $wrapper, []);

        return $schema;
    }

    public function testShortensTheSyncLedgerIndexNamesToFitNextcloudsThirtyCharacterLimit(): void
    {
        $schema = $this->buildSchemaAfterEarlierMigrations();

        $migration = new Version000006Date20260729120000();
        $result = $migration->changeSchema(new NullOutput(), fn () => new FakeSchemaWrapper($schema), []);

        self::assertNotNull($result);
        $ledgerTable = $result->getTable(Version000002Date20260717140000::TABLE_NAME);

        self::assertFalse($ledgerTable->hasIndex('momentum_sync_ledger_enqueued_idx'));
        self::assertFalse($ledgerTable->hasIndex('momentum_sync_ledger_awaiting_idx'));
        self::assertFalse($ledgerTable->hasIndex('momentum_sync_ledger_synced_idx'));

        foreach ($ledgerTable->getIndexes() as $index) {
            self::assertLessThanOrEqual(30, strlen($index->getName()));
        }

        self::assertTrue($ledgerTable->hasIndex('momentum_ledger_enqueued_idx'));
        $enqueuedIdx = $ledgerTable->getIndex('momentum_ledger_enqueued_idx');
        self::assertSame(['next_retry'], $enqueuedIdx->getColumns());
        self::assertSame("phase = 'enqueued'", $enqueuedIdx->getOption('where'));

        self::assertTrue($ledgerTable->hasIndex('momentum_ledger_awaiting_idx'));
        $awaitingIdx = $ledgerTable->getIndex('momentum_ledger_awaiting_idx');
        self::assertSame(['doc_id'], $awaitingIdx->getColumns());
        self::assertSame("phase = 'awaiting'", $awaitingIdx->getOption('where'));

        self::assertTrue($ledgerTable->hasIndex('momentum_ledger_synced_idx'));
        $syncedIdx = $ledgerTable->getIndex('momentum_ledger_synced_idx');
        self::assertSame(['synced_at'], $syncedIdx->getColumns());
        self::assertSame("phase = 'synced'", $syncedIdx->getOption('where'));
    }

    public function testShortensTheScopedReconcileIndexNameToFitNextcloudsThirtyCharacterLimit(): void
    {
        $schema = $this->buildSchemaAfterEarlierMigrations();

        $migration = new Version000006Date20260729120000();
        $result = $migration->changeSchema(new NullOutput(), fn () => new FakeSchemaWrapper($schema), []);

        self::assertNotNull($result);
        $reconcileTable = $result->getTable(Version000003Date20260718090000::TABLE_NAME);

        self::assertFalse($reconcileTable->hasIndex('momentum_scoped_reconcile_pending_idx'));

        foreach ($reconcileTable->getIndexes() as $index) {
            self::assertLessThanOrEqual(30, strlen($index->getName()));
        }

        self::assertTrue($reconcileTable->hasIndex('momentum_scoped_pending_idx'));
        $pendingIdx = $reconcileTable->getIndex('momentum_scoped_pending_idx');
        self::assertSame(['created_at'], $pendingIdx->getColumns());
        self::assertSame("status = 'pending'", $pendingIdx->getOption('where'));
    }

    public function testIsIdempotentWhenTheShortIndexesAlreadyExist(): void
    {
        $schema = $this->buildSchemaAfterEarlierMigrations();
        $wrapper = new FakeSchemaWrapper($schema);
        (new Version000006Date20260729120000())->changeSchema(new NullOutput(), fn () => $wrapper, []);

        $migration = new Version000006Date20260729120000();
        $result = $migration->changeSchema(new NullOutput(), fn () => new FakeSchemaWrapper($schema), []);

        self::assertNotNull($result);
        $ledgerTable = $result->getTable(Version000002Date20260717140000::TABLE_NAME);
        $reconcileTable = $result->getTable(Version000003Date20260718090000::TABLE_NAME);

        self::assertTrue($ledgerTable->hasIndex('momentum_ledger_enqueued_idx'));
        self::assertTrue($ledgerTable->hasIndex('momentum_ledger_awaiting_idx'));
        self::assertTrue($ledgerTable->hasIndex('momentum_ledger_synced_idx'));
        self::assertTrue($reconcileTable->hasIndex('momentum_scoped_pending_idx'));
    }
}
