<?php

declare(strict_types=1);

namespace OCP\SystemTag;

/**
 * Dev-only stub of the real Nextcloud `OCP\SystemTag\ISystemTag` surface used
 * by {@see \OCA\Momentum\Service\SyncWorkLedger\FilesMetadataLabelWriter}.
 * Never shipped — see composer.json "autoload-dev".
 */
interface ISystemTag
{
    public function getId(): string;

    public function getName(): string;
}
