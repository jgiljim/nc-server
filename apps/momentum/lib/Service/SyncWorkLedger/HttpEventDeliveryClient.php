<?php

declare(strict_types=1);

namespace OCA\Momentum\Service\SyncWorkLedger;

use OCA\Momentum\Service\TokenMinter;
use OCP\Http\Client\IClientService;
use OCP\IConfig;
use Psr\Log\LoggerInterface;
use Throwable;

/**
 * The real {@see EventDeliveryClient}, replacing the "wired up once M5.4
 * lands" placeholder now that the tenant mapper/token minter has. Mints a
 * fresh EdDSA identity token per call (changelog.md B2 — never at event
 * time, since its <= 60 s TTL would expire before the next drain tick) and
 * POSTs to the tenant's `backend_url` (architecture.md § ⑨; requirements.md
 * ADR-002).
 *
 * `nc_user_id` and `backend_url` are carried on the ledger row's payload
 * purely so this client has them at drain time (`LedgerFilesystemEventSink`
 * seeds both); neither is part of the wire request body defined by api.md,
 * so both are stripped before the payload is sent.
 */
final class HttpEventDeliveryClient implements EventDeliveryClient
{
    /**
     * The AppAPI-issued shared secret this ExApp deployment was provisioned
     * with, read the same way {@see TokenMinter} reads
     * `momentum_eddsa_private_key` — a system config value, not an app
     * value, since it's deployment-wide rather than per-app-instance.
     */
    private const SYSTEM_CONFIG_KEY_APPAPI_SHARED_SECRET = 'momentum_appapi_shared_secret';

    public function __construct(
        private readonly IClientService $clientService,
        private readonly TokenMinter $tokenMinter,
        private readonly IConfig $config,
        private readonly LoggerInterface $logger,
    ) {
    }

    public function post(string $path, array $payload): DeliveryResponse
    {
        $ncUserId = isset($payload['nc_user_id']) ? (string) $payload['nc_user_id'] : '';
        $backendUrl = isset($payload['backend_url']) ? (string) $payload['backend_url'] : '';
        unset($payload['nc_user_id'], $payload['backend_url']);

        $tenantId = (int) ($payload['tenant_id'] ?? 0);

        try {
            $token = $this->tokenMinter->mint($tenantId, $ncUserId);
            $sharedSecret = $this->config->getSystemValueString(self::SYSTEM_CONFIG_KEY_APPAPI_SHARED_SECRET);

            $response = $this->clientService->newClient()->post(
                rtrim($backendUrl, '/') . $path,
                [
                    'json' => $payload,
                    'headers' => [
                        'Authorization' => 'Bearer ' . $token,
                        'AA-SIGNATURE' => $sharedSecret,
                    ],
                    'http_errors' => false,
                ],
            );
        } catch (Throwable $e) {
            // Was silently swallowed with no diagnostic at all (confirmed via
            // a live install, 2026-07-25 — every delivery failure looked
            // identical from the ledger's `attempts` counter alone, with
            // nothing in the logs to say whether the cause was token minting,
            // DNS, connection refusal, or anything else).
            $this->logger->error('Momentum event delivery to {path} failed: {message}', [
                'app' => 'momentum',
                'path' => $path,
                'message' => $e->getMessage(),
                'exception' => $e,
            ]);
            return new DeliveryResponse(503);
        }

        $statusCode = $response->getStatusCode();

        if ($statusCode < 200 || $statusCode >= 300) {
            // Was silently swallowed with no diagnostic at all — same gap as
            // the transport-exception branch above had before 2026-07-25's
            // fix, just for the http_errors => false / non-2xx path instead
            // of a thrown exception. Confirmed live, 2026-07-28: a batch of
            // `target=access` rows kept retrying with nothing in the logs to
            // say whether the backend was rejecting them with a 400/404/500
            // or something else.
            $this->logger->warning('Momentum event delivery to {path} failed: {status}', [
                'app' => 'momentum',
                'path' => $path,
                'status' => $statusCode,
                'body' => $response->getBody(),
            ]);
        }

        return new DeliveryResponse($statusCode);
    }
}
