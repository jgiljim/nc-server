<?php

declare(strict_types=1);

namespace OCA\Momentum\Db;

/**
 * One row of `oc_momentum_scoped_reconcile_tasks` claimed for a walk
 * (M6.8, see {@see \OCA\Momentum\Service\ScopedReconciliationPass}).
 */
final class ScopedReconcileTaskRow
{
    public function __construct(
        public readonly int $id,
        public readonly int $tenantId,
        public readonly string $scope,
        public readonly string $ownerUid,
        public readonly ?int $rootFileId,
        public readonly ?int $cursorFileId,
    ) {
    }
}
