<?php

declare(strict_types=1);

namespace OCP\AppFramework\Bootstrap;

/**
 * Test-only stub reproducing the slice of
 * \OCP\AppFramework\Bootstrap\IRegistrationContext's public signature this
 * app calls. Further registration methods are added here as later
 * milestones need them. Never shipped to production — see
 * glue-app/composer.json "autoload-dev".
 */
interface IRegistrationContext
{
    public function registerEventListener(string $event, string $listener, int $priority = 0): void;

    public function registerServiceAlias(string $alias, string $target): void;

    public function registerMiddleware(string $class, bool $global = false): void;

    /** @param array<string, mixed> $entry */
    public function registerNavigationEntry(array $entry): void;
}
