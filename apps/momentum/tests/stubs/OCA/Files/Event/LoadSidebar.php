<?php

declare(strict_types=1);

namespace OCA\Files\Event;

use OCP\EventDispatcher\Event;

/**
 * Test-only stub reproducing \OCA\Files\Event\LoadSidebar's public signature
 * (a real NC-server-provided class, not OCP — the `files` app loads its
 * sidebar bundle, and therefore `window.OCA.Files.Sidebar`, in response to
 * it; see apps/files/lib/Controller/ViewController.php). Never shipped to
 * production — see glue-app/composer.json "autoload-dev".
 */
class LoadSidebar extends Event
{
}
