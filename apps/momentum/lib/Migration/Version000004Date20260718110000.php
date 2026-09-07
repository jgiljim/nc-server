<?php

declare(strict_types=1);

namespace OCA\Momentum\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Adds `last_reviewed` to `oc_momentum_sync_work_ledger` (db.md § Two-pass
 * drain/poll; M7.3 notify_push): the status-poll pass (M7.2) only ever
 * compared the polled `status` against `last_status`, so a `reviewed`
 * toggle with no accompanying status change was silently missed. Tracking
 * `last_reviewed` lets the poll pass detect that case too and emit the
 * `momentum_status` NC notify_push on a reviewed toggle, not just a
 * terminal status transition (architecture.md § ⑨ NC notify_push;
 * requirements.md KL-1).
 *
 * Migration files are immutable — this adds a column to the table
 * `Version000002Date20260717140000` created rather than editing it.
 *
 * Nextcloud's schema layer applies the configured table prefix (oc_ by
 * default), so the table is declared here without it.
 */
class Version000004Date20260718110000 extends SimpleMigrationStep
{
    public const TABLE_NAME = 'momentum_sync_work_ledger';

    public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper
    {
        /** @var ISchemaWrapper $schema */
        $schema = $schemaClosure();

        $table = $schema->getTable(self::TABLE_NAME);

        if (!$table->hasColumn('last_reviewed')) {
            $table->addColumn('last_reviewed', 'boolean', [
                'notnull' => false,
            ]);
        }

        return $schema;
    }
}
