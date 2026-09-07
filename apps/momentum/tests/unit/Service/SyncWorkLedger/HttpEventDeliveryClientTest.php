<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Service\SyncWorkLedger;

use OCA\Momentum\Service\SyncWorkLedger\HttpEventDeliveryClient;
use OCA\Momentum\Service\TokenMinter;
use OCA\Momentum\Tests\Support\FakeConfig;
use OCA\Momentum\Tests\Support\FakeTimeFactory;
use OCP\Http\Client\IClient;
use OCP\Http\Client\IClientService;
use OCP\Http\Client\IResponse;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

final class HttpEventDeliveryClientTest extends TestCase
{
    public function testPostsToTheTenantsBackendUrlWithABearerTokenAndStripsDrainOnlyFields(): void
    {
        $keyPair = sodium_crypto_sign_keypair();
        $secretKey = sodium_crypto_sign_secretkey($keyPair);
        $publicKey = sodium_crypto_sign_publickey($keyPair);

        $config = new FakeConfig(
            systemValues: [
                'momentum_eddsa_private_key' => base64_encode($secretKey),
                'momentum_appapi_shared_secret' => 'super-secret-shared-value',
            ],
            appValues: ['momentum' => ['nc_instance_id' => '7']],
        );
        $tokenMinter = new TokenMinter($config, new FakeTimeFactory(1_700_000_000));

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(202);

        $capturedUri = null;
        $capturedOptions = null;

        $client = $this->createMock(IClient::class);
        $client->expects(self::once())->method('post')
            ->with(self::callback(function (string $uri) use (&$capturedUri) {
                $capturedUri = $uri;

                return true;
            }), self::callback(function (array $options) use (&$capturedOptions) {
                $capturedOptions = $options;

                return true;
            }))
            ->willReturn($response);

        $clientService = $this->createMock(IClientService::class);
        $clientService->method('newClient')->willReturn($client);

        $delivery = new HttpEventDeliveryClient($clientService, $tokenMinter, $config, $this->createMock(LoggerInterface::class));

        $result = $delivery->post('/internal/events', [
            'tenant_id' => 12345,
            'doc_id' => 42,
            'nc_user_id' => 'carol',
            'backend_url' => 'https://acme.example',
        ]);

        self::assertSame(202, $result->statusCode);
        self::assertSame('https://acme.example/internal/events', $capturedUri);

        self::assertSame([
            'tenant_id' => 12345,
            'doc_id' => 42,
        ], $capturedOptions['json']);

        $token = $capturedOptions['headers']['Authorization'] ?? null;
        self::assertIsString($token);
        self::assertStringStartsWith('Bearer ', $token);

        self::assertSame('super-secret-shared-value', $capturedOptions['headers']['AA-SIGNATURE'] ?? null);

        $claims = self::decodeClaims(substr($token, 7), $publicKey);
        self::assertSame(12345, $claims['tenant_id']);
        self::assertSame(7, $claims['nc_instance_id']);
        self::assertSame('carol', $claims['nc_user_id']);
    }

    public function testSendsTheConfiguredSharedSecretAsTheAaSignatureHeaderOnInternalCalls(): void
    {
        $config = new FakeConfig(
            systemValues: [
                'momentum_eddsa_private_key' => base64_encode(sodium_crypto_sign_secretkey(sodium_crypto_sign_keypair())),
                'momentum_appapi_shared_secret' => 'another-shared-secret',
            ],
        );
        $tokenMinter = new TokenMinter($config, new FakeTimeFactory(1_700_000_000));

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(202);

        $capturedOptions = null;
        $client = $this->createMock(IClient::class);
        $client->expects(self::once())->method('post')
            ->with(self::anything(), self::callback(function (array $options) use (&$capturedOptions) {
                $capturedOptions = $options;

                return true;
            }))
            ->willReturn($response);

        $clientService = $this->createMock(IClientService::class);
        $clientService->method('newClient')->willReturn($client);

        $delivery = new HttpEventDeliveryClient($clientService, $tokenMinter, $config, $this->createMock(LoggerInterface::class));
        $delivery->post('/internal/access', [
            'tenant_id' => 1,
            'nc_user_id' => 'carol',
            'backend_url' => 'https://acme.example',
        ]);

        self::assertSame('another-shared-secret', $capturedOptions['headers']['AA-SIGNATURE'] ?? null);
    }

