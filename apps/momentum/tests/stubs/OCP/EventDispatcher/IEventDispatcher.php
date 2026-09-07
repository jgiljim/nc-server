<?php

declare(strict_types=1);

namespace OCP\EventDispatcher;

/**
 * Test-only stub reproducing the slice of
 * \OCP\EventDispatcher\IEventDispatcher's public signature this app's
 * notify_push dispatcher (M7.3) depends on — the PHP app owns the
 * `IEventDispatcher` call that feeds NC notify_push (architecture.md § ⑨ NC
 * notify_push). Never shipped to production — see glue-app/composer.json
 * "autoload-dev" (OCP\ is not in "autoload"). At runtime inside Nextcloud,
 * the real server-provided interface is used.
 */
interface IEventDispatcher
{
    public function dispatchTyped(Event $event): void;
}
