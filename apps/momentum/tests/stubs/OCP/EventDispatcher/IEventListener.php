<?php

declare(strict_types=1);

namespace OCP\EventDispatcher;

/**
 * Test-only stub reproducing \OCP\EventDispatcher\IEventListener's public
 * signature. Never shipped to production — see glue-app/composer.json
 * "autoload-dev" (OCP\ is not in "autoload"). At runtime inside Nextcloud,
 * the real server-provided interface is used.
 */
interface IEventListener
{
    public function handle(Event $event): void;
}