    public function testTrailingSlashOnTheBackendUrlDoesNotProduceADoubleSlash(): void
    {
        $config = new FakeConfig(
            systemValues: ['momentum_eddsa_private_key' => base64_encode(sodium_crypto_sign_secretkey(sodium_crypto_sign_keypair()))],
        );
        $tokenMinter = new TokenMinter($config, new FakeTimeFactory(1_700_000_000));

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(202);

        $capturedUri = null;
        $client = $this->createMock(IClient::class);
        $client->method('post')
            ->with(self::callback(function (string $uri) use (&$capturedUri) {
                $capturedUri = $uri;

                return true;
            }), self::anything())
            ->willReturn($response);

        $clientService = $this->createMock(IClientService::class);
        $clientService->method('newClient')->willReturn($client);

        $delivery = new HttpEventDeliveryClient($clientService, $tokenMinter, $config, $this->createMock(LoggerInterface::class));
        $delivery->post('/internal/access', [
            'tenant_id' => 1,
            'nc_user_id' => 'carol',
            'backend_url' => 'https://acme.example/',
        ]);

        self::assertSame('https://acme.example/internal/access', $capturedUri);
    }

    public function testATransportFailureIsTreatedAsARetryableNonSuccessResponse(): void
    {
        $config = new FakeConfig(
            systemValues: ['momentum_eddsa_private_key' => base64_encode(sodium_crypto_sign_secretkey(sodium_crypto_sign_keypair()))],
        );
        $tokenMinter = new TokenMinter($config, new FakeTimeFactory(1_700_000_000));

        $client = $this->createMock(IClient::class);
        $client->method('post')->willThrowException(new \RuntimeException('connection refused'));

        $clientService = $this->createMock(IClientService::class);
        $clientService->method('newClient')->willReturn($client);

        $delivery = new HttpEventDeliveryClient($clientService, $tokenMinter, $config, $this->createMock(LoggerInterface::class));
        $result = $delivery->post('/internal/events', [
            'tenant_id' => 1,
            'nc_user_id' => 'carol',
            'backend_url' => 'https://acme.example',
        ]);

        self::assertFalse($result->isSuccess());
    }

    public function testANonSuccessResponseIsLoggedWithStatusAndBodyForDiagnostics(): void
    {
        // Mirrors the existing transport-exception branch's own diagnostic
        // logging (added 2026-07-25: "every delivery failure looked
        // identical from the ledger's attempts counter alone") — a non-2xx
        // HTTP response (http_errors => false, so no exception) previously
        // had no diagnostic at all either, confirmed live 2026-07-28: a
        // batch of `target=access` rows kept retrying with no way to tell,
        // from the ledger alone, whether the backend was rejecting them
        // with a 400/404/500 or something else entirely.
        $config = new FakeConfig(
            systemValues: ['momentum_eddsa_private_key' => base64_encode(sodium_crypto_sign_secretkey(sodium_crypto_sign_keypair()))],
        );
        $tokenMinter = new TokenMinter($config, new FakeTimeFactory(1_700_000_000));

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(404);
        $response->method('getBody')->willReturn('{"error":"document not found"}');

        $client = $this->createMock(IClient::class);
        $client->method('post')->willReturn($response);

        $clientService = $this->createMock(IClientService::class);
        $clientService->method('newClient')->willReturn($client);

        $logger = $this->createMock(LoggerInterface::class);
        $logger->expects(self::once())->method('warning')->with(
            self::stringContains('failed'),
            self::callback(function (array $context) {
                self::assertSame('/internal/access', $context['path']);
                self::assertSame(404, $context['status']);
                self::assertSame('{"error":"document not found"}', $context['body']);

                return true;
            }),
        );

        $delivery = new HttpEventDeliveryClient($clientService, $tokenMinter, $config, $logger);
        $result = $delivery->post('/internal/access', [
            'tenant_id' => 1,
            'doc_id' => 97,
            'nc_user_id' => 'carol',
            'backend_url' => 'https://acme.example',
        ]);

        self::assertSame(404, $result->statusCode);
        self::assertFalse($result->isSuccess());
    }

    /**
     * @return array<string, mixed>
     */
    private static function decodeClaims(string $token, string $publicKey): array
    {
        [$encodedHeader, $encodedPayload, $encodedSignature] = explode('.', $token);

        $signingInput = $encodedHeader . '.' . $encodedPayload;
        $signature = self::base64UrlDecode($encodedSignature);
        self::assertTrue(sodium_crypto_sign_verify_detached($signature, $signingInput, $publicKey));

        return json_decode(self::base64UrlDecode($encodedPayload), true, flags: JSON_THROW_ON_ERROR);
    }

    private static function base64UrlDecode(string $data): string
    {
        $padded = str_pad(strtr($data, '-_', '+/'), (int) (4 * ceil(strlen($data) / 4)), '=', STR_PAD_RIGHT);

        return (string) base64_decode($padded, true);
    }
}
