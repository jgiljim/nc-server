<?php

declare(strict_types=1);

namespace OCP\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;

/**
 * Test-only stub reproducing \OCP\Migration\IMigrationStep's public
 * signature. Never shipped to production — see glue-app/composer.json
 * "autoload-dev" (OCP\ is not in "autoload").
 */
interface IMigrationStep
{
    public function preSchemaChange(IOutput $output, Closure $schemaClosure, array $options): void;

    public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper;

    public function postSchemaChange(IOutput $output, Closure $schemaClosure, array $options): void;
}
