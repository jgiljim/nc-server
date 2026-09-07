<?php

declare(strict_types=1);

namespace OCP\SystemTag;

/**
 * Dev-only stub of the real Nextcloud `OCP\SystemTag\ISystemTagManager`
 * surface used by {@see \OCA\Momentum\Service\SyncWorkLedger\FilesMetadataLabelWriter}.
 * Never shipped — see composer.json "autoload-dev".
 */
interface ISystemTagManager
{
    /**
     * @throws TagNotFoundException if no tag with this name/visibility exists
     */
    public function getTag(string $tagName, bool $userVisible, bool $userAssignable): ISystemTag;

    public function createTag(string $tagName, bool $userVisible, bool $userAssignable, ?string $color = null): ISystemTag;

    /**
     * @return list<string> NC group ids currently allowed to see/assign a
     * restricted (non-`userVisible`) tag
     */
    public function getTagGroups(ISystemTag $tag): array;

    /**
     * Restricts a non-`userVisible`/non-`userAssignable` tag to the given NC
     * group ids (`oc_systemtag_group`) — the mechanism M12 (specs/review.md)
     * scopes SystemTag visibility to a tenant's customer group with.
     *
     * @param list<string> $groupIds
     */
    public function setTagGroups(ISystemTag $tag, array $groupIds): void;
}
