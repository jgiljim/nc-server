<?php

declare(strict_types=1);

namespace OCA\Momentum\Service;

/**
 * One registered customer-group -> tenant mapping (db.md § Nextcloud-DB
 * Glue-App Tables, oc_momentum_tenants), as returned by
 * {@see TenantMapper::listAll()} for full-tenant reconciliation (M6.9) —
 * unlike {@see TenantMapping}, this carries the NC group id rather than a
 * resolved-for-one-user backend URL, since full-tenant reconciliation needs
 * to enumerate every member of the group, not resolve a single user.
 */
final class TenantGroupMapping
{
    public function __construct(
        public readonly int $tenantId,
        public readonly string $groupId,
    ) {
    }
}
