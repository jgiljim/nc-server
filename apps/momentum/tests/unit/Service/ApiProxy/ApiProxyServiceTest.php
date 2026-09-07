<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Service\ApiProxy;

use OCA\Momentum\Exception\NoTenantMappingException;
use OCA\Momentum\Exception\TokenMintingException;
use OCA\Momentum\Service\ApiProxy\ApiProxyService;
use OCA\Momentum\Service\TenantMapper;
use OCA\Momentum\Service\TokenMinter;
use OCA\Momentum\Tests\Support\FakeConfig;
use OCA\Momentum\Tests\Support\FakeDBConnection;
use OCA\Momentum\Tests\Support\FakeTimeFactory;
use OCP\Http\Client\IClient;
use OCP\Http\Client\IClientService;
use OCP\Http\Client\IResponse;
use OCP\IGroupManager;
use OCP\IUser;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

final class ApiProxyServiceTest extends TestCase
{
    private const BACKEND_URL = 'https://acme.momentum.example/api';

    public function testForwardsMethodPathAndBodyWithAMintedBearerTokenAndRelaysTheResponseVerbatim(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);

        $keyPair = sodium_crypto_sign_keypair();
        $secretKey = sodium_crypto_sign_secretkey($keyPair);
        $publicKey = sodium_crypto_sign_publickey($keyPair);

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(200);
        $response->method('getBody')->willReturn('{"documents":[]}');

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

        $service = $this->buildService($secretKey, $publicKey, $clientService);

        $result = $service->forward(
            $user,
            'get',
            '/search/documents?type_name=invoice&f=status%3Aeq%3Adone&f=direction%3Aeq%3Ainbound',
        );

        self::assertSame('GET', $capturedMethod);
        self::assertSame(
            self::BACKEND_URL . '/search/documents?type_name=invoice&f=status%3Aeq%3Adone&f=direction%3Aeq%3Ainbound',
            $capturedUri,
        );
        self::assertArrayNotHasKey('body', $capturedOptions);

        $token = $capturedOptions['headers']['Authorization'] ?? null;
        self::assertIsString($token);
        self::assertStringStartsWith('Bearer ', $token);
        self::assertTrue($this->tokenSignedBy(substr($token, 7), $publicKey));

