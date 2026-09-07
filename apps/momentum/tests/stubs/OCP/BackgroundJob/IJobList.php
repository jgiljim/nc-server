<?php

declare(strict_types=1);

namespace OCP\BackgroundJob;

/**
 * Test-only stub reproducing the slice of \OCP\BackgroundJob\IJobList's
 * public signature this app calls. Never shipped to production — see
 * glue-app/composer.json "autoload-dev" (OCP\ is not in "autoload"). At
 * runtime inside Nextcloud, the real server-provided class is used instead.
 */
interface IJobList
{
    public function setLastRun(IJob $job): void;
}
