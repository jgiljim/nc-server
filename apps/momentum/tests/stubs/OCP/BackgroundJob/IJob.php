<?php

declare(strict_types=1);

namespace OCP\BackgroundJob;

/**
 * Test-only stub reproducing the slice of \OCP\BackgroundJob\IJob's public
 * signature this app calls. Never shipped to production — see
 * glue-app/composer.json "autoload-dev" (OCP\ is not in "autoload"). At
 * runtime inside Nextcloud, the real server-provided class is used instead.
 */
interface IJob
{
    public function execute(IJobList $jobList): void;

    public function setArgument(mixed $argument): void;

    public function getArgument(): mixed;
}