        self::assertSame(200, $result->statusCode);
        self::assertSame('{"documents":[]}', $result->body);
    }

    public function testForwardsARequestBodyAsJson(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'bob']);
        $secretKey = sodium_crypto_sign_secretkey(sodium_crypto_sign_keypair());

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(200);
        $response->method('getBody')->willReturn('{}');

        $capturedOptions = null;
        $client = $this->createMock(IClient::class);
        $client->method('request')
            ->with(self::anything(), self::anything(), self::callback(function (array $options) use (&$capturedOptions) {
                $capturedOptions = $options;

                return true;
            }))
            ->willReturn($response);

        $clientService = $this->createMock(IClientService::class);
        $clientService->method('newClient')->willReturn($client);

        $service = $this->buildService($secretKey, sodium_crypto_sign_publickey(sodium_crypto_sign_keypair()), $clientService);

        $service->forward($user, 'patch', '/documents/42/fields', '{"invoice_number":"INV-1"}');

        self::assertSame('{"invoice_number":"INV-1"}', $capturedOptions['body']);
        self::assertSame('application/json', $capturedOptions['headers']['Content-Type'] ?? null);
    }

    public function testRelaysANonSuccessStatusCodeAndBodyVerbatim(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'carol']);
        $secretKey = sodium_crypto_sign_secretkey(sodium_crypto_sign_keypair());

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(422);
        $response->method('getBody')->willReturn('{"error":"unknown field \"bogus\""}');

        $client = $this->createMock(IClient::class);
        $client->method('request')->willReturn($response);

        $clientService = $this->createMock(IClientService::class);
        $clientService->method('newClient')->willReturn($client);

        $service = $this->buildService($secretKey, sodium_crypto_sign_publickey(sodium_crypto_sign_keypair()), $clientService);

        $result = $service->forward($user, 'patch', '/documents/42/fields', '{"bogus":true}');

        self::assertSame(422, $result->statusCode);
        self::assertSame('{"error":"unknown field \"bogus\""}', $result->body);
    }

    public function testATransportFailureIsRelayedAsASynthetic502(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'dave']);
        $secretKey = sodium_crypto_sign_secretkey(sodium_crypto_sign_keypair());

        $client = $this->createMock(IClient::class);
        $client->method('request')->willThrowException(new \RuntimeException('connection refused'));

        $clientService = $this->createMock(IClientService::class);
        $clientService->method('newClient')->willReturn($client);

        $service = $this->buildService($secretKey, sodium_crypto_sign_publickey(sodium_crypto_sign_keypair()), $clientService, $this->createMock(LoggerInterface::class));

        $result = $service->forward($user, 'get', '/document-types');

        self::assertSame(502, $result->statusCode);
    }

    public function testPropagatesNoTenantMappingExceptionRatherThanCallingTheBackend(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'erin']);
        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturn([]);

        $tenantMapper = new TenantMapper(new FakeDBConnection(), $groupManager, $this->createMock(LoggerInterface::class), new FakeConfig());
        $tokenMinter = new TokenMinter(new FakeConfig(['momentum_eddsa_private_key' => base64_encode(sodium_crypto_sign_secretkey(sodium_crypto_sign_keypair()))]), new FakeTimeFactory(1_700_000_000));

        $client = $this->createMock(IClient::class);
        $client->expects(self::never())->method('request');
        $clientService = $this->createMock(IClientService::class);
        $clientService->method('newClient')->willReturn($client);

        $service = new ApiProxyService($tenantMapper, $tokenMinter, $clientService, $this->createMock(LoggerInterface::class));

        $this->expectException(NoTenantMappingException::class);
        $service->forward($user, 'get', '/document-types');
    }

    public function testPropagatesTokenMintingExceptionRatherThanCallingTheBackend(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'frank']);
        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturn(['acme-corp']);

        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 1, 'backend_url' => self::BACKEND_URL],
        ]);
        $tenantMapper = new TenantMapper($db, $groupManager, $this->createMock(LoggerInterface::class), new FakeConfig());
        $tokenMinter = new TokenMinter(new FakeConfig(), new FakeTimeFactory(1_700_000_000));

        $client = $this->createMock(IClient::class);
        $client->expects(self::never())->method('request');
        $clientService = $this->createMock(IClientService::class);
        $clientService->method('newClient')->willReturn($client);

        $service = new ApiProxyService($tenantMapper, $tokenMinter, $clientService, $this->createMock(LoggerInterface::class));

        $this->expectException(TokenMintingException::class);
        $service->forward($user, 'get', '/document-types');
    }

    private function buildService(
        string $secretKey,
        string $publicKey,
        IClientService $clientService,
        ?LoggerInterface $logger = null,
    ): ApiProxyService {
        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturn(['acme-corp']);

        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 42, 'backend_url' => self::BACKEND_URL],
        ]);
        $tenantMapper = new TenantMapper($db, $groupManager, $this->createMock(LoggerInterface::class), new FakeConfig());

        $tokenMinter = new TokenMinter(
            new FakeConfig(systemValues: ['momentum_eddsa_private_key' => base64_encode($secretKey)]),
            new FakeTimeFactory(1_700_000_000),
        );

        return new ApiProxyService($tenantMapper, $tokenMinter, $clientService, $logger ?? $this->createMock(LoggerInterface::class));
    }

    private function tokenSignedBy(string $token, string $publicKey): bool
    {
        [$encodedHeader, $encodedPayload, $encodedSignature] = explode('.', $token);
        $signingInput = $encodedHeader . '.' . $encodedPayload;
        $padded = str_pad(strtr($encodedSignature, '-_', '+/'), (int) (4 * ceil(strlen($encodedSignature) / 4)), '=', STR_PAD_RIGHT);
        $signature = (string) base64_decode($padded, true);

        return sodium_crypto_sign_verify_detached($signature, $signingInput, $publicKey);
    }
}
