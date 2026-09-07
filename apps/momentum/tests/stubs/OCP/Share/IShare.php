<?php

declare(strict_types=1);

namespace OCP\Share;

use OCP\Files\Node;

/**
 * Test-only stub reproducing the slice of \OCP\Share\IShare's public
 * signature this app's access resolver depends on (architecture.md § ⑨
 * Access resolver). Never shipped to production — see
 * glue-app/composer.json "autoload-dev" (OCP\ is not in "autoload"). At
 * runtime inside Nextcloud, the real server-provided interface is used.
 */
interface IShare
{
    public function getNode(): Node;

    public function getShareOwner(): string;
}
