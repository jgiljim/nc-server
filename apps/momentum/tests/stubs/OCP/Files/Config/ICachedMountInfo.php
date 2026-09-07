<?php

declare(strict_types=1);

namespace OCP\Files\Config;

use OCP\IUser;

/**
 * Test-only stub reproducing the slice of \OCP\Files\Config\ICachedMountInfo's
 * public signature this app's access resolver depends on
 * (architecture.md § ⑨ Access resolver). Never shipped to production — see
 * glue-app/composer.json "autoload-dev" (OCP\ is not in "autoload"). At
 * runtime inside Nextcloud, the real server-provided interface is used.
 */
interface ICachedMountInfo
{
    public function getUser(): IUser;
}
