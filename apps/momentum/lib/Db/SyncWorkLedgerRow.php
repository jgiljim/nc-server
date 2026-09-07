<?php

declare(strict_types=1);

namespace OCA\Momentum\Db;

/**
 * One claimed row from oc_momentum_sync_work_ledger (db.md § Nextcloud-DB
 * Glue-App Tables), as read back by the outbound drain pass.
 */
final class SyncWorkLedgerRow
{
    /**
     * @param array<string, mixed> $payload
     */
    public function __construct(
        public readonly int $id,
        public readonly string $target,
        public readonly ?string $eventType,
        public readonly ?int $docId,
        public readonly array $payload,
        public readonly int $attempts,
    ) {
    }
}
