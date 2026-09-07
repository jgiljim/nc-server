<?php

declare(strict_types=1);

namespace OCP\SystemTag;

/**
 * Dev-only stub of the real Nextcloud `OCP\SystemTag\ISystemTagObjectMapper`
 * surface used by {@see \OCA\Momentum\Service\SyncWorkLedger\FilesMetadataLabelWriter}.
 * Never shipped — see composer.json "autoload-dev".
 */
interface ISystemTagObjectMapper
{
    /**
     * @param string|array<int, string> $tagIds
     */
    public function assignTags(string $objId, string $objectType, $tagIds): void;
}
