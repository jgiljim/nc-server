<?php

declare(strict_types=1);

namespace OCA\Momentum\Service;

use OCA\Momentum\AppInfo\Application;
use OCA\Momentum\Exception\AmbiguousTenantMappingException;
use OCA\Momentum\Exception\NoTenantMappingException;
use OCP\IConfig;
use OCP\IDBConnection;
use OCP\IGroupManager;
use OCP\IUser;
use Psr\Log\LoggerInterface;

/**
 * Resolves the acting Nextcloud user to a Doc-Mgr tenant
 * (architecture.md § ⑨ Tenant mapper; requirements.md REQ-NC-TENANT-1/2).
 *
 * Dispatches on the `tenant_resolution_mode` NC `IAppConfig` setting
 * (db.md § App settings, ADR-003/review.md G17):
 *
 * - `group_intersection` (default) — the account's NC groups are
 *   intersected against the registered-customer-group set in
 *   `oc_momentum_tenants`, and exactly one match is required. Zero matches
 *   means the user's uploads are ignored (not indexed); two or more matches
 *   is a provisioning error and Doc-Mgr fails closed rather than guessing a
 *   "primary" group.
 * - `account_attribute` (REQ-NC-TENANT-2's fallback, for accounts spanning
 *   multiple customer groups — consultants, MSPs) — a single-valued tenant
 *   attribute stamped on the NC account (the `momentumTenant` account/LDAP
 *   attribute of deep_integration_doc-mgr_nc.md § Q1, surfaced here as a
 *   per-user `IConfig` value) is looked up directly against
 *   `oc_momentum_tenants.user_group_id` — no group membership is consulted,
 *   and there is no ambiguity case since the attribute is single-valued.
 */
final class TenantMapper
{
    private const TABLE_NAME = 'momentum_tenants';
    private const MODE_CONFIG_KEY = 'tenant_resolution_mode';
    private const MODE_GROUP_INTERSECTION = 'group_intersection';
    private const MODE_ACCOUNT_ATTRIBUTE = 'account_attribute';
    private const ACCOUNT_ATTRIBUTE_KEY = 'tenant_attribute';

    public function __construct(
        private readonly IDBConnection $db,
        private readonly IGroupManager $groupManager,
        private readonly LoggerInterface $logger,
        private readonly IConfig $config,
    ) {
    }

    /**
     * @throws NoTenantMappingException user matches no registered customer group
     * @throws AmbiguousTenantMappingException user matches 2+ registered customer groups (`group_intersection` only)
     */
    public function resolve(IUser $user): TenantMapping
    {
        $mode = $this->config->getAppValue(Application::APP_ID, self::MODE_CONFIG_KEY, self::MODE_GROUP_INTERSECTION);

        if ($mode === self::MODE_ACCOUNT_ATTRIBUTE) {
            return $this->resolveByAccountAttribute($user);
        }

        return $this->resolveByGroupIntersection($user);
    }

    /**
     * Batch form of {@see resolve()} for callers (namely {@see AccessResolver})
     * that need to resolve many users at once — resolving one at a time would
     * cost one DB round trip per user, and a group folder's `getAccessList()`
     * can return many uids for a single file event. Runs at most one query
     * total (per resolution mode), instead of one per user.
     *
     * Uids that resolve ambiguously or to no tenant are *omitted* from the
     * result rather than throwing — same fail-open-per-uid posture as
     * {@see resolve()}'s exceptions, just collapsed to "absent" since a batch
     * has no single caller to catch a per-user exception.
     *
     * @param list<IUser> $users
     * @return array<string, int> uid => tenant_id, only for uniquely-resolved users
     */
    public function resolveTenantIds(array $users): array
    {
        $mode = $this->config->getAppValue(Application::APP_ID, self::MODE_CONFIG_KEY, self::MODE_GROUP_INTERSECTION);

        if ($mode === self::MODE_ACCOUNT_ATTRIBUTE) {
            return $this->resolveTenantIdsByAccountAttribute($users);
        }

        return $this->resolveTenantIdsByGroupIntersection($users);
    }

