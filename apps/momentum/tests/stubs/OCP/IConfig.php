<?php

declare(strict_types=1);

namespace OCP;

/**
 * Test-only stub reproducing the slice of \OCP\IConfig's public signature
 * this app calls. Never shipped to production — see glue-app/composer.json
 * "autoload-dev" (OCP\ is not in "autoload"). At runtime inside Nextcloud,
 * the real server-provided class is used instead.
 */
interface IConfig
{
    public function getSystemValueString(string $key, string $default = ''): string;

    public function getAppValue(string $appName, string $key, string $default = ''): string;

    public function setAppValue(string $appName, string $key, string $value): void;

    public function getUserValue(string $userId, string $appName, string $key, string $default = ''): string;
}
