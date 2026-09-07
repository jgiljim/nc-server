<?php

declare(strict_types=1);

namespace OCP\FilesMetadata\Model;

/**
 * Dev-only stub of the real Nextcloud `OCP\FilesMetadata\Model\IFilesMetadata`
 * surface used by {@see \OCA\Momentum\Service\SyncWorkLedger\FilesMetadataLabelWriter}.
 * Never shipped — see composer.json "autoload-dev".
 */
interface IFilesMetadata
{
    public function setString(string $key, string $value, bool $index = false): self;

    public function setBool(string $key, bool $value, bool $index = false): self;
}
