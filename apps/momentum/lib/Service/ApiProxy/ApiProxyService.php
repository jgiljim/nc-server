<?php

declare(strict_types=1);

namespace OCA\Momentum\Service\ApiProxy;

use OCA\Momentum\Exception\AmbiguousTenantMappingException;
use OCA\Momentum\Exception\NoTenantMappingException;
use OCA\Momentum\Exception\TokenMintingException;
use OCA\Momentum\Service\TenantMapper;
use OCA\Momentum\Service\TokenMinter;
use OCP\Http\Client\IClientService;
use OCP\IUser;
use Psr\Log\LoggerInterface;
use Throwable;

/**
 * The shared mint-and-forward mechanism behind every `/apps/momentum/api/*`
 * route (frontend.md § API Bindings Summary; backlog/v1.md M20.1). Per-call
 * responsibilities, per the milestone: (1) resolve the acting NC user's
 * tenant via {@see TenantMapper}; (2) mint a short-lived EdDSA identity
 * token for that user via {@see TokenMinter}; (3) forward the request to
 * the resolved tenant's `backend_url` + the real Doc-Mgr `/api/*` path
 * (`specs/api.md` § Tenant API), preserving method/path/query/body; (4)
 * relay the response back verbatim — status code and body, including
 * non-2xx error bodies.
 *
 * This is the same mint-and-forward pattern
 * {@see \OCA\Momentum\Service\SyncWorkLedger\HttpEventDeliveryClient} (M10.11)
 * uses for the sync-work ledger drain pass, just synchronous/
 * frontend-triggered and for arbitrary reads/writes instead of ingest
 * events — hence the raw string `$path` (may already carry a query string)
 * and `$body` here, rather than that client's JSON-array payload, since a
 * generic proxy cannot assume every forwarded call is a `POST` with a
 * ledger-shaped JSON body.
 *
 * Tenant-resolution and token-minting failures
 * ({@see NoTenantMappingException}, {@see AmbiguousTenantMappingException},
 * {@see TokenMintingException}) are Glue-App-side conditions, not a Doc-Mgr
 * Backend response, so they propagate to the caller (the per-endpoint
 * controller, M20.2-M20.9) to translate into the appropriate OCS/HTTP
 * error rather than being coerced into a synthetic {@see ApiProxyResponse}.
 * Only an actual transport failure talking to `backend_url` (DNS,
 * connection refusal, timeout) is caught here and turned into a synthetic
 * 502 — mirroring `HttpEventDeliveryClient`'s handling of the same class of
 * failure — since the frontend still expects a normal HTTP response, not
 * an uncaught exception, out of every proxied call.
 */
final class ApiProxyService
{
    public function __construct(
        private readonly TenantMapper $tenantMapper,
        private readonly TokenMinter $tokenMinter,
        private readonly IClientService $clientService,
        private readonly LoggerInterface $logger,
    ) {
    }

    /**
     * @param string $path the Doc-Mgr Backend `/api/*` path, including any query string, exactly
     *                     as it should reach the backend (`specs/api.md` § Tenant API)
     *
     * @throws NoTenantMappingException the acting user matches no registered Doc-Mgr customer group
     * @throws AmbiguousTenantMappingException the acting user matches 2+ registered customer groups
     * @throws TokenMintingException no valid EdDSA signing key deployed to this NC instance
     */
    public function forward(IUser $user, string $method, string $path, ?string $body = null): ApiProxyResponse
    {
        $mapping = $this->tenantMapper->resolve($user);
        $token = $this->tokenMinter->mint($mapping->tenantId, $user->getUID());

        $options = [
            'headers' => ['Authorization' => 'Bearer ' . $token],
            'http_errors' => false,
        ];

        if ($body !== null) {
            $options['body'] = $body;
            $options['headers']['Content-Type'] = 'application/json';
        }

        try {
            $response = $this->clientService->newClient()->request(
                strtoupper($method),
                rtrim($mapping->backendUrl, '/') . $path,
                $options,
            );
        } catch (Throwable $e) {
            $this->logger->error('Momentum API proxy request to {path} failed: {message}', [
                'app' => 'momentum',
                'path' => $path,
                'message' => $e->getMessage(),
                'exception' => $e,
            ]);

            return new ApiProxyResponse(502, '');
        }

        $responseBody = $response->getBody();

        return new ApiProxyResponse(
            $response->getStatusCode(),
            is_string($responseBody) ? $responseBody : (string) stream_get_contents($responseBody),
        );
    }
}
