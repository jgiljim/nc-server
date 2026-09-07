<?php

declare(strict_types=1);

namespace OCA\Momentum\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Scoped-reconcile task queue (db.md Access-projection maintenance — scoped
 * scope; operations.md Access Reconciliation, G12): a group-membership change
 * or group-folder ACL edit can alter visibility for thousands of files, but
 * must not flood the sync-work ledger with thousands of synchronous
 * per-file rows. Instead the triggering event writes exactly **one** row
 * here describing the affected subtree; {@see
 * \OCA\Momentum\Service\ScopedReconciliationPass} walks it in paced
 * 1000-file batches across successive `ITimedJob` ticks (M6.9), posting
 * per-file `target='access'` rows to the sync-work ledger as it goes —
 * bounding admin-action cost to one enqueue regardless of file count.
 *
 * Lives in NC DB, not any Doc-Mgr database — the PHP layer holds no Doc-Mgr-DB
 * credentials. Nextcloud's schema layer applies the configured table prefix
 * (oc_ by default), so the table is declared here without it.
 */
class Version000003Date20260718090000 extends SimpleMigrationStep
{
    public const TABLE_NAME = 'momentum_scoped_reconcile';

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
            $table->addColumn('tenant_id', 'bigint', [
                'notnull' => true,
            ]);
            $table->addColumn('scope', 'string', [
                'notnull' => true,
                'length' => 32,
            ]);
            $table->addColumn('owner_uid', 'string', [
                'notnull' => true,
                'length' => 64,
            ]);
            $table->addColumn('root_file_id', 'bigint', [
                'notnull' => false,
            ]);
            $table->addColumn('cursor_file_id', 'bigint', [
                'notnull' => false,
            ]);
            $table->addColumn('status', 'string', [
                'notnull' => true,
                'length' => 16,
                'default' => 'pending',
            ]);
            $table->addColumn('created_at', 'datetime', [
                'notnull' => true,
            ]);
            $table->addColumn('updated_at', 'datetime', [
                'notnull' => true,
            ]);

            $table->setPrimaryKey(['id']);

            // Paced batch walk: which tasks are still owed work, oldest first.
            $table->addIndex(['created_at'], 'momentum_scoped_reconcile_pending_idx', [], [
                'where' => "status = 'pending'",
            ]);
        }

        return $schema;
    }
}
