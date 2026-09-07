<?php

declare(strict_types=1);

namespace OCP\Group;

use OCP\IUser;

/**
 * Test-only stub reproducing the slice of \OCP\Group\IGroup's public
 * signature this app calls. Never shipped to production — see
 * glue-app/composer.json "autoload-dev" (OCP\ is not in "autoload"). At
 * runtime inside Nextcloud, the real server-provided class is used instead.
 */
interface IGroup
{
    public function getGID(): string;

    /**
     * @return IUser[]
     */
    public function getUsers(): array;
}
