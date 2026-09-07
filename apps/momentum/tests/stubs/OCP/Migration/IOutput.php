<?php

declare(strict_types=1);

namespace OCP\Migration;

/**
 * Test-only stub reproducing the slice of \OCP\Migration\IOutput's public
 * signature that this app's migrations call. Never shipped to production —
 * see glue-app/composer.json "autoload-dev" (OCP\ is not in "autoload").
 * At runtime inside Nextcloud, the real server-provided interface is used.
 */
interface IOutput
{
    public function info(string $message): void;

    public function warning(string $message): void;

    public function startProgress(int $max = 0): void;

    public function advance(int $step = 1, string $description = ''): void;

    public function finishProgress(): void;
}
