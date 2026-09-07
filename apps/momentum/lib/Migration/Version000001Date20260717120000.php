<?php

declare(strict_types=1);

namespace OCA\Momentum\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Tenant mapping table (db.md § Nextcloud-DB Glue-App Tables, oc_momentum_tenants):
 * one row per registered customer group, read on every filesystem event to resolve
 * user -> group -> tenant_id. Rarely written (customer onboarding, admin/ops only).
 * Lives in NC DB, not any Doc-Mgr database — the PHP layer holds no Doc-Mgr-DB
 * credentials.
 *
 * Nextcloud's schema layer applies the configured table prefix (oc_ by default),
 * so the table is declared here without it.
 */
class Version000001Date20260717120000 extends SimpleMigrationStep
{
    public const TABLE_NAME = 'momentum_tenants';

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
            $table->addColumn('user_group_id', 'string', [
                'notnull' => true,
                'length' => 64,
            ]);
            $table->addColumn('tenant_id', 'bigint', [
                'notnull' => true,
            ]);
            $table->addColumn('backend_url', 'text', [
                'notnull' => true,
            ]);
            $table->addColumn('created_at', 'datetime', [
                'notnull' => true,
            ]);

            $table->setPrimaryKey(['id']);
            $table->addUniqueIndex(['user_group_id'], 'momentum_tenants_ugid_uniq');
        }

        return $schema;
    }
}
