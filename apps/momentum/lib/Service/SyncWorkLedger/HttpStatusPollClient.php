<?php

declare(strict_types=1);

namespace OCA\Momentum\Service\SyncWorkLedger;

use OCA\Momentum\Service\TokenMinter;
use OCP\Http\Client\IClientService;
use OCP\IConfig;
use OCP\IDBConnection;
use Psr\Log\LoggerInterface;
use Throwable;

/**
 * The real {@see StatusPollClient} — mints a fresh EdDSA identity token per
 * call (mirroring {@see HttpEventDeliveryClient}) and reads `GET
 * /internal/status` (api.md) on the Doc-Mgr Backend.
 *
 * `StatusPollPass` only hands this a flat `list<int>` of `doc_id`s, batched
 * across every `awaiting` ledger row regardless of tenant — but the request
 * itself is tenant-scoped (api.md § GET /internal/status: "via the token's
 * `tenant_id`/`nc_instance_id` claims") and each tenant may have a distinct
 * `backend_url`. So this client re-derives `tenant_id`/`backend_url` per
 * `doc_id` from the ledger row's own `payload` (seeded at enqueue time by
 * `LedgerFilesystemEventSink`, carried through untouched to `awaiting` —
 * same field `HttpEventDeliveryClient` reads off the outbound payload),
 * groups `doc_id`s by `(tenant_id, backend_url)`, and issues one request per
 * group, merging the results back into a single flat list.
 *
 * Sends the same `AA-SIGNATURE` shared-secret header
 * {@see HttpEventDeliveryClient} does (G60/M44.4) — found missing here
 * specifically, live, 2026-08-04: every call 401ed on a deployment with real
 * channel auth enabled, silently (the 401 is caught and logged as a
 * warning, never thrown), so `StatusPollPass` never observed any status
 * change, and {@see CleanupSweep} — which calls this same client and treats
 * an empty response as "these doc_ids don't exist" — then deleted the
 * affected `awaiting` ledger rows as orphaned, permanently losing the
 * deferred tag-sync for those documents. G60/M44.4 only fixed
 * {@see HttpEventDeliveryClient}; this client was never updated to match.
 */
final class HttpStatusPollClient implements StatusPollClient
{
    private const TABLE = '*PREFIX*momentum_sync_work_ledger';

    /** Mirrors {@see HttpEventDeliveryClient}'s own constant — same system config key. */
    private const SYSTEM_CONFIG_KEY_APPAPI_SHARED_SECRET = 'momentum_appapi_shared_secret';

    public function __construct(
        private readonly IDBConnection $db,
        private readonly IClientService $clientService,
        private readonly TokenMinter $tokenMinter,
        private readonly IConfig $config,
        private readonly LoggerInterface $logger,
    ) {
    }

    public function getStatuses(array $docIds): array
    {
        if ($docIds === []) {
            return [];
        }

        $items = [];
        foreach ($this->groupByTenant($docIds) as $group) {
            foreach ($this->fetchGroup($group) as $item) {
                $items[] = $item;
            }
        }

        return $items;
    }

    /**
     * @param list<int> $docIds
     *
     * @return list<array{tenantId: int, ncUserId: string, backendUrl: string, docIds: list<int>}>
     */
    private function groupByTenant(array $docIds): array
    {
        $placeholders = implode(',', array_fill(0, count($docIds), '?'));
        $result = $this->db->executeQuery(
            'SELECT doc_id, payload FROM ' . self::TABLE
                . ' WHERE phase = ? AND doc_id IN (' . $placeholders . ')',
            array_merge(['awaiting'], $docIds),
        );

        $groups = [];
        foreach ($result->fetchAll() as $row) {
            $payload = json_decode((string) $row['payload'], true, 512, JSON_THROW_ON_ERROR);
            $backendUrl = isset($payload['backend_url']) ? (string) $payload['backend_url'] : '';

            if ($backendUrl === '') {
                $this->logger->warning(
                    'Momentum status poll: doc {docId} has no backend_url on its ledger payload — skipping.',
                    ['app' => 'momentum', 'docId' => $row['doc_id']],
                );
                continue;
            }

            $tenantId = (int) ($payload['tenant_id'] ?? 0);
            $key = $tenantId . '|' . $backendUrl;

            $groups[$key] ??= [
                'tenantId' => $tenantId,
                'ncUserId' => isset($payload['nc_user_id']) ? (string) $payload['nc_user_id'] : '',
                'backendUrl' => $backendUrl,
                'docIds' => [],
            ];
            $groups[$key]['docIds'][] = (int) $row['doc_id'];
        }
        $result->closeCursor();

        return array_values($groups);
    }

    /**
     * @param array{tenantId: int, ncUserId: string, backendUrl: string, docIds: list<int>} $group
     *
     * @return list<StatusItem>
     */
    private function fetchGroup(array $group): array
    {
        $uri = rtrim($group['backendUrl'], '/') . '/internal/status'
            . '?' . http_build_query(['doc_ids' => implode(',', $group['docIds'])]);

        try {
            $token = $this->tokenMinter->mint($group['tenantId'], $group['ncUserId']);
            $sharedSecret = $this->config->getSystemValueString(self::SYSTEM_CONFIG_KEY_APPAPI_SHARED_SECRET);

            $response = $this->clientService->newClient()->request(
                'GET',
                $uri,
                [
                    'headers' => [
                        'Authorization' => 'Bearer ' . $token,
                        'AA-SIGNATURE' => $sharedSecret,
                    ],
                    'http_errors' => false,
                ],
            );
        } catch (Throwable $e) {
            $this->logger->error('Momentum status poll to {uri} failed: {message}', [
                'app' => 'momentum',
                'uri' => $uri,
                'message' => $e->getMessage(),
                'exception' => $e,
            ]);

            return [];
        }

        if ($response->getStatusCode() < 200 || $response->getStatusCode() >= 300) {
            $this->logger->warning('Momentum status poll to {uri} returned {status}', [
                'app' => 'momentum',
                'uri' => $uri,
                'status' => $response->getStatusCode(),
            ]);

            return [];
        }

        $body = $response->getBody();
        $raw = is_string($body) ? $body : (string) stream_get_contents($body);

        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (Throwable $e) {
            $this->logger->error('Momentum status poll to {uri} returned invalid JSON: {message}', [
                'app' => 'momentum',
                'uri' => $uri,
                'message' => $e->getMessage(),
            ]);

            return [];
        }

        $items = [];
        foreach ((array) ($decoded['items'] ?? []) as $item) {
            $items[] = new StatusItem(
                (int) $item['doc_id'],
                (string) $item['status'],
                isset($item['doc_type']) ? (string) $item['doc_type'] : null,
                isset($item['direction']) ? (string) $item['direction'] : null,
                (bool) ($item['reviewed'] ?? false),
                $group['tenantId'],
            );
        }

        return $items;
    }
}
