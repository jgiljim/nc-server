<?php

declare(strict_types=1);

namespace OCP\Files;

/**
 * Test-only stub reproducing the slice of \OCP\Files\File this app's file-
 * serving controller depends on. Never shipped to production — see
 * glue-app/composer.json "autoload-dev" (OCP\ is not in "autoload"). At
 * runtime inside Nextcloud, the real server-provided interface is used.
 */
interface File extends Node
{
    public function getContent(): string;
}
