<?php

declare(strict_types=1);

namespace OCP\Files;

/**
 * Test-only stub reproducing the slice of \OCP\Files\Folder this app's
 * file-serving controller depends on. Never shipped to production — see
 * glue-app/composer.json "autoload-dev" (OCP\ is not in "autoload"). At
 * runtime inside Nextcloud, the real server-provided interface is used.
 */
interface Folder extends Node
{
    /**
     * @return Node[]
     */
    public function getById(int $id): array;

    /**
     * @return Node[] the folder's immediate children (files and
     *     subfolders) — the primitive {@see
     *     \OCA\Momentum\Service\ScopedReconciliationPass} recurses to walk a
     *     scoped-reconcile task's affected subtree.
     */
    public function getDirectoryListing(): array;

    /**
     * Resolves a path relative to this folder to its Node — the primitive
     * {@see \OCA\Momentum\Service\SyncWorkLedger\LedgerRearmer} uses to
     * recover a document's Nextcloud `fileId` from its owner-relative path
     * (api.md § GET /documents/{public_id}'s `path` field), since neither
     * that field nor any other read surface ever serializes `fileId`
     * itself (db.md § `documents.id`).
     *
     * @throws NotFoundException no node exists at $path
     */
    public function get(string $path): Node;
}
