<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Controller;

use OCA\Momentum\Controller\DocumentTypesController;
use OCA\Momentum\Service\ApiProxy\ApiProxyService;
use OCA\Momentum\Service\TenantMapper;
use OCA\Momentum\Service\TokenMinter;
use OCA\Momentum\Tests\Support\FakeConfig;
use OCA\Momentum\Tests\Support\FakeDBConnection;
use OCA\Momentum\Tests\Support\FakeTimeFactory;
use OCP\AppFramework\Http\DataResponse;
use OCP\Http\Client\IClient;
use OCP\Http\Client\IClientService;
use OCP\Http\Client\IResponse;
use OCP\IGroupManager;
use OCP\IRequest;
use OCP\IUser;
use OCP\IUserSession;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

final class DocumentTypesControllerTest extends TestCase
{
    private const BACKEND_URL = 'https://acme.momentum.example/api';

    public function testForwardsToDocumentTypesAndRelaysTheBackendResponseVerbatim(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);

        $userSession = $this->createMock(IUserSession::class);
        $userSession->method('getUser')->willReturn($user);

        $backendResponse = $this->createMock(IResponse::class);
        $backendResponse->method('getStatusCode')->willReturn(200);
        $backendResponse->method('getBody')->willReturn('{"types":[{"type_name":"commercial_invoice"}]}');

