<?php

declare(strict_types=1);

namespace OCA\Viewer\Event;

use OCP\EventDispatcher\Event;

/**
 * Test-only stub reproducing \OCA\Viewer\Event\LoadViewer's public signature
 * (a real NC-server-provided class from the `viewer` app, not OCP — the
 * `viewer` app only loads its script in response to this event, see
 * PageController::index()). Never shipped to production — see
 * glue-app/composer.json "autoload-dev". At runtime inside Nextcloud, the
 * real server-provided class is used.
 */
class LoadViewer extends Event
{
}
