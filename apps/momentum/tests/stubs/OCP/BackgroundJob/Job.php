<?php

declare(strict_types=1);

namespace OCP\BackgroundJob;

use OCP\AppFramework\Utility\ITimeFactory;

/**
 * Test-only stub reproducing the slice of \OCP\BackgroundJob\Job's public
 * signature this app calls. Never shipped to production — see
 * glue-app/composer.json "autoload-dev" (OCP\ is not in "autoload"). At
 * runtime inside Nextcloud, the real server-provided class is used instead.
 */
abstract class Job implements IJob
{
    protected mixed $argument = null;

    public function __construct(protected ITimeFactory $time)
    {
    }

    public function execute(IJobList $jobList): void
    {
        $jobList->setLastRun($this);
        $this->run($this->argument);
    }

    public function setArgument(mixed $argument): void
    {
        $this->argument = $argument;
    }

    public function getArgument(): mixed
    {
        return $this->argument;
    }

    abstract protected function run(mixed $argument): void;
}
