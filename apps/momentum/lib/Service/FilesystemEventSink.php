<?php

declare(strict_types=1);

namespace OCA\Momentum\Service;

use OCP\Files\Node;

/**
 * Downstream hand-off for an allowlisted filesystem event. Resolving the
 * acting tenant and writing the `oc_momentum_sync_work_ledger` row
 * (architecture.md § ⑨) is {@see LedgerFilesystemEventSink}, bound in
 * Application::register().
 */
interface FilesystemEventSink
{
    public function handle(Node $node, string $eventType): void;
}
