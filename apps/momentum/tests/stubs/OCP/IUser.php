<?php

declare(strict_types=1);

namespace OCP;

/**
 * Test-only stub reproducing the slice of \OCP\IUser's public signature
 * this app calls. Never shipped to production — see glue-app/composer.json
 * "autoload-dev" (OCP\ is not in "autoload"). At runtime inside Nextcloud,
 * the real server-provided class is used instead.
 */
interface IUser
{
    public function getUID(): string;
}
