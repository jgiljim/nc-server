<?php

declare(strict_types=1);

namespace OCA\Momentum\Service\SyncWorkLedger;

/**
 * Tally of one `DrainPass::run()` invocation, for the ITimedJob's logging.
 * `claimed = delivered + retried + deadLettered`.
 */
final class DrainPassResult
{
    public function __construct(
        public readonly int $claimed,
        public readonly int $delivered,
        public readonly int $retried,
        public readonly int $deadLettered = 0,
    ) {
    }
}
