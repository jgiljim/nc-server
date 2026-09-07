<?php

declare(strict_types=1);

namespace OCP\Share\Events;

use OCP\EventDispatcher\Event;
use OCP\Share\IShare;

/**
 * Test-only stub reproducing \OCP\Share\Events\ShareDeletedEvent's public
 * signature (architecture.md § ⑨ Access resolver — "share/mount events").
 * Never shipped to production — see glue-app/composer.json "autoload-dev"
 * (OCP\ is not in "autoload"). At runtime inside Nextcloud, the real
 * server-provided class is used.
 */
class ShareDeletedEvent extends Event
{
    public function __construct(private readonly IShare $share)
    {
    }

    public function getShare(): IShare
    {
        return $this->share;
    }
}
