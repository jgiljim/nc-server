<?php

declare(strict_types=1);

namespace OCP\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;

/**
 * Test-only stub reproducing \OCP\Migration\SimpleMigrationStep's public
 * signature (a no-op base class real migrations extend and selectively
 * override). Never shipped to production — see glue-app/composer.json
 * "autoload-dev" (OCP\ is not in "autoload"). At runtime inside Nextcloud,
 * the real server-provided class is used.
 */
abstract class SimpleMigrationStep implements IMigrationStep
{
    public function preSchemaChange(IOutput $output, Closure $schemaClosure, array $options): void
    {
    }

    public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper
    {
        return null;
    }

    public function postSchemaChange(IOutput $output, Closure $schemaClosure, array $options): void
    {
    }
}
