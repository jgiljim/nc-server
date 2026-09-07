<?php

declare(strict_types=1);

namespace OCA\Momentum\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Adds the fourth phase-scoped partial index to `oc_momentum_sync_work_ledger`
 * (db.md § Nextcloud-DB Glue-App Tables, review.md G34): the outbound drain
 * pass (`enqueued`), the inbound status-poll pass (`awaiting`), and the
 * terminal-row sweep (`synced`) already each had one, but no index covered
 * `phase = 'sent'` — the phase a row can only rest at if the process died
 * between the 2xx delivery ack and the follow-up local write that advances
 * it to `awaiting` or deletes it. `Service/SyncWorkLedger/StuckSentRecoverySweep`
 * (M14.4) is the pass this index backs.
 *
 * Migration files are immutable — this adds an index to the table
 * `Version000002Date20260717140000` created rather than editing it.
 *
 * Nextcloud's schema layer applies the configured table prefix (oc_ by
 * default), so the table is declared here without it.
 */
class Version000005Date20260724120000 extends SimpleMigrationStep
{
    public const TABLE_NAME = 'momentum_sync_work_ledger';

    public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper
    {
        /** @var ISchemaWrapper $schema */
        $schema = $schemaClosure();

        $table = $schema->getTable(self::TABLE_NAME);

        if (!$table->hasIndex('momentum_sync_ledger_sent_idx')) {
            // Stuck-row recovery sweep (G30/G34): a row rests at 'sent' only if the
            // process died between the 2xx ack and the follow-up write that advances
            // or deletes it — delivery is already confirmed by then, so recovery never
            // re-POSTs to the Doc-Mgr Backend. See db.md's sweep description.
            $table->addIndex(['sent_at'], 'momentum_sync_ledger_sent_idx', [], [
                'where' => "phase = 'sent'",
            ]);
        }

        return $schema;
    }
}
