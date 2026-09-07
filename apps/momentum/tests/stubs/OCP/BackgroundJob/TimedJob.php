<?php

declare(strict_types=1);

namespace OCP\BackgroundJob;

/**
 * Test-only stub reproducing the slice of \OCP\BackgroundJob\TimedJob's
 * public signature this app calls. Never shipped to production — see
 * glue-app/composer.json "autoload-dev" (OCP\ is not in "autoload"). At
 * runtime inside Nextcloud, the real server-provided class is used instead.
 */
abstract class TimedJob extends Job
{
    protected int $interval = 0;

    public function setInterval(int $seconds): void
    {
        $this->interval = $seconds;
    }

    public function getInterval(): int
    {
        return $this->interval;
    }
}
