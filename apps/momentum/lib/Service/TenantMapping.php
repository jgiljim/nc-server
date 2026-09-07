<?php

declare(strict_types=1);

namespace OCA\Momentum\Service;

/**
 * Resolved mapping of a Nextcloud user to a Doc-Mgr tenant
 * (db.md § Nextcloud-DB Glue-App Tables, oc_momentum_tenants).
 */
final class TenantMapping
{
    public function __construct(
        public readonly int $tenantId,
        public readonly string $backendUrl,
    ) {
    }
}
