<?php

declare(strict_types=1);

namespace OCP\Share;

use OCP\Files\Node;

/**
 * Test-only stub reproducing the slice of \OCP\Share\IManager's public
 * signature this app's access resolver depends on (architecture.md § ⑨
 * Access resolver: "getAccessList / IUserMountCache"). Never shipped to
 * production — see glue-app/composer.json "autoload-dev" (OCP\ is not in
 * "autoload"). At runtime inside Nextcloud, the real server-provided
 * interface is used.
 */
interface IManager
{
    /**
     * @return array{users?: array<string, mixed>} keyed by uid; every user a
     *     direct or group share resolves to (Nextcloud expands group → member
     *     uids itself — no rule duplication here).
     */
    public function getAccessList(Node $path, bool $currentAccess = false): array;
}
