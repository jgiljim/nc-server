<?php

declare(strict_types=1);

namespace OCA\Momentum\Exception;

use RuntimeException;

/**
 * The acting user belongs to two or more registered Doc-Mgr customer groups
 * (requirements.md REQ-NC-TENANT-1: this is a provisioning error — Doc-Mgr
 * fails closed and never infers a "primary" group).
 */
final class AmbiguousTenantMappingException extends RuntimeException
{
}
