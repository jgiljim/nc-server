<?php

declare(strict_types=1);

namespace OCA\Momentum\Exception;

use RuntimeException;

/**
 * The Glue App is misconfigured and cannot mint an EdDSA identity token
 * (architecture.md § ⑨ Tenant mapper + token minter; requirements.md
 * ADR-002) — e.g. no signing key deployed to this NC instance.
 */
final class TokenMintingException extends RuntimeException
{
}
