<?php

declare(strict_types=1);

namespace OCP\Files;

use Exception;

/**
 * Test-only stub reproducing \OCP\Files\NotFoundException. Never shipped to
 * production — see glue-app/composer.json "autoload-dev" (OCP\ is not in
 * "autoload"). At runtime inside Nextcloud, the real server-provided class
 * is used instead.
 */
class NotFoundException extends Exception
{
}
