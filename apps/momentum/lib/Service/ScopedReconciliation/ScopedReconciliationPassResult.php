<?php

declare(strict_types=1);

namespace OCA\Momentum\Service\ScopedReconciliation;

/**
 * Tally of one `ScopedReconciliationPass::run()` invocation, for the
 * `ITimedJob`'s logging (M6.9).
 */
final class ScopedReconciliationPassResult
{
    public function __construct(
        public readonly bool $claimed,
        public readonly int $filesResolved,
        public readonly bool $taskDone,
    ) {
    }
}
