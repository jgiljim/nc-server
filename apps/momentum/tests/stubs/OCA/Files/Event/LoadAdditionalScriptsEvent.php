<?php

declare(strict_types=1);

namespace OCA\Files\Event;

use OCP\EventDispatcher\Event;

/**
 * Test-only stub reproducing \OCA\Files\Event\LoadAdditionalScriptsEvent's
 * public signature (a real NC-server-provided class, not OCP — fired by the
 * `files` app itself when its page renders). Never shipped to production —
 * see glue-app/composer.json "autoload-dev". At runtime inside Nextcloud,
 * the real server-provided class is used.
 */
class LoadAdditionalScriptsEvent extends Event
{
}
