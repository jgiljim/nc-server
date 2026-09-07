<?php

declare(strict_types=1);

namespace OCP\AppFramework\OCS;

use Throwable;

/**
 * Test-only stub reproducing \OCP\AppFramework\OCS\OCSForbiddenException.
 * Never shipped to production — see glue-app/composer.json "autoload-dev"
 * (OCP\ is not in "autoload"). At runtime inside Nextcloud, the real
 * server-provided class (rendered by the OCS dispatcher as a 403) is used
 * instead.
 */
class OCSForbiddenException extends OCSException
{
    public function __construct(string $message = '', ?Throwable $previous = null)
    {
        parent::__construct($message, 403, $previous);
    }
}