    /**
     * @param list<IUser> $users
     * @return array<string, int>
     */
    private function resolveTenantIdsByGroupIntersection(array $users): array
    {
        $groupIdsByUid = [];
        $allGroupIds = [];

        foreach ($users as $user) {
            $groupIds = $this->groupManager->getUserGroupIds($user);
            $groupIdsByUid[$user->getUID()] = $groupIds;

            foreach ($groupIds as $groupId) {
                $allGroupIds[$groupId] = true;
            }
        }

        if ($allGroupIds === []) {
            return [];
        }

        $groupIds = array_keys($allGroupIds);
        $placeholders = implode(',', array_fill(0, count($groupIds), '?'));
        $result = $this->db->executeQuery(
            'SELECT user_group_id, tenant_id FROM *PREFIX*' . self::TABLE_NAME
                . ' WHERE user_group_id IN (' . $placeholders . ')',
            $groupIds,
        );
        $rows = $result->fetchAll();
        $result->closeCursor();

        $tenantIdByGroupId = [];
        foreach ($rows as $row) {
            $tenantIdByGroupId[$row['user_group_id']] = (int) $row['tenant_id'];
        }

        $resolved = [];
        foreach ($groupIdsByUid as $uid => $groupIds) {
            $matchedTenantIds = [];
            foreach ($groupIds as $groupId) {
                if (isset($tenantIdByGroupId[$groupId])) {
                    $matchedTenantIds[$tenantIdByGroupId[$groupId]] = true;
                }
            }

            if ($matchedTenantIds === []) {
                $this->logger->info(
                    "Batch tenant resolution: user '{uid}' belongs to no registered Doc-Mgr customer group.",
                    ['uid' => $uid],
                );
                continue;
            }

            if (count($matchedTenantIds) > 1) {
                $this->logger->error(
                    "Batch tenant resolution: user '{uid}' matches multiple registered Doc-Mgr customer"
                        . ' groups mapping to different tenants — dropping from the result.',
                    ['uid' => $uid],
                );
                continue;
            }

            $resolved[$uid] = array_key_first($matchedTenantIds);
        }

        return $resolved;
    }

    /**
     * @param list<IUser> $users
     * @return array<string, int>
     */
    private function resolveTenantIdsByAccountAttribute(array $users): array
    {
        $attributeByUid = [];
        $allAttributes = [];

        foreach ($users as $user) {
            $attributeValue = $this->config->getUserValue(
                $user->getUID(),
                Application::APP_ID,
                self::ACCOUNT_ATTRIBUTE_KEY,
            );

            if ($attributeValue === '') {
                $this->logger->info(
                    "Batch tenant resolution: user '{uid}' has no Doc-Mgr tenant attribute stamped on their account.",
                    ['uid' => $user->getUID()],
                );
                continue;
            }

            $attributeByUid[$user->getUID()] = $attributeValue;
            $allAttributes[$attributeValue] = true;
        }

        if ($allAttributes === []) {
            return [];
        }

        $attributes = array_keys($allAttributes);
        $placeholders = implode(',', array_fill(0, count($attributes), '?'));
        $result = $this->db->executeQuery(
            'SELECT user_group_id, tenant_id FROM *PREFIX*' . self::TABLE_NAME
                . ' WHERE user_group_id IN (' . $placeholders . ')',
            $attributes,
        );
        $rows = $result->fetchAll();
        $result->closeCursor();

        $tenantIdByAttribute = [];
        foreach ($rows as $row) {
            $tenantIdByAttribute[$row['user_group_id']] = (int) $row['tenant_id'];
        }

        $resolved = [];
        foreach ($attributeByUid as $uid => $attributeValue) {
            if (!isset($tenantIdByAttribute[$attributeValue])) {
                $this->logger->info(
                    "Batch tenant resolution: user '{uid}'s tenant attribute '{attribute}' matches no"
                        . ' registered Doc-Mgr tenant.',
                    ['uid' => $uid, 'attribute' => $attributeValue],
                );
                continue;
            }

            $resolved[$uid] = $tenantIdByAttribute[$attributeValue];
        }

        return $resolved;
    }

    /**
     * @throws NoTenantMappingException user matches no registered customer group
     * @throws AmbiguousTenantMappingException user matches 2+ registered customer groups
     */
    private function resolveByGroupIntersection(IUser $user): TenantMapping
    {
        $groupIds = $this->groupManager->getUserGroupIds($user);

        if ($groupIds === []) {
            throw new NoTenantMappingException(
                "User '{$user->getUID()}' belongs to no registered Doc-Mgr customer group.",
            );
        }

        $placeholders = implode(',', array_fill(0, count($groupIds), '?'));
        $result = $this->db->executeQuery(
            'SELECT user_group_id, tenant_id, backend_url FROM *PREFIX*' . self::TABLE_NAME
                . ' WHERE user_group_id IN (' . $placeholders . ')',
            $groupIds,
        );
        $rows = $result->fetchAll();
        $result->closeCursor();

        if ($rows === []) {
            throw new NoTenantMappingException(
                "User '{$user->getUID()}' belongs to no registered Doc-Mgr customer group.",
            );
        }

        if (count($rows) > 1) {
            $matchedGroups = implode(', ', array_column($rows, 'user_group_id'));
            $this->logger->error(
                "Provisioning error: user '{uid}' matches {count} registered Doc-Mgr customer groups ({groups})"
                    . ' — refusing to infer a primary tenant.',
                [
                    'uid' => $user->getUID(),
                    'count' => count($rows),
                    'groups' => $matchedGroups,
                ],
            );

            throw new AmbiguousTenantMappingException(
                "User '{$user->getUID()}' matches multiple registered Doc-Mgr customer groups: {$matchedGroups}.",
            );
        }

        $row = $rows[0];

        return new TenantMapping((int) $row['tenant_id'], (string) $row['backend_url']);
    }

