<?php

declare(strict_types=1);

namespace OCA\Momentum\Service\SyncWorkLedger;

/**
 * Writes a polled {@see StatusItem} to Nextcloud's own label surfaces —
 * FilesMetadata and SystemTags (architecture.md § ⑨ Label sync,
 * frontend.md § Label Access Control) — so classification labels ride
 * Nextcloud's native per-user ACL on generic surfaces (Files browser,
 * WebDAV, Tags) without a separate visibility check. Kept as an interface
 * so `StatusPollPass` can be unit-tested without a real Nextcloud instance.
 */
interface LabelWriter
{
    public function write(StatusItem $item): void;
}
