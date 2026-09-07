<?php

declare(strict_types=1);

namespace OCA\Momentum\Service\SyncWorkLedger;

/**
 * One entry of `GET /internal/status`'s `items` array (api.md § GET
 * /internal/status): the Doc-Mgr Backend's current label/status for a
 * `doc_id`, as read back by the inbound status-poll pass.
 */
final class StatusItem
{
    public function __construct(
        public readonly int $docId,
        public readonly string $status,
        public readonly ?string $docType,
        public readonly ?string $direction,
        public readonly bool $reviewed,
        /**
         * The tenant this item's poll request was scoped to
         * ({@see HttpStatusPollClient}'s own ledger-payload grouping, not
         * anything the Doc-Mgr Backend's response asserts). {@see
         * FilesMetadataLabelWriter} uses this both to scope the mirrored
         * SystemTag to the tenant's NC customer group (G66 item 2) and to
         * confirm `docId`'s actual Nextcloud owner resolves to this same
         * tenant before writing labels at all (G66 item 3), since `docId` is
         * a Nextcloud-instance-wide fileId, not itself tenant-scoped.
         */
        public readonly int $tenantId,
    ) {
    }

    /**
     * db.md § Two-pass drain/poll: "terminal statuses → synced".
     */
    public function isTerminal(): bool
    {
        return in_array($this->status, ['done', 'needs_ocr', 'failed'], true);
    }
}
