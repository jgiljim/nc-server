<?php

declare(strict_types=1);

namespace OCP\EventDispatcher;

/**
 * Test-only stub reproducing \OCP\EventDispatcher\Event's public signature
 * as a marker base class for typed events. Never shipped to production —
 * see glue-app/composer.json "autoload-dev" (OCP\ is not in "autoload").
 * At runtime inside Nextcloud, the real server-provided class is used.
 */
class Event
{
}
