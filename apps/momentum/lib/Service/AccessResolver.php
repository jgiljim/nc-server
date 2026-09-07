<?php

declare(strict_types=1);

namespace OCA\Momentum\Service;

use OCA\Momentum\Exception\AmbiguousTenantMappingException;
use OCA\Momentum\Exception\NoTenantMappingException;
use OCP\Files\Config\IUserMountCache;
use OCP\Files\Node;
use OCP\IUserManager;
use OCP\Share\IManager;
use Psr\Log\LoggerInterface;

/**
 * Recomputes a file's authoritative visible-uid set via Nextcloud's own APIs
 * (architecture.md § ⑨ Access resolver: "getAccessList / IUserMountCache") —
 * the mount cache covers ownership and group-folder mounts, the Share
 * manager covers direct and group shares (Nextcloud itself expands
 * group → member uids). Nextcloud computes the decision; this class only
 * reads it and never re-implements share/ACL rules (db.md — Access-projection
 * maintenance; "cache decisions, not rules").
 *
 * Layer 2 of REQ-NC-TENANT-3's cross-tenant-share guard (requirements.md):
 * uids Nextcloud itself would grant access to are further filtered down to
 * uids belonging to the document's *own* tenant, so a cross-tenant share
 * never adds a foreign-tenant uid to this document's access projection.
 * Layer 1 (RLS scoping reads to the caller's own tenant_id) remains the
 * authoritative backstop — this layer is defense-in-depth, so when the
 * document's owning tenant itself cannot be resolved, the safe direction is
 * to fall back to the unfiltered uid set (log and rely on layer 1) rather
 * than dropping every viewer.
 */
final class AccessResolver
{
    public function __construct(
        private readonly IUserMountCache $mountCache,
        private readonly IManager $shareManager,
        private readonly TenantMapper $tenantMapper,
        private readonly IUserManager $userManager,
        private readonly LoggerInterface $logger,
    ) {
    }

    /**
     * @return list<string> the complete current set of uids who can see this
     *     file — an empty list means the file is fully revoked.
     */
    public function resolveUids(Node $node): array
    {
        $uids = [];

        foreach ($this->mountCache->getMountsForFileId($node->getId()) as $mount) {
            $uids[$mount->getUser()->getUID()] = true;
        }

        // getAccessList()'s $currentAccess parameter defaults to false, and
        // is left at that default here deliberately — this only needs the
        // uid set, not the per-user node_id/node_path getAccessList()
        // returns when $currentAccess=true, which real-share topologies
        // charge extra queries for. Without $currentAccess, IManager's own
        // documented return shape is `users?: list<string>` — a plain,
        // sequentially-indexed list of uid strings, NOT an associative
        // uid-keyed array. array_keys() on that list therefore returned
        // integer indices (0, 1, 2, ...) instead of the uids themselves,
        // producing entries like `0` in the emitted uids array — confirmed
        // live, 2026-07-27: a real POST /internal/access payload came back
        // as `{"uids":[0,"momentum-demo-user"]}`, which the Go backend
        // rejects with a 400 (uids must be strings), so access_projection
        // was never actually seeded, even for a document with no shares at
        // all. The values themselves, not their keys, are the uids here.
        $accessList = $this->shareManager->getAccessList($node);
        foreach ($accessList['users'] ?? [] as $uid) {
            $uids[$uid] = true;
        }

        $candidateUids = array_keys($uids);

        return $this->filterToOwningTenant($node, $candidateUids);
    }

    /**
     * @param list<string> $candidateUids
     * @return list<string>
     */
    private function filterToOwningTenant(Node $node, array $candidateUids): array
    {
        $owner = $node->getOwner();

        if ($owner === null) {
            $this->logger->warning(
                'AccessResolver: file {fileId} has no owner — cannot determine its owning tenant,'
                    . ' returning the unfiltered uid set.',
                ['fileId' => $node->getId()],
            );

            return $this->sorted($candidateUids);
        }

        try {
            $ownerTenantId = $this->tenantMapper->resolve($owner)->tenantId;
        } catch (NoTenantMappingException | AmbiguousTenantMappingException $e) {
            $this->logger->warning(
                'AccessResolver: could not resolve the owning tenant for file {fileId}: {reason} —'
                    . ' returning the unfiltered uid set.',
                ['fileId' => $node->getId(), 'reason' => $e->getMessage()],
            );

            return $this->sorted($candidateUids);
        }

        $usersByUid = [];
        foreach ($candidateUids as $uid) {
            $user = $this->userManager->get($uid);

            if ($user === null) {
                $this->logger->info(
                    "AccessResolver: dropping uid '{uid}' from file {fileId}'s access projection —"
                        . ' no such Nextcloud user.',
                    ['uid' => $uid, 'fileId' => $node->getId()],
                );

                continue;
            }

            $usersByUid[$uid] = $user;
        }

        $tenantIdsByUid = $this->tenantMapper->resolveTenantIds(array_values($usersByUid));

        $result = [];
        foreach (array_keys($usersByUid) as $uid) {
            if (($tenantIdsByUid[$uid] ?? null) === $ownerTenantId) {
                $result[] = $uid;
                continue;
            }

            $this->logger->info(
                "AccessResolver: dropping foreign-tenant uid '{uid}' from file {fileId}'s access projection.",
                ['uid' => $uid, 'fileId' => $node->getId()],
            );
        }

        return $this->sorted($result);
    }

    /**
     * @param list<string> $uids
     * @return list<string>
     */
    private function sorted(array $uids): array
    {
        sort($uids);

        return $uids;
    }
}
