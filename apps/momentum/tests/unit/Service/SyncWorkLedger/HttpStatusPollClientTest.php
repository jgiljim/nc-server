<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Service\SyncWorkLedger;

use OCA\Momentum\Service\SyncWorkLedger\HttpStatusPollClient;
use OCA\Momentum\Service\TokenMinter;
use OCA\Momentum\Tests\Support\FakeConfig;
use OCA\Momentum\Tests\Support\FakeResult;
use OCA\Momentum\Tests\Support\FakeTimeFactory;
use OCP\DB\IResult;
use OCP\Http\Client\IClient;
use OCP\Http\Client\IClientService;
use OCP\Http\Client\IResponse;
use OCP\IDBConnection;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * G60/M44.4 landed AA-SIGNATURE-sending on {@see HttpEventDeliveryClient}
 * only — this client (`GET /internal/status`) was left sending just a
 * bearer token, so every call 401s on any deployment with real channel auth
 * enabled. Confirmed live, 2026-08-04: StatusPollPass silently polled
 * nothing (the 401 is swallowed into a warning, not thrown), and
 * CleanupSweep — which calls this same client and treats an empty response
 * as "these doc_ids don't exist" — then deleted the affected ledger rows as
 * "orphaned", permanently losing the deferred tag-sync for those documents.
 */

final class HttpStatusPollClientTest extends TestCase
{
    public function testFetchesStatusesForASingleTenantGroup(): void
    {
        $db = $this->createMock(IDBConnection::class);
        $db->method('executeQuery')->willReturn(new FakeResult([
            [
                'doc_id' => 42,
                'payload' => json_encode([
                    'tenant_id' => 12345,
                    'nc_user_id' => 'carol',
                    'backend_url' => 'https://acme.example',
                ], JSON_THROW_ON_ERROR),
            ],
            [
                'doc_id' => 43,
                'payload' => json_encode([
                    'tenant_id' => 12345,
                    'nc_user_id' => 'carol',
                    'backend_url' => 'https://acme.example',
                ], JSON_THROW_ON_ERROR),
            ],
        ]));

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(200);
        $response->method('getBody')->willReturn(json_encode([
            'items' => [
                ['doc_id' => 42, 'status' => 'done', 'doc_type' => 'sales_invoice', 'direction' => 'inbound', 'reviewed' => false],
                ['doc_id' => 43, 'status' => 'processing', 'doc_type' => null, 'direction' => null, 'reviewed' => false],
            ],
        ], JSON_THROW_ON_ERROR));

        $capturedMethod = null;
        $capturedUri = null;
        $capturedOptions = null;

        $client = $this->createMock(IClient::class);
        $client->expects(self::once())->method('request')
            ->with(
                self::callback(function (string $method) use (&$capturedMethod) {
                    $capturedMethod = $method;

                    return true;
                }),
                self::callback(function (string $uri) use (&$capturedUri) {
                    $capturedUri = $uri;

                    return true;
                }),
                self::callback(function (array $options) use (&$capturedOptions) {
                    $capturedOptions = $options;

                    return true;
                }),
            )
            ->willReturn($response);

        $clientService = $this->createMock(IClientService::class);
        $clientService->method('newClient')->willReturn($client);

        $config = new FakeConfig(
            systemValues: [
                'momentum_eddsa_private_key' => base64_encode(sodium_crypto_sign_secretkey(sodium_crypto_sign_keypair())),
                'momentum_appapi_shared_secret' => 'super-secret-shared-value',
            ],
            appValues: ['momentum' => ['nc_instance_id' => '7']],
        );
        $tokenMinter = new TokenMinter($config, new FakeTimeFactory(1_700_000_000));

        $pollClient = new HttpStatusPollClient($db, $clientService, $tokenMinter, $config, $this->createMock(LoggerInterface::class));

        $items = $pollClient->getStatuses([42, 43]);

        self::assertSame('GET', $capturedMethod);
        self::assertStringStartsWith('https://acme.example/internal/status?', $capturedUri);
        self::assertStringContainsString('doc_ids=42%2C43', $capturedUri);

        $token = $capturedOptions['headers']['Authorization'] ?? null;
        self::assertIsString($token);
        self::assertStringStartsWith('Bearer ', $token);

        self::assertSame('super-secret-shared-value', $capturedOptions['headers']['AA-SIGNATURE'] ?? null);

        self::assertCount(2, $items);
        self::assertSame(42, $items[0]->docId);
        self::assertSame('done', $items[0]->status);
        self::assertSame(12345, $items[0]->tenantId);
        self::assertSame(43, $items[1]->docId);
        self::assertSame('processing', $items[1]->status);
        self::assertSame(12345, $items[1]->tenantId);
    }

    public function testSendsTheConfiguredSharedSecretAsTheAaSignatureHeaderOnInternalCalls(): void
    {
        $db = $this->createMock(IDBConnection::class);
        $db->method('executeQuery')->willReturn(new FakeResult([
            [
                'doc_id' => 1,
                'payload' => json_encode(
                    ['tenant_id' => 1, 'nc_user_id' => 'carol', 'backend_url' => 'https://acme.example'],
                    JSON_THROW_ON_ERROR,
                ),
            ],
        ]));

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(200);
        $response->method('getBody')->willReturn(json_encode(['items' => []], JSON_THROW_ON_ERROR));

        $capturedOptions = null;
        $client = $this->createMock(IClient::class);
        $client->expects(self::once())->method('request')
            ->with(self::anything(), self::anything(), self::callback(function (array $options) use (&$capturedOptions) {
                $capturedOptions = $options;

                return true;
            }))
            ->willReturn($response);

        $clientService = $this->createMock(IClientService::class);
        $clientService->method('newClient')->willReturn($client);

        $config = new FakeConfig(
            systemValues: [
                'momentum_eddsa_private_key' => base64_encode(sodium_crypto_sign_secretkey(sodium_crypto_sign_keypair())),
                'momentum_appapi_shared_secret' => 'another-shared-secret',
            ],
        );
        $tokenMinter = new TokenMinter($config, new FakeTimeFactory(1_700_000_000));

        $pollClient = new HttpStatusPollClient($db, $clientService, $tokenMinter, $config, $this->createMock(LoggerInterface::class));
        $pollClient->getStatuses([1]);

        self::assertSame('another-shared-secret', $capturedOptions['headers']['AA-SIGNATURE'] ?? null);
    }

