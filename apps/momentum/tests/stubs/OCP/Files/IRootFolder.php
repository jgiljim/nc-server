<?php

declare(strict_types=1);

namespace OCP\Files;

/**
 * Test-only stub reproducing the slice of \OCP\Files\IRootFolder this app's
 * file-serving controller depends on (`getUserFolder($uid)->getById($fileId)`,
 * the `context_chat` `QueueController` pattern — architecture.md § ⑨), plus
 * the root-level `getById` the notify_push uid resolver (M7.3) uses to look
 * up a node by its NC `fileId` (`doc_id`) without an owner uid in hand — the
 * real `\OCP\Files\IRootFolder` extends `Folder` and exposes this directly.
 * Never shipped to production — see glue-app/composer.json "autoload-dev"
 * (OCP\ is not in "autoload"). At runtime inside Nextcloud, the real
 * server-provided interface is used.
 */
interface IRootFolder
{
    /**
     * @throws NotFoundException if the user has no home folder
     */
    public function getUserFolder(string $userId): Folder;

    /**
     * @return \OCP\Files\Node[]
     */
    public function getById(int $id): array;
}
