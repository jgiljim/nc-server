<?php

declare(strict_types=1);

namespace OCA\Momentum\Service\ApiProxy;

/**
 * The verbatim outcome of one proxied `/apps/momentum/api/*` call
 * (frontend.md § API Bindings Summary; backlog/v1.md M20.1): status code
 * and body exactly as the Doc-Mgr Backend returned them, including
 * non-2xx error bodies — `documents.ts`'s `requestJson` reads
 * `response.status`/`.json()` identically on error and success, so the
 * proxy must not collapse or reshape a failure response.
 */
final class ApiProxyResponse
{
    public function __construct(
        public readonly int $statusCode,
        public readonly string $body,
    ) {
    }
}
