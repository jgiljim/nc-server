<?php

declare(strict_types=1);

namespace OCP\Files\Config;

/**
 * Test-only stub reproducing the slice of \OCP\Files\Config\IUserMountCache's
 * public signature this app's access resolver depends on
 * (architecture.md § ⑨ Access resolver: "getAccessList / IUserMountCache").
 * Never shipped to production — see glue-app/composer.json "autoload-dev"
 * (OCP\ is not in "autoload"). At runtime inside Nextcloud, the real
 * server-provided interface is used.
 */
interface IUserMountCache
{
    /**
     * @return list<ICachedMountInfo> every mount (home, group folder, etc.)
     *     through which this fileId is reachable — one entry per uid, incl.
     *     the owner's own home mount.
     */
    public function getMountsForFileId(int $fileId): array;
}
