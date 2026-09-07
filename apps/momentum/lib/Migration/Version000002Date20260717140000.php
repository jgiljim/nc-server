<?php

declare(strict_types=1);

namespace OCA\Momentum\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Sync-work ledger (db.md § Nextcloud-DB Glue-App Tables, oc_momentum_sync_work_ledger):
 * one row tracks a single document lifecycle event across its whole journey —
 * outbound delivery to the Doc-Mgr Backend and, for created/updated events, the
 * inbound status/label sync back into Nextcloud. Written synchronously in the
 * upload transaction by the filesystem-event listener (M5.2); drained by the
 * NC BackgroundJob (M5.3 drain pass, see Service/SyncWorkLedger). Lives in NC
 * DB, not any Doc-Mgr database — the PHP layer holds no Doc-Mgr-DB credentials.
 *
 * The three partial indexes mirror the three access patterns the ledger
 * serves: the outbound drain pass (due `enqueued` rows), the inbound
 * status-poll pass (open `awaiting` rows keyed by doc_id), and the terminal-
 * row sweep backstop (`synced` rows past their retention window).
 *
 * Nextcloud's schema layer applies the configured table prefix (oc_ by
 * default), so the table is declared here without it.
 */
class Version000002Date20260717140000 extends SimpleMigrationStep
{
    public const TABLE_NAME = 'momentum_sync_work_ledger';

    public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper
    {
        /** @var ISchemaWrapper $schema */
        $schema = $schemaClosure();

        if (!$schema->hasTable(self::TABLE_NAME)) {
            $table = $schema->createTable(self::TABLE_NAME);

            $table->addColumn('id', 'bigint', [
                'autoincrement' => true,
                'notnull' => true,
            ]);
            $table->addColumn('target', 'string', [
                'notnull' => true,
                'length' => 16,
            ]);
            $table->addColumn('event_type', 'string', [
                'notnull' => false,
                'length' => 16,
            ]);
            $table->addColumn('doc_id', 'bigint', [
                'notnull' => false,
            ]);
            $table->addColumn('phase', 'string', [
                'notnull' => true,
                'length' => 16,
            ]);
            $table->addColumn('last_status', 'string', [
                'notnull' => false,
                'length' => 16,
            ]);
            $table->addColumn('sent_etag', 'string', [
                'notnull' => false,
                'length' => 64,
            ]);
            $table->addColumn('payload', 'json', [
                'notnull' => true,
            ]);
            $table->addColumn('attempts', 'integer', [
                'notnull' => true,
            ]);
            $table->addColumn('next_retry', 'datetime', [
                'notnull' => false,
            ]);
            $table->addColumn('created_at', 'datetime', [
                'notnull' => true,
            ]);
            $table->addColumn('sent_at', 'datetime', [
                'notnull' => false,
            ]);
            $table->addColumn('synced_at', 'datetime', [
                'notnull' => false,
            ]);

            $table->setPrimaryKey(['id']);

            // Outbound drain pass: rows still to deliver to the Doc-Mgr Backend.
            $table->addIndex(['next_retry'], 'momentum_sync_ledger_enqueued_idx', [], [
                'where' => "phase = 'enqueued'",
            ]);
            // Inbound status-poll pass: delivered document events awaiting a terminal result.
            $table->addIndex(['doc_id'], 'momentum_sync_ledger_awaiting_idx', [], [
                'where' => "phase = 'awaiting'",
            ]);
            // Terminal-row sweep backstop (see db.md cleanup/retention policy).
            $table->addIndex(['synced_at'], 'momentum_sync_ledger_synced_idx', [], [
                'where' => "phase = 'synced'",
            ]);
        }

        return $schema;
    }
}
