<?php

declare(strict_types=1);

namespace OCP\DB;

/**
 * Test-only stub reproducing the slice of \OCP\DB\IResult's public signature
 * that this app's repositories call. Never shipped to production — see
 * glue-app/composer.json "autoload-dev" (OCP\ is not in "autoload"). At
 * runtime inside Nextcloud, the real server-provided result wrapper is used
 * instead.
 */
interface IResult
{
    /**
     * @return array<string, mixed>|false
     */
    public function fetch(): array|false;

    /**
     * @return list<array<string, mixed>>
     */
    public function fetchAll(): array;

    public function rowCount(): int;

    public function closeCursor(): bool;
}
