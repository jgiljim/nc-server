<?php

declare(strict_types=1);

namespace OCA\Momentum\Service\SyncWorkLedger;

/**
 * Tally of one `CleanupSweep::run()` invocation, for the ITimedJob's logging.
 */
final class CleanupSweepResult
{
    public function __construct(
        public readonly int $syncedDeleted,
        public readonly int $awaitingChecked,
        public readonly int $orphanedDeleted,
    ) {
    }
}
