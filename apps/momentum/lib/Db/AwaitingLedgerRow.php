<?php

declare(strict_types=1);

namespace OCA\Momentum\Db;

/**
 * One claimed row from oc_momentum_sync_work_ledger (db.md § Nextcloud-DB
 * Glue-App Tables), as read back by the inbound status-poll pass.
 */
final class AwaitingLedgerRow
{
    public function __construct(
        public readonly int $id,
        public readonly int $docId,
        public readonly ?string $lastStatus,
        public readonly ?bool $lastReviewed = null,
    ) {
    }
}