        $capturedMethod = null;
        $capturedUri = null;

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
            )
            ->willReturn($backendResponse);

        $clientService = $this->createMock(IClientService::class);
        $clientService->method('newClient')->willReturn($client);

        $controller = new DocumentTypesController(
            'momentum',
            $this->createMock(IRequest::class),
            $userSession,
            $this->buildApiProxy($clientService),
        );

        $response = $controller->list();

        self::assertSame('GET', $capturedMethod);
        self::assertSame(self::BACKEND_URL . '/document-types', $capturedUri);
        self::assertInstanceOf(DataResponse::class, $response);
        self::assertSame(200, $response->getStatus());
        self::assertSame(['types' => [['type_name' => 'commercial_invoice']]], $response->getData());
    }

    /**
     * M83.2 (`specs/frontend.md` § Type control): the Document Viewer's
     * doc_type correction control needs the full global catalog, so the proxy
     * must forward `?scope=all` rather than dropping the query string and
     * silently downgrading the caller to the usage-scoped default.
     */
    public function testForwardsTheAllScopeQueryParamToTheBackend(): void
    {
        $capturedUri = $this->captureForwardedUri('all');

        self::assertSame(self::BACKEND_URL . '/document-types?scope=all', $capturedUri);
    }

    /**
     * Anything that is not the literal `all` (including the explicit
     * `classified`, an empty value, or a junk value) forwards no query string:
     * the backend's default already is the usage-scoped list, so the proxy
     * never relays unvalidated caller input into the backend URL.
     *
     * @dataProvider nonAllScopeProvider
     */
    public function testForwardsNoQueryStringForAnyNonAllScope(string $scope): void
    {
        $capturedUri = $this->captureForwardedUri($scope);

        self::assertSame(self::BACKEND_URL . '/document-types', $capturedUri);
    }

    /**
     * @return array<string, array{string}>
     */
    public static function nonAllScopeProvider(): array
    {
        return [
            'omitted' => [''],
            'explicit classified' => ['classified'],
            'unknown value' => ['bogus'],
            'injection attempt' => ['all&tenant_id=99'],
        ];
    }

    private function captureForwardedUri(string $scope): ?string
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);

        $userSession = $this->createMock(IUserSession::class);
        $userSession->method('getUser')->willReturn($user);

        $backendResponse = $this->createMock(IResponse::class);
        $backendResponse->method('getStatusCode')->willReturn(200);
        $backendResponse->method('getBody')->willReturn('{"types":[]}');

        $capturedUri = null;

        $client = $this->createMock(IClient::class);
        $client->expects(self::once())->method('request')
            ->with(
                self::anything(),
                self::callback(function (string $uri) use (&$capturedUri) {
                    $capturedUri = $uri;

                    return true;
                }),
            )
            ->willReturn($backendResponse);

        $clientService = $this->createMock(IClientService::class);
        $clientService->method('newClient')->willReturn($client);

        $controller = new DocumentTypesController(
            'momentum',
            $this->createMock(IRequest::class),
            $userSession,
            $this->buildApiProxy($clientService),
        );

        $controller->list($scope);

        return $capturedUri;
    }

    public function testRelaysANonSuccessStatusCodeAndBodyFromTheBackend(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);

        $userSession = $this->createMock(IUserSession::class);
        $userSession->method('getUser')->willReturn($user);

        $backendResponse = $this->createMock(IResponse::class);
        $backendResponse->method('getStatusCode')->willReturn(503);
        $backendResponse->method('getBody')->willReturn('{"error":"service unavailable"}');

        $client = $this->createMock(IClient::class);
        $client->method('request')->willReturn($backendResponse);

        $clientService = $this->createMock(IClientService::class);
        $clientService->method('newClient')->willReturn($client);

        $controller = new DocumentTypesController(
            'momentum',
            $this->createMock(IRequest::class),
            $userSession,
            $this->buildApiProxy($clientService),
        );

        $response = $controller->list();

        self::assertSame(503, $response->getStatus());
        self::assertSame(['error' => 'service unavailable'], $response->getData());
    }

    public function testReturns401WhenNoUserIsLoggedIn(): void
    {
        $userSession = $this->createMock(IUserSession::class);
        $userSession->method('getUser')->willReturn(null);

        $controller = new DocumentTypesController(
            'momentum',
            $this->createMock(IRequest::class),
            $userSession,
            $this->buildApiProxy($this->createMock(IClientService::class)),
        );

        $response = $controller->list();

        self::assertSame(401, $response->getStatus());
    }

    public function testReturns403WhenTheUserHasNoTenantMapping(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'ghost']);

        $userSession = $this->createMock(IUserSession::class);
        $userSession->method('getUser')->willReturn($user);

        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturn([]);

        $tenantMapper = new TenantMapper(new FakeDBConnection(), $groupManager, $this->createMock(LoggerInterface::class), new FakeConfig());
        $tokenMinter = new TokenMinter(
            new FakeConfig(systemValues: ['momentum_eddsa_private_key' => base64_encode(sodium_crypto_sign_secretkey(sodium_crypto_sign_keypair()))]),
            new FakeTimeFactory(1_700_000_000),
        );

        $client = $this->createMock(IClient::class);
        $client->expects(self::never())->method('request');
        $clientService = $this->createMock(IClientService::class);
        $clientService->method('newClient')->willReturn($client);

        $apiProxy = new ApiProxyService($tenantMapper, $tokenMinter, $clientService, $this->createMock(LoggerInterface::class));

        $controller = new DocumentTypesController('momentum', $this->createMock(IRequest::class), $userSession, $apiProxy);

        $response = $controller->list();

        self::assertSame(403, $response->getStatus());
    }

    private function buildApiProxy(IClientService $clientService): ApiProxyService
    {
        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturn(['acme-corp']);

        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 42, 'backend_url' => self::BACKEND_URL],
        ]);
        $tenantMapper = new TenantMapper($db, $groupManager, $this->createMock(LoggerInterface::class), new FakeConfig());

        $tokenMinter = new TokenMinter(
            new FakeConfig(systemValues: ['momentum_eddsa_private_key' => base64_encode(sodium_crypto_sign_secretkey(sodium_crypto_sign_keypair()))]),
            new FakeTimeFactory(1_700_000_000),
        );

        return new ApiProxyService($tenantMapper, $tokenMinter, $clientService, $this->createMock(LoggerInterface::class));
    }
}