    /**
     * @throws NoTenantMappingException the account has no tenant attribute stamped, or its value
     *                                   matches no registered tenant
     */
    private function resolveByAccountAttribute(IUser $user): TenantMapping
    {
        $attributeValue = $this->config->getUserValue(
            $user->getUID(),
            Application::APP_ID,
            self::ACCOUNT_ATTRIBUTE_KEY,
        );

        if ($attributeValue === '') {
            throw new NoTenantMappingException(
                "User '{$user->getUID()}' has no Doc-Mgr tenant attribute stamped on their account.",
            );
        }

        $result = $this->db->executeQuery(
            'SELECT tenant_id, backend_url FROM *PREFIX*' . self::TABLE_NAME . ' WHERE user_group_id = ?',
            [$attributeValue],
        );
        $rows = $result->fetchAll();
        $result->closeCursor();

        if ($rows === []) {
            throw new NoTenantMappingException(
                "User '{$user->getUID()}'s tenant attribute '{$attributeValue}' matches no registered Doc-Mgr tenant.",
            );
        }

        $row = $rows[0];

        return new TenantMapping((int) $row['tenant_id'], (string) $row['backend_url']);
    }

    /**
     * Looks up a tenant's `backend_url` directly by id, for callers that
     * already know which tenant they're acting on (a previously-claimed
     * {@see \OCA\Momentum\Db\ScopedReconcileTaskRow}) and must not re-derive
     * it via {@see resolve()}'s group-intersection/account-attribute logic —
     * that logic answers "which tenant is this NC user in *right now*",
     * which could disagree with the tenant a task was created for if group
     * membership changed in between. Returns `null` if the tenant is no
     * longer registered (e.g. deleted while a reconciliation task was
     * pending).
     */
    public function backendUrlForTenant(int $tenantId): ?string
    {
        $result = $this->db->executeQuery(
            'SELECT backend_url FROM *PREFIX*' . self::TABLE_NAME . ' WHERE tenant_id = ?',
            [$tenantId],
        );
        $rows = $result->fetchAll();
        $result->closeCursor();

        return $rows === [] ? null : (string) $rows[0]['backend_url'];
    }

    /**
     * Looks up a tenant's `user_group_id` directly by id, mirroring
     * {@see backendUrlForTenant()} — for callers (the SystemTag mirror,
     * G66 item 2) that need the tenant's NC customer group to restrict a
     * mirrored SystemTag to it, without re-deriving the tenant via
     * {@see resolve()}'s group-intersection/account-attribute logic. Returns
     * `null` if the tenant is no longer registered.
     */
    public function groupIdForTenant(int $tenantId): ?string
    {
        $result = $this->db->executeQuery(
            'SELECT user_group_id FROM *PREFIX*' . self::TABLE_NAME . ' WHERE tenant_id = ?',
            [$tenantId],
        );
        $rows = $result->fetchAll();
        $result->closeCursor();

        return $rows === [] ? null : (string) $rows[0]['user_group_id'];
    }

    /**
     * Every registered customer-group -> tenant mapping, for full-tenant
     * reconciliation (M6.9) to enumerate — unlike {@see resolve()}, this is
     * not scoped to one user's groups.
     *
     * @return list<TenantGroupMapping>
     */
    public function listAll(): array
    {
        $result = $this->db->executeQuery(
            'SELECT user_group_id, tenant_id FROM *PREFIX*' . self::TABLE_NAME,
        );
        $rows = $result->fetchAll();
        $result->closeCursor();

        return array_map(
            static fn (array $row) => new TenantGroupMapping((int) $row['tenant_id'], (string) $row['user_group_id']),
            $rows,
        );
    }
}
