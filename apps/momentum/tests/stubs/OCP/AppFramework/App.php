<?php

declare(strict_types=1);

namespace OCP\AppFramework;

/**
 * Test-only stub reproducing \OCP\AppFramework\App's public constructor
 * signature. Never shipped to production — see glue-app/composer.json
 * "autoload-dev" (OCP\ is not in "autoload"). At runtime inside Nextcloud,
 * the real server-provided class (which wires the DI container) is used.
 */
abstract class App
{
    public function __construct(private string $appName, array $urlParams = [])
    {
    }

    public function getAppName(): string
    {
        return $this->appName;
    }
}
