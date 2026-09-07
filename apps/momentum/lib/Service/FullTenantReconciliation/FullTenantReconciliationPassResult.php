<?php

declare(strict_types=1);

namespace OCA\Momentum\Service\FullTenantReconciliation;

/**
 * Tally of one `FullTenantReconciliationPass::run()` invocation, for the
 * `ITimedJob`'s logging (M6.9).
 */
final class FullTenantReconciliationPassResult
{
    public function __construct(
        public readonly bool $ran,
        public readonly int $tenantsEnumerated,
        public readonly int $tasksEnqueued,
    ) {
    }
}
