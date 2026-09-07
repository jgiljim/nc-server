<?php

declare(strict_types=1);

namespace OCP\FilesMetadata;

use OCP\FilesMetadata\Model\IFilesMetadata;

/**
 * Dev-only stub of the real Nextcloud `OCP\FilesMetadata\IFilesMetadataManager`
 * surface used by {@see \OCA\Momentum\Service\SyncWorkLedger\FilesMetadataLabelWriter}.
 * Never shipped — see composer.json "autoload-dev".
 */
interface IFilesMetadataManager
{
    public function getMetadata(int $fileId, bool $generate = false): IFilesMetadata;

    public function saveMetadata(IFilesMetadata $filesMetadata): void;
}
