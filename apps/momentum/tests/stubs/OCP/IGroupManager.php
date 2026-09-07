<?php

declare(strict_types=1);

namespace OCP;

use OCP\Group\IGroup;

/**
 * Test-only stub reproducing the slice of \OCP\IGroupManager's public
 * signature this app calls. Never shipped to production — see
 * glue-app/composer.json "autoload-dev" (OCP\ is not in "autoload"). At
 * runtime inside Nextcloud, the real server-provided class is used instead.
 */
interface IGroupManager
{
    /**
     * @return string[] group ids the user belongs to
     */
    public function getUserGroupIds(IUser $user): array;

    /**
     * @return IGroup|null null if the group no longer exists
     */
    public function get(string $gid): ?IGroup;
}
