<?php

declare(strict_types=1);

namespace OCA\Momentum\Exception;

use RuntimeException;

/**
 * The acting user belongs to no registered Doc-Mgr customer group
 * (requirements.md REQ-NC-TENANT-1: uploads from such a user are ignored,
 * not indexed — this is not a provisioning error).
 */
final class NoTenantMappingException extends RuntimeException
{
}
