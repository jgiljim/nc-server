<?php

declare(strict_types=1);

namespace OCP\AppFramework\OCS;

use Exception;

/**
 * Test-only stub reproducing \OCP\AppFramework\OCS\OCSException. Never
 * shipped to production — see glue-app/composer.json "autoload-dev" (OCP\
 * is not in "autoload"). At runtime inside Nextcloud, the real
 * server-provided class (caught by the OCS dispatcher and rendered as an
 * OCS-formatted error response) is used instead.
 */
class OCSException extends Exception
{
}