    public function testGroupsDocIdsByTenantAndBackendUrlIntoSeparateRequests(): void
    {
        $db = $this->createMock(IDBConnection::class);
        $db->method('executeQuery')->willReturn(new FakeResult([
            [
                'doc_id' => 1,
                'payload' => json_encode([
                    'tenant_id' => 1,
                    'nc_user_id' => 'alice',
                    'backend_url' => 'https://tenant-one.example',
                ], JSON_THROW_ON_ERROR),
            ],
            [
                'doc_id' => 2,
                'payload' => json_encode([
                    'tenant_id' => 2,
                    'nc_user_id' => 'bob',
                    'backend_url' => 'https://tenant-two.example',
                ], JSON_THROW_ON_ERROR),
            ],
        ]));

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(200);
        $response->method('getBody')->willReturn(json_encode(['items' => []], JSON_THROW_ON_ERROR));

        $capturedUris = [];
        $client = $this->createMock(IClient::class);
        $client->method('request')
            ->willReturnCallback(function (string $method, string $uri, array $options) use (&$capturedUris, $response) {
                $capturedUris[] = $uri;

                return $response;
            });

        $clientService = $this->createMock(IClientService::class);
        $clientService->method('newClient')->willReturn($client);

        $config = new FakeConfig(
            systemValues: ['momentum_eddsa_private_key' => base64_encode(sodium_crypto_sign_secretkey(sodium_crypto_sign_keypair()))],
        );
        $tokenMinter = new TokenMinter($config, new FakeTimeFactory(1_700_000_000));

        $pollClient = new HttpStatusPollClient($db, $clientService, $tokenMinter, $config, $this->createMock(LoggerInterface::class));
        $pollClient->getStatuses([1, 2]);

        self::assertCount(2, $capturedUris);
        self::assertStringStartsWith('https://tenant-one.example/internal/status?', $capturedUris[0]);
        self::assertStringStartsWith('https://tenant-two.example/internal/status?', $capturedUris[1]);
    }

    public function testADocIdWithNoBackendUrlOnItsPayloadIsSkippedRatherThanErroring(): void
    {
        $db = $this->createMock(IDBConnection::class);
        $db->method('executeQuery')->willReturn(new FakeResult([
            ['doc_id' => 99, 'payload' => json_encode(['tenant_id' => 1], JSON_THROW_ON_ERROR)],
        ]));

        $clientService = $this->createMock(IClientService::class);
        $clientService->expects(self::never())->method('newClient');

        $config = new FakeConfig(
            systemValues: ['momentum_eddsa_private_key' => base64_encode(sodium_crypto_sign_secretkey(sodium_crypto_sign_keypair()))],
        );
        $tokenMinter = new TokenMinter($config, new FakeTimeFactory(1_700_000_000));

        $pollClient = new HttpStatusPollClient($db, $clientService, $tokenMinter, $config, $this->createMock(LoggerInterface::class));

        self::assertSame([], $pollClient->getStatuses([99]));
    }

    public function testATransportFailureIsTreatedAsNoItemsRatherThanAnUncaughtException(): void
    {
        $db = $this->createMock(IDBConnection::class);
        $db->method('executeQuery')->willReturn(new FakeResult([
            [
                'doc_id' => 5,
                'payload' => json_encode(
                    ['tenant_id' => 1, 'nc_user_id' => 'carol', 'backend_url' => 'https://acme.example'],
                    JSON_THROW_ON_ERROR,
                ),
            ],
        ]));

        $client = $this->createMock(IClient::class);
        $client->method('request')->willThrowException(new \RuntimeException('connection refused'));

        $clientService = $this->createMock(IClientService::class);
        $clientService->method('newClient')->willReturn($client);

        $config = new FakeConfig(
            systemValues: ['momentum_eddsa_private_key' => base64_encode(sodium_crypto_sign_secretkey(sodium_crypto_sign_keypair()))],
        );
        $tokenMinter = new TokenMinter($config, new FakeTimeFactory(1_700_000_000));

        $pollClient = new HttpStatusPollClient($db, $clientService, $tokenMinter, $config, $this->createMock(LoggerInterface::class));

        self::assertSame([], $pollClient->getStatuses([5]));
    }

    public function testEmptyDocIdsSkipsTheQueryEntirely(): void
    {
        $db = $this->createMock(IDBConnection::class);
        $db->expects(self::never())->method('executeQuery');

        $config = new FakeConfig(
            systemValues: ['momentum_eddsa_private_key' => base64_encode(sodium_crypto_sign_secretkey(sodium_crypto_sign_keypair()))],
        );
        $tokenMinter = new TokenMinter($config, new FakeTimeFactory(1_700_000_000));
        $clientService = $this->createMock(IClientService::class);

        $pollClient = new HttpStatusPollClient($db, $clientService, $tokenMinter, $config, $this->createMock(LoggerInterface::class));

        self::assertSame([], $pollClient->getStatuses([]));
    }
}
