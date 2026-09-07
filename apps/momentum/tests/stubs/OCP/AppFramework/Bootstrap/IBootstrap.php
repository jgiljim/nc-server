<?php

declare(strict_types=1);

namespace OCP\AppFramework\Bootstrap;

/**
 * Test-only stub reproducing \OCP\AppFramework\Bootstrap\IBootstrap's public
 * signature. Never shipped to production — see glue-app/composer.json
 * "autoload-dev" (OCP\ is not in "autoload").
 */
interface IBootstrap
{
    public function register(IRegistrationContext $context): void;

    public function boot(IBootContext $context): void;
}
