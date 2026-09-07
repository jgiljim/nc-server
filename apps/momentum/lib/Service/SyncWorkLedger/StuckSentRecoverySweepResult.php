<?php

declare(strict_types=1);

namespace OCA\Momentum\Service\SyncWorkLedger;

/**
 * Tally of one `StuckSentRecoverySweep::run()` invocation, for the
 * ITimedJob's logging.
 */
final class StuckSentRecoverySweepResult
{
    public function __construct(
        public readonly int $claimed,
        public readonly int $advanced,
        public readonly int $deleted,
    ) {
    }
}
