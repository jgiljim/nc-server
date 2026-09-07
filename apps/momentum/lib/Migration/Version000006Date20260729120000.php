<?php

declare(strict_types=1);

namespace OCA\Momentum\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Shortens four partial-index names that exceed Nextcloud's 30-character
 * index-name limit, which made `occ app:enable momentum` fail outright on
 * part of `appinfo/info.xml`'s declared `min-version`/`max-version` range
 * (review.md — index name too long on Nextcloud 30; passed only on 34).
 *
 * Migration files are immutable — this drops and re-adds the affected
 * indexes on the tables `Version000002Date20260717140000` and
 * `Version000003Date20260718090000` created rather than editing them.
 *
 * Nextcloud's schema layer applies the configured table prefix (oc_ by
 * default), so tables are declared here without it.
 */
class Version000006Date20260729120000 extends SimpleMigrationStep
{
    public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper
    {
        /** @var ISchemaWrapper $schema */
        $schema = $schemaClosure();

        $ledgerTable = $schema->getTable(Version000002Date20260717140000::TABLE_NAME);

        if ($ledgerTable->hasIndex('momentum_sync_ledger_enqueued_idx') && !$ledgerTable->hasIndex('momentum_ledger_enqueued_idx')) {
            $ledgerTable->dropIndex('momentum_sync_ledger_enqueued_idx');
            $ledgerTable->addIndex(['next_retry'], 'momentum_ledger_enqueued_idx', [], [
                'where' => "phase = 'enqueued'",
            ]);
        }

        if ($ledgerTable->hasIndex('momentum_sync_ledger_awaiting_idx') && !$ledgerTable->hasIndex('momentum_ledger_awaiting_idx')) {
            $ledgerTable->dropIndex('momentum_sync_ledger_awaiting_idx');
            $ledgerTable->addIndex(['doc_id'], 'momentum_ledger_awaiting_idx', [], [
                'where' => "phase = 'awaiting'",
            ]);
        }

        if ($ledgerTable->hasIndex('momentum_sync_ledger_synced_idx') && !$ledgerTable->hasIndex('momentum_ledger_synced_idx')) {
            $ledgerTable->dropIndex('momentum_sync_ledger_synced_idx');
            $ledgerTable->addIndex(['synced_at'], 'momentum_ledger_synced_idx', [], [
                'where' => "phase = 'synced'",
            ]);
        }

        $reconcileTable = $schema->getTable(Version000003Date20260718090000::TABLE_NAME);

        if ($reconcileTable->hasIndex('momentum_scoped_reconcile_pending_idx') && !$reconcileTable->hasIndex('momentum_scoped_pending_idx')) {
            $reconcileTable->dropIndex('momentum_scoped_reconcile_pending_idx');
            $reconcileTable->addIndex(['created_at'], 'momentum_scoped_pending_idx', [], [
                'where' => "status = 'pending'",
            ]);
        }

        return $schema;
    }
}
