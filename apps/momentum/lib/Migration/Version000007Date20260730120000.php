<?php

declare(strict_types=1);

namespace OCA\Momentum\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Adds the dead-letter tier to `oc_momentum_sync_work_ledger` (db.md §
 * Attempts cap and dead-letter tier; backlog/to_change.md § G62 item 2): a
 * `dead_at` stamp plus the phase-scoped partial index the operator's
 * dead-letter queries and the `momentum_sync_ledger_rows{phase="dead"}`
 * metric read.
 *
 * The `phase` column itself needs no change — it is a VARCHAR(16) with no
 * CHECK constraint, so `'dead'` is simply a fifth value it can hold, and
 * every existing query is already phase-filtered (`claimDue()` reads
 * `phase = 'enqueued'`), so a dead row drops out of the drain pass without
 * any predicate change. `dead_at` is nullable: only dead rows carry one,
 * exactly as `sent_at`/`synced_at` are only set in their own phases.
 *
 * Migration files are immutable — this adds a column and an index to the
 * table `Version000002Date20260717140000` created rather than editing it.
 *
 * Nextcloud's schema layer applies the configured table prefix (oc_ by
 * default), so the table is declared here without it.
 */
class Version000007Date20260730120000 extends SimpleMigrationStep
{
    public const TABLE_NAME = 'momentum_sync_work_ledger';

    public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper
    {
        /** @var ISchemaWrapper $schema */
        $schema = $schemaClosure();

        $table = $schema->getTable(self::TABLE_NAME);

        if (!$table->hasColumn('dead_at')) {
            $table->addColumn('dead_at', 'datetime', [
                'notnull' => false,
            ]);
        }

        // Dead-letter inspection: the rows an operator has to look at, and
        // the oldest-first ordering they want them in. Name kept under
        // Nextcloud's 30-character index-name limit (see
        // Version000006Date20260729120000).
        if (!$table->hasIndex('momentum_ledger_dead_idx')) {
            $table->addIndex(['dead_at'], 'momentum_ledger_dead_idx', [], [
                'where' => "phase = 'dead'",
            ]);
        }

        return $schema;
    }
}
