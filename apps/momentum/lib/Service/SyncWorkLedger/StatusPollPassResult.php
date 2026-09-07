<?php

declare(strict_types=1);

namespace OCA\Momentum\Service\SyncWorkLedger;

/**
 * Tally of one `StatusPollPass::run()` invocation, for the ITimedJob's
 * logging.
 */
final class StatusPollPassResult
{
    public function __construct(
        public readonly int $polled,
        public readonly int $updated,
        public readonly int $synced,
        public readonly int $pushed,
    ) {
    }
}
