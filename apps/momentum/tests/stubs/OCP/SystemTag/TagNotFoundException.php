<?php

declare(strict_types=1);

namespace OCP\SystemTag;

use Exception;

/**
 * Dev-only stub of the real Nextcloud `OCP\SystemTag\TagNotFoundException`
 * used by {@see \OCA\Momentum\Service\SyncWorkLedger\FilesMetadataLabelWriter}.
 * Never shipped — see composer.json "autoload-dev".
 */
class TagNotFoundException extends Exception
{
}
