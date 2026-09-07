<?php

declare(strict_types=1);

namespace OCP;

/**
 * Test-only stub reproducing \OCP\Util's public signature as used by this
 * app. Never shipped to production — see glue-app/composer.json
 * "autoload-dev" (OCP\ is not in "autoload"). At runtime inside Nextcloud,
 * the real server-provided class is used.
 */
class Util
{
    /**
     * Test-only call recorder — the real method has no return value/side
     * effect a unit test could otherwise observe.
     *
     * @var list<array{0: string, 1: string}>
     */
    public static array $addScriptCalls = [];

    /**
     * Test-only call recorder, same reasoning as $addScriptCalls above.
     *
     * @var list<array{0: string, 1: string}>
     */
    public static array $addStyleCalls = [];

    public static function addScript(string $appName, string $fileName): void
    {
        self::$addScriptCalls[] = [$appName, $fileName];
    }

    /**
     * Test-only call recorder, same reasoning as $addScriptCalls above.
     *
     * @var list<array{0: string, 1: string}>
     */
    public static array $addInitScriptCalls = [];

    public static function addInitScript(string $appName, string $fileName): void
    {
        self::$addInitScriptCalls[] = [$appName, $fileName];
    }

    public static function addStyle(string $appName, string $fileName): void
    {
        self::$addStyleCalls[] = [$appName, $fileName];
    }
}
