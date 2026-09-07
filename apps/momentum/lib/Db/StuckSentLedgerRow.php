<?php

declare(strict_types=1);

namespace OCA\Momentum\Db;

use DateTimeImmutable;

/**
 * One claimed row from oc_momentum_sync_work_ledger (db.md § Nextcloud-DB
 * Glue-App Tables) resting at `phase = 'sent'`, as read back by the
 * stuck-sent-row recovery sweep.
 */
final class StuckSentLedgerRow
{
    public function __construct(
        public readonly int $id,
        public readonly string $target,
        public readonly ?string $eventType,
        public readonly ?string $sentEtag,
        public readonly DateTimeImmutable $sentAt,
    ) {
    }
}
