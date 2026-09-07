<?php

declare(strict_types=1);

namespace OCP\AppFramework\Http\Attribute;

use Attribute;

/**
 * Test-only stub reproducing \OCP\AppFramework\Http\Attribute\NoCSRFRequired.
 * Never shipped to production — see glue-app/composer.json "autoload-dev"
 * (OCP\ is not in "autoload"). At runtime inside Nextcloud, the real
 * server-provided attribute (read by the AppFramework dispatcher) is used.
 */
#[Attribute(Attribute::TARGET_METHOD)]
class NoCSRFRequired
{
}
