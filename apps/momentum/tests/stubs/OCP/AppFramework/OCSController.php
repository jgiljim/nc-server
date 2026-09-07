<?php

declare(strict_types=1);

namespace OCP\AppFramework;

use OCP\IRequest;

/**
 * Test-only stub reproducing \OCP\AppFramework\OCSController's public
 * constructor signature. Never shipped to production — see
 * glue-app/composer.json "autoload-dev" (OCP\ is not in "autoload"). At
 * runtime inside Nextcloud, the real server-provided class (which wires
 * OCS response formatting) is used instead.
 */
abstract class OCSController
{
    public function __construct(
        protected readonly string $appName,
        protected readonly IRequest $request,
    ) {
    }
}
