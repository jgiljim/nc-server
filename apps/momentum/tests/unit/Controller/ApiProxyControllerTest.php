<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Controller;

use OCA\Momentum\Controller\ApiProxyController;
use OCA\Momentum\Service\ApiProxy\ApiProxyService;
use OCA\Momentum\Service\SyncWorkLedger\LedgerRearmer;
use OCA\Momentum\Service\TenantMapper;
use OCA\Momentum\Service\TokenMinter;
use OCA\Momentum\Tests\Support\FakeConfig;
use OCA\Momentum\Tests\Support\FakeDBConnection;
use OCA\Momentum\Tests\Support\FakeSyncWorkLedgerRepository;
use OCA\Momentum\Tests\Support\FakeTimeFactory;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\DataDisplayResponse;
use OCP\AppFramework\Http\DataResponse;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\Http\Client\IClient;
use OCP\Http\Client\IClientService;
use OCP\Http\Client\IResponse;
use OCP\IGroupManager;
use OCP\IRequest;
use OCP\IUser;
use OCP\IUserSession;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;
use ReflectionAttribute;
use ReflectionMethod;

final class ApiProxyControllerTest extends TestCase
{
    private const BACKEND_URL = 'https://acme.momentum.example/api';

    /**
     * G66 item 1 regression guard: the mutating proxy routes forward a JSON
     * body over an authenticated, same-origin NC session, so classic
     * form-based CSRF (the threat `#[NoCSRFRequired]` opts out of) still
     * applies to them - there's no cross-origin preflight involved that
     * would make the attribute necessary here. Only the read-only routes
     * (which cannot mutate state) keep it.
     */
    public function testMutatingRoutesRequireCsrfProtection(): void
    {
        foreach (['patchDocument', 'patchDocumentFields', 'reprocessDocument'] as $method) {
            $attributeNames = array_map(
                static fn (ReflectionAttribute $attribute): string => $attribute->getName(),
                (new ReflectionMethod(ApiProxyController::class, $method))->getAttributes(),
            );

            self::assertNotContains(NoCSRFRequired::class, $attributeNames, "$method must not opt out of CSRF protection");
        }
    }

    protected function tearDown(): void
    {
        // searchDocuments() reads $_SERVER['QUERY_STRING'] directly (IRequest
        // has no getServerParams() method, and IRequest::server is a
        // docblock-only magic property on the concrete Request class, not
        // mockable through createMock(IRequest::class)) - reset it so one
        // test's value can never leak into another.
        unset($_SERVER['QUERY_STRING']);
    }

    /**
     * M127.2, `specs/api.md` § `GET /documents/by-file/{file_id}`: the file
     * browser has nothing but a Nextcloud fileId on a row click, so this is
     * the route that turns it into a document. The id is a bare integer in the
     * path, not a UUID — and it must reach the backend as one.
     */
    public function testGetDocumentByFileForwardsTheFileIdToTheBackend(): void
    {
        $capturedUri = null;
        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(200);
        $response->method('getBody')->willReturn('{"public_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}');

        $client = $this->createMock(IClient::class);
        $client->expects(self::once())->method('request')
            ->with(
                self::identicalTo('GET'),
                self::callback(function (string $uri) use (&$capturedUri) {
                    $capturedUri = $uri;

                    return true;
                }),
                self::anything(),
            )
            ->willReturn($response);

        $controller = $this->buildController(
            $client,
            $this->createConfiguredMock(IUserSession::class, [
                'getUser' => $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']),
            ]),
        );

        $result = $controller->getDocumentByFile('110');

        self::assertSame(self::BACKEND_URL . '/documents/by-file/110', $capturedUri);
        self::assertSame(200, $result->getStatus());
    }

    /**
     * A 404 is the EXPECTED answer for most files (never ingested, or still
     * pending), so it must reach the page as a 404 for it to fall back on —
     * never turned into a 500 or an empty 200.
     */
    public function testGetDocumentByFilePassesA404StraightThrough(): void
    {
        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(404);
        $response->method('getBody')->willReturn('{"error":"document not found"}');

        $client = $this->createMock(IClient::class);
        $client->method('request')->willReturn($response);

        $controller = $this->buildController(
            $client,
            $this->createConfiguredMock(IUserSession::class, [
                'getUser' => $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']),
            ]),
        );

        $result = $controller->getDocumentByFile('110');

        self::assertSame(404, $result->getStatus());
    }

    /**
     * Path-injection guard: whatever arrives in the route parameter is encoded
     * before it becomes part of the upstream path, so a crafted id cannot
     * reach a different backend endpoint.
     */
    public function testGetDocumentByFileEncodesTheRouteParameter(): void
    {
        $capturedUri = null;
        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(404);
        $response->method('getBody')->willReturn('{}');

        $client = $this->createMock(IClient::class);
        $client->method('request')->willReturnCallback(
            function (string $method, string $uri) use (&$capturedUri, $response): IResponse {
                $capturedUri = $uri;

                return $response;
            },
        );

        $controller = $this->buildController(
            $client,
            $this->createConfiguredMock(IUserSession::class, [
                'getUser' => $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']),
            ]),
        );

        $controller->getDocumentByFile('110/../search/documents');

        self::assertSame(
            self::BACKEND_URL . '/documents/by-file/110%2F..%2Fsearch%2Fdocuments',
            $capturedUri,
        );
    }

    public function testGetDocumentForwardsToTheBackendAndRelaysTheResponseVerbatim(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $capturedMethod = null;
        $capturedUri = null;

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(200);
        $response->method('getBody')->willReturn('{"id":"42"}');

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
                self::anything(),
            )
            ->willReturn($response);

        $controller = $this->buildController($client, $userSession);

        $result = $controller->getDocument('42');

        self::assertSame('GET', $capturedMethod);
        self::assertSame(self::BACKEND_URL . '/documents/42', $capturedUri);
        self::assertInstanceOf(DataDisplayResponse::class, $result);
        self::assertSame(200, $result->getStatus());
        self::assertSame('{"id":"42"}', $result->render());
        self::assertSame('application/json', $result->getHeaders()['Content-Type'] ?? null);
    }

    public function testGetDocumentUrlEncodesTheDocumentIdInTheForwardedPath(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $capturedUri = null;

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(200);
        $response->method('getBody')->willReturn('{}');

        $client = $this->createMock(IClient::class);
        $client->method('request')
            ->with(self::anything(), self::callback(function (string $uri) use (&$capturedUri) {
                $capturedUri = $uri;

                return true;
            }), self::anything())
            ->willReturn($response);

        $controller = $this->buildController($client, $userSession);
        $controller->getDocument('some/id');

        self::assertSame(self::BACKEND_URL . '/documents/some%2Fid', $capturedUri);
    }

    public function testGetDocumentRelaysANonSuccessStatusCodeAndBodyVerbatim(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(404);
        $response->method('getBody')->willReturn('{"error":"not_found"}');

        $client = $this->createMock(IClient::class);
        $client->method('request')->willReturn($response);

        $controller = $this->buildController($client, $userSession);
        $result = $controller->getDocument('42');

        self::assertSame(404, $result->getStatus());
        self::assertSame('{"error":"not_found"}', $result->render());
    }

    public function testPatchDocumentFieldsForwardsTheBodyAndRelaysTheResponseVerbatim(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $capturedMethod = null;
        $capturedUri = null;
        $capturedOptions = null;

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(200);
        $response->method('getBody')->willReturn('{"invoice_number":"INV-2026-001-CORRECTED"}');

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

        $controller = $this->buildController(
            $client,
            $userSession,
            requestBody: '{"invoice_number":"INV-2026-001-CORRECTED"}',
        );

        $result = $controller->patchDocumentFields('42');

        self::assertSame('PATCH', $capturedMethod);
        self::assertSame(self::BACKEND_URL . '/documents/42/fields', $capturedUri);
        self::assertSame('{"invoice_number":"INV-2026-001-CORRECTED"}', $capturedOptions['body'] ?? null);
        self::assertInstanceOf(DataDisplayResponse::class, $result);
        self::assertSame(200, $result->getStatus());
        self::assertSame('{"invoice_number":"INV-2026-001-CORRECTED"}', $result->render());
    }

    public function testPatchDocumentFieldsUrlEncodesTheDocumentIdInTheForwardedPath(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $capturedUri = null;

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(200);
        $response->method('getBody')->willReturn('{}');

        $client = $this->createMock(IClient::class);
        $client->method('request')
            ->with(self::anything(), self::callback(function (string $uri) use (&$capturedUri) {
                $capturedUri = $uri;

                return true;
            }), self::anything())
            ->willReturn($response);

        $controller = $this->buildController($client, $userSession, requestBody: '{}');
        $controller->patchDocumentFields('some/id');

        self::assertSame(self::BACKEND_URL . '/documents/some%2Fid/fields', $capturedUri);
    }

    public function testGetDocumentReturns401WhenNoUserIsLoggedIn(): void
    {
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => null]);

        $client = $this->createMock(IClient::class);
        $client->expects(self::never())->method('request');

        $controller = $this->buildController($client, $userSession);
        $result = $controller->getDocument('42');

        self::assertInstanceOf(DataResponse::class, $result);
        self::assertSame(401, $result->getStatus());
    }

    public function testGetDocumentReturns403WhenTheUserHasNoTenantMapping(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'ghost']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturn([]);

        $client = $this->createMock(IClient::class);
        $client->expects(self::never())->method('request');

        $controller = $this->buildController($client, $userSession, $groupManager);
        $result = $controller->getDocument('42');

        self::assertInstanceOf(DataResponse::class, $result);
        self::assertSame(403, $result->getStatus());
    }

    public function testGetDocumentReturns500WhenTheUserHasAnAmbiguousTenantMapping(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'ambiguous']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturn(['acme-corp', 'globex-corp']);

        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 1, 'backend_url' => self::BACKEND_URL],
            ['user_group_id' => 'globex-corp', 'tenant_id' => 2, 'backend_url' => self::BACKEND_URL],
        ]);

        $client = $this->createMock(IClient::class);
        $client->expects(self::never())->method('request');

        $controller = $this->buildController($client, $userSession, $groupManager, $db);
        $result = $controller->getDocument('42');

        self::assertInstanceOf(DataResponse::class, $result);
        self::assertSame(500, $result->getStatus());
    }

    public function testGetDocumentReturns500WhenTokenMintingFails(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'nokey']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $client = $this->createMock(IClient::class);
        $client->expects(self::never())->method('request');

        $controller = $this->buildController($client, $userSession, null, null, new FakeConfig());
        $result = $controller->getDocument('42');

        self::assertInstanceOf(DataResponse::class, $result);
        self::assertSame(500, $result->getStatus());
    }

    public function testGetDocumentTypeSchemaForwardsToTheBackendAndRelaysTheResponseVerbatim(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $capturedMethod = null;
        $capturedUri = null;

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(200);
        $response->method('getBody')->willReturn('{"fields":[]}');

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
                self::anything(),
            )
            ->willReturn($response);

        $controller = $this->buildController($client, $userSession);

        $result = $controller->getDocumentTypeSchema('commercial_invoice');

        self::assertSame('GET', $capturedMethod);
        self::assertSame(self::BACKEND_URL . '/document-types/commercial_invoice/schema', $capturedUri);
        self::assertInstanceOf(DataDisplayResponse::class, $result);
        self::assertSame(200, $result->getStatus());
        self::assertSame('{"fields":[]}', $result->render());
        self::assertSame('application/json', $result->getHeaders()['Content-Type'] ?? null);
    }

    public function testGetDocumentTypeSchemaUrlEncodesTheTypeNameInTheForwardedPath(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $capturedUri = null;

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(200);
        $response->method('getBody')->willReturn('{}');

        $client = $this->createMock(IClient::class);
        $client->method('request')
            ->with(self::anything(), self::callback(function (string $uri) use (&$capturedUri) {
                $capturedUri = $uri;

                return true;
            }), self::anything())
            ->willReturn($response);

        $controller = $this->buildController($client, $userSession);
        $controller->getDocumentTypeSchema('some/type');

        self::assertSame(self::BACKEND_URL . '/document-types/some%2Ftype/schema', $capturedUri);
    }

    public function testGetDocumentTypeSchemaRelaysANonSuccessStatusCodeAndBodyVerbatim(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(404);
        $response->method('getBody')->willReturn('{"error":"not_found"}');

        $client = $this->createMock(IClient::class);
        $client->method('request')->willReturn($response);

        $controller = $this->buildController($client, $userSession);
        $result = $controller->getDocumentTypeSchema('commercial_invoice');

        self::assertSame(404, $result->getStatus());
        self::assertSame('{"error":"not_found"}', $result->render());
    }

    public function testGetDocumentTypeSchemaReturns401WhenNoUserIsLoggedIn(): void
    {
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => null]);

        $client = $this->createMock(IClient::class);
        $client->expects(self::never())->method('request');

        $controller = $this->buildController($client, $userSession);
        $result = $controller->getDocumentTypeSchema('commercial_invoice');

        self::assertInstanceOf(DataResponse::class, $result);
        self::assertSame(401, $result->getStatus());
    }

    public function testGetDocumentTypeSchemaReturns403WhenTheUserHasNoTenantMapping(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'ghost']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturn([]);

        $client = $this->createMock(IClient::class);
        $client->expects(self::never())->method('request');

        $controller = $this->buildController($client, $userSession, $groupManager);
        $result = $controller->getDocumentTypeSchema('commercial_invoice');

        self::assertInstanceOf(DataResponse::class, $result);
        self::assertSame(403, $result->getStatus());
    }

    public function testGetDocumentTypeSchemaReturns500WhenTheUserHasAnAmbiguousTenantMapping(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'ambiguous']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturn(['acme-corp', 'globex-corp']);

        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 1, 'backend_url' => self::BACKEND_URL],
            ['user_group_id' => 'globex-corp', 'tenant_id' => 2, 'backend_url' => self::BACKEND_URL],
        ]);

        $client = $this->createMock(IClient::class);
        $client->expects(self::never())->method('request');

        $controller = $this->buildController($client, $userSession, $groupManager, $db);
        $result = $controller->getDocumentTypeSchema('commercial_invoice');

        self::assertInstanceOf(DataResponse::class, $result);
        self::assertSame(500, $result->getStatus());
    }

    public function testGetDocumentTypeSchemaReturns500WhenTokenMintingFails(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'nokey']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $client = $this->createMock(IClient::class);
        $client->expects(self::never())->method('request');

        $controller = $this->buildController($client, $userSession, null, null, new FakeConfig());
        $result = $controller->getDocumentTypeSchema('commercial_invoice');

        self::assertInstanceOf(DataResponse::class, $result);
        self::assertSame(500, $result->getStatus());
    }

    public function testSearchDocumentsForwardsTheRawQueryStringUnchanged(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        // Repeated `f` filter params (documents.ts's buildSearchQuery) — the
        // whole point of M20.8 is that these survive the hop unreordered and
        // uncollapsed, which a parsed-$_GET representation cannot guarantee.
        $rawQueryString = 'type_name=invoice&sort=created_at%3Adesc&f=status%3Aeq%3Adone&f=reviewed%3Aeq%3Atrue&cursor=abc';
        $_SERVER['QUERY_STRING'] = $rawQueryString;

        $capturedUri = null;

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(200);
        $response->method('getBody')->willReturn('{"items":[]}');

        $client = $this->createMock(IClient::class);
        $client->method('request')
            ->with(self::anything(), self::callback(function (string $uri) use (&$capturedUri) {
                $capturedUri = $uri;

                return true;
            }), self::anything())
            ->willReturn($response);

        $controller = $this->buildController($client, $userSession);
        $result = $controller->searchDocuments();

        self::assertSame(self::BACKEND_URL . '/search/documents?' . $rawQueryString, $capturedUri);
        self::assertInstanceOf(DataDisplayResponse::class, $result);
        self::assertSame(200, $result->getStatus());
        self::assertSame('{"items":[]}', $result->render());
    }

    /**
     * M20.5, `specs/api.md` § `PATCH /documents/{id}` — an RFC 7396 merge
     * patch, so the request body must reach the backend byte-for-byte
     * (a re-encoded body could drop or reorder keys and change which
     * fields the backend treats as "being changed").
     */
    public function testPatchDocumentForwardsTheRawRequestBodyVerbatim(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $capturedMethod = null;
        $capturedUri = null;
        $capturedOptions = null;

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(204);
        $response->method('getBody')->willReturn('');

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

        $controller = $this->buildController(
            $client,
            $userSession,
            requestBody: '{"reviewed":true,"direction":"inbound"}',
        );

        $result = $controller->patchDocument('42');

        self::assertSame('PATCH', $capturedMethod);
        self::assertSame(self::BACKEND_URL . '/documents/42', $capturedUri);
        self::assertSame('{"reviewed":true,"direction":"inbound"}', $capturedOptions['body'] ?? null);
        self::assertSame('application/json', $capturedOptions['headers']['Content-Type'] ?? null);
        self::assertInstanceOf(DataDisplayResponse::class, $result);
        self::assertSame(204, $result->getStatus());
        self::assertSame('', $result->render());
    }

    public function testSearchDocumentsForwardsWithNoQueryStringWhenEmpty(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $capturedUri = null;

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(200);
        $response->method('getBody')->willReturn('{"items":[]}');

        $client = $this->createMock(IClient::class);
        $client->method('request')
            ->with(self::anything(), self::callback(function (string $uri) use (&$capturedUri) {
                $capturedUri = $uri;

                return true;
            }), self::anything())
            ->willReturn($response);

        $controller = $this->buildController($client, $userSession);
        $controller->searchDocuments();

        self::assertSame(self::BACKEND_URL . '/search/documents', $capturedUri);
    }

    public function testPatchDocumentUrlEncodesTheDocumentIdInTheForwardedPath(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $capturedUri = null;

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(204);
        $response->method('getBody')->willReturn('');

        $client = $this->createMock(IClient::class);
        $client->method('request')
            ->with(self::anything(), self::callback(function (string $uri) use (&$capturedUri) {
                $capturedUri = $uri;

                return true;
            }), self::anything())
            ->willReturn($response);

        $controller = $this->buildController($client, $userSession, requestBody: '{"reviewed":true}');
        $controller->patchDocument('some/id');

        self::assertSame(self::BACKEND_URL . '/documents/some%2Fid', $capturedUri);
    }

    /**
     * `specs/api.md` § `PATCH /documents/{id}`: `422` on an invalid
     * `direction` value — the error body has to survive the proxy hop for
     * the frontend to report anything useful.
     */
    public function testPatchDocumentRelaysANonSuccessStatusCodeAndBodyVerbatim(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(422);
        $response->method('getBody')->willReturn('{"error":"invalid_direction"}');

        $client = $this->createMock(IClient::class);
        $client->method('request')->willReturn($response);

        $controller = $this->buildController($client, $userSession, requestBody: '{"direction":"sideways"}');
        $result = $controller->patchDocument('42');

        self::assertSame(422, $result->getStatus());
        self::assertSame('{"error":"invalid_direction"}', $result->render());
    }

    public function testPatchDocumentReturns401WhenNoUserIsLoggedIn(): void
    {
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => null]);

        $client = $this->createMock(IClient::class);
        $client->expects(self::never())->method('request');

        $controller = $this->buildController($client, $userSession, requestBody: '{"reviewed":true}');
        $result = $controller->patchDocument('42');

        self::assertInstanceOf(DataResponse::class, $result);
        self::assertSame(401, $result->getStatus());
    }

    public function testSearchDocumentsReturns401WhenNoUserIsLoggedIn(): void
    {
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => null]);

        $client = $this->createMock(IClient::class);
        $client->expects(self::never())->method('request');

        $controller = $this->buildController($client, $userSession);
        $result = $controller->searchDocuments();

        self::assertInstanceOf(DataResponse::class, $result);
        self::assertSame(401, $result->getStatus());
    }

    public function testSearchDocumentsRelaysANonSuccessStatusCodeAndBodyVerbatim(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $_SERVER['QUERY_STRING'] = 'f=status%3Aeq%3Adone%3Aextra';

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(400);
        $response->method('getBody')->willReturn('{"error":"invalid_filter"}');

        $client = $this->createMock(IClient::class);
        $client->method('request')->willReturn($response);

        $controller = $this->buildController($client, $userSession);
        $result = $controller->searchDocuments();

        self::assertSame(400, $result->getStatus());
        self::assertSame('{"error":"invalid_filter"}', $result->render());
    }

    public function testGetStatsOverviewForwardsToTheBackendAndRelaysTheResponseVerbatim(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $capturedMethod = null;
        $capturedUri = null;

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(200);
        $response->method('getBody')->willReturn('{"types":[]}');

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
                self::anything(),
            )
            ->willReturn($response);

        $controller = $this->buildController($client, $userSession);

        $result = $controller->getStatsOverview();

        self::assertSame('GET', $capturedMethod);
        self::assertSame(self::BACKEND_URL . '/stats/overview', $capturedUri);
        self::assertInstanceOf(DataDisplayResponse::class, $result);
        self::assertSame(200, $result->getStatus());
        self::assertSame('{"types":[]}', $result->render());
        self::assertSame('application/json', $result->getHeaders()['Content-Type'] ?? null);
    }

    public function testGetStatsOverviewRelaysANonSuccessStatusCodeAndBodyVerbatim(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(500);
        $response->method('getBody')->willReturn('{"error":"internal"}');

        $client = $this->createMock(IClient::class);
        $client->method('request')->willReturn($response);

        $controller = $this->buildController($client, $userSession);
        $result = $controller->getStatsOverview();

        self::assertSame(500, $result->getStatus());
        self::assertSame('{"error":"internal"}', $result->render());
    }

    public function testGetStatsOverviewReturns401WhenNoUserIsLoggedIn(): void
    {
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => null]);

        $client = $this->createMock(IClient::class);
        $client->expects(self::never())->method('request');

        $controller = $this->buildController($client, $userSession);
        $result = $controller->getStatsOverview();

        self::assertInstanceOf(DataResponse::class, $result);
        self::assertSame(401, $result->getStatus());
    }

    public function testGetStatsOverviewReturns403WhenTheUserHasNoTenantMapping(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'ghost']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturn([]);

        $client = $this->createMock(IClient::class);
        $client->expects(self::never())->method('request');

        $controller = $this->buildController($client, $userSession, $groupManager);
        $result = $controller->getStatsOverview();

        self::assertInstanceOf(DataResponse::class, $result);
        self::assertSame(403, $result->getStatus());
    }

    public function testGetStatsOverviewReturns500WhenTheUserHasAnAmbiguousTenantMapping(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'ambiguous']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturn(['acme-corp', 'globex-corp']);

        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 1, 'backend_url' => self::BACKEND_URL],
            ['user_group_id' => 'globex-corp', 'tenant_id' => 2, 'backend_url' => self::BACKEND_URL],
        ]);

        $client = $this->createMock(IClient::class);
        $client->expects(self::never())->method('request');

        $controller = $this->buildController($client, $userSession, $groupManager, $db);
        $result = $controller->getStatsOverview();

        self::assertInstanceOf(DataResponse::class, $result);
        self::assertSame(500, $result->getStatus());
    }

    public function testGetStatsOverviewReturns500WhenTokenMintingFails(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'nokey']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $client = $this->createMock(IClient::class);
        $client->expects(self::never())->method('request');

        $controller = $this->buildController($client, $userSession, null, null, new FakeConfig());
        $result = $controller->getStatsOverview();

        self::assertInstanceOf(DataResponse::class, $result);
        self::assertSame(500, $result->getStatus());
    }

    public function testReprocessDocumentForwardsToTheBackendAndRelaysTheResponseVerbatim(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        /** @var list<array{0: string, 1: string}> $calls */
        $calls = [];

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(202);
        $response->method('getBody')->willReturn('{"status":"pending"}');

        $client = $this->createMock(IClient::class);
        // Two calls: the reprocess POST itself, then the M68.6 re-arm path's
        // own GET /documents/{id} fetch of `path` (both hit the same
        // backend, so both go through this one mocked client).
        $client->expects(self::exactly(2))->method('request')
            ->with(
                self::callback(function (string $method) use (&$calls) {
                    $calls[count($calls)][0] = $method;

                    return true;
                }),
                self::callback(function (string $uri) use (&$calls) {
                    $calls[count($calls) - 1][1] = $uri;

                    return true;
                }),
                self::anything(),
            )
            ->willReturn($response);

        $controller = $this->buildController($client, $userSession);

        $result = $controller->reprocessDocument('42');

        self::assertSame(['POST', self::BACKEND_URL . '/documents/42/reprocess'], $calls[0]);
        self::assertSame(['GET', self::BACKEND_URL . '/documents/42'], $calls[1]);
        self::assertInstanceOf(DataDisplayResponse::class, $result);
        self::assertSame(202, $result->getStatus());
        self::assertSame('{"status":"pending"}', $result->render());
        self::assertSame('application/json', $result->getHeaders()['Content-Type'] ?? null);
    }

    public function testReprocessDocumentUrlEncodesTheDocumentIdInTheForwardedPath(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        /** @var list<string> $capturedUris */
        $capturedUris = [];

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(202);
        $response->method('getBody')->willReturn('{}');

        $client = $this->createMock(IClient::class);
        $client->method('request')
            ->with(self::anything(), self::callback(function (string $uri) use (&$capturedUris) {
                $capturedUris[] = $uri;

                return true;
            }), self::anything())
            ->willReturn($response);

        $controller = $this->buildController($client, $userSession);
        $controller->reprocessDocument('some/id');

        self::assertSame(self::BACKEND_URL . '/documents/some%2Fid/reprocess', $capturedUris[0] ?? null);
    }

    public function testReprocessDocumentRelaysANonSuccessStatusCodeAndBodyVerbatim(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $response = $this->createMock(IResponse::class);
        $response->method('getStatusCode')->willReturn(429);
        $response->method('getBody')->willReturn('{"error":"rate_limited"}');

        $client = $this->createMock(IClient::class);
        $client->method('request')->willReturn($response);

        $controller = $this->buildController($client, $userSession);
        $result = $controller->reprocessDocument('42');

        self::assertSame(429, $result->getStatus());
        self::assertSame('{"error":"rate_limited"}', $result->render());
    }

    public function testReprocessDocumentReturns401WhenNoUserIsLoggedIn(): void
    {
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => null]);

        $client = $this->createMock(IClient::class);
        $client->expects(self::never())->method('request');

        $controller = $this->buildController($client, $userSession);
        $result = $controller->reprocessDocument('42');

        self::assertInstanceOf(DataResponse::class, $result);
        self::assertSame(401, $result->getStatus());
    }

    public function testReprocessDocumentReturns403WhenTheUserHasNoTenantMapping(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'ghost']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturn([]);

        $client = $this->createMock(IClient::class);
        $client->expects(self::never())->method('request');

        $controller = $this->buildController($client, $userSession, $groupManager);
        $result = $controller->reprocessDocument('42');

        self::assertInstanceOf(DataResponse::class, $result);
        self::assertSame(403, $result->getStatus());
    }

    public function testReprocessDocumentReturns500WhenTheUserHasAnAmbiguousTenantMapping(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'ambiguous']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturn(['acme-corp', 'globex-corp']);

        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 1, 'backend_url' => self::BACKEND_URL],
            ['user_group_id' => 'globex-corp', 'tenant_id' => 2, 'backend_url' => self::BACKEND_URL],
        ]);

        $client = $this->createMock(IClient::class);
        $client->expects(self::never())->method('request');

        $controller = $this->buildController($client, $userSession, $groupManager, $db);
        $result = $controller->reprocessDocument('42');

        self::assertInstanceOf(DataResponse::class, $result);
        self::assertSame(500, $result->getStatus());
    }

    public function testReprocessDocumentReturns500WhenTokenMintingFails(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'nokey']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $client = $this->createMock(IClient::class);
        $client->expects(self::never())->method('request');

        $controller = $this->buildController($client, $userSession, null, null, new FakeConfig());
        $result = $controller->reprocessDocument('42');

        self::assertInstanceOf(DataResponse::class, $result);
        self::assertSame(500, $result->getStatus());
    }

    /**
     * M68.6: a `202` from `reprocessDocument()` re-arms the document's
     * sync-work ledger row, resolved via a follow-up `GET /documents/{id}`
     * fetch of `path` and the acting user's own Nextcloud folder.
     */
    public function testReprocessDocumentRearmsTheSyncWorkLedgerRowOnAccepted(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $reprocessResponse = $this->createMock(IResponse::class);
        $reprocessResponse->method('getStatusCode')->willReturn(202);
        $reprocessResponse->method('getBody')->willReturn('{"status":"pending"}');

        $getResponse = $this->createMock(IResponse::class);
        $getResponse->method('getStatusCode')->willReturn(200);
        $getResponse->method('getBody')->willReturn('{"path":"/Invoices/acme.pdf"}');

        $client = $this->createMock(IClient::class);
        $client->method('request')->willReturnCallback(
            fn (string $method) => $method === 'POST' ? $reprocessResponse : $getResponse,
        );

        $node = $this->createMock(File::class);
        $node->method('getId')->willReturn(99);
        $node->method('getMimetype')->willReturn('application/pdf');
        $node->method('getPath')->willReturn('/alice/files/Invoices/acme.pdf');
        $node->method('getEtag')->willReturn('etag-1');
        $node->method('getMTime')->willReturn(1_700_000_000);
        $node->method('getOwner')->willReturn($user);

        $userFolder = $this->createMock(Folder::class);
        $userFolder->method('get')->with('/Invoices/acme.pdf')->willReturn($node);

        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getUserFolder')->with('alice')->willReturn($userFolder);

        $ledgerRepo = new FakeSyncWorkLedgerRepository();

        $controller = $this->buildController(
            $client,
            $userSession,
            rootFolder: $rootFolder,
            ledgerRepo: $ledgerRepo,
        );

        $controller->reprocessDocument('some-public-id');

        self::assertCount(1, $ledgerRepo->rearmed);
        self::assertSame(99, $ledgerRepo->rearmed[0]['docId']);
    }

    /**
     * M68.6: `patchDocument()`'s `doc_type` branch takes the identical
     * re-arm path as `reprocessDocument()` — a non-`doc_type` patch (204)
     * never triggers it, which the other `patchDocument` tests already
     * cover by never configuring a ledger repo.
     */
    public function testPatchDocumentRearmsTheSyncWorkLedgerRowOnAccepted(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $patchResponse = $this->createMock(IResponse::class);
        $patchResponse->method('getStatusCode')->willReturn(202);
        $patchResponse->method('getBody')->willReturn('');

        $getResponse = $this->createMock(IResponse::class);
        $getResponse->method('getStatusCode')->willReturn(200);
        $getResponse->method('getBody')->willReturn('{"path":"/Invoices/acme.pdf"}');

        $client = $this->createMock(IClient::class);
        $client->method('request')->willReturnCallback(
            fn (string $method) => $method === 'PATCH' ? $patchResponse : $getResponse,
        );

        $node = $this->createMock(File::class);
        $node->method('getId')->willReturn(99);
        $node->method('getMimetype')->willReturn('application/pdf');
        $node->method('getPath')->willReturn('/alice/files/Invoices/acme.pdf');
        $node->method('getEtag')->willReturn('etag-1');
        $node->method('getMTime')->willReturn(1_700_000_000);
        $node->method('getOwner')->willReturn($user);

        $userFolder = $this->createMock(Folder::class);
        $userFolder->method('get')->with('/Invoices/acme.pdf')->willReturn($node);

        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getUserFolder')->with('alice')->willReturn($userFolder);

        $ledgerRepo = new FakeSyncWorkLedgerRepository();

        $controller = $this->buildController(
            $client,
            $userSession,
            rootFolder: $rootFolder,
            ledgerRepo: $ledgerRepo,
            requestBody: '{"doc_type":"commercial_invoice"}',
        );

        $controller->patchDocument('some-public-id');

        self::assertCount(1, $ledgerRepo->rearmed);
        self::assertSame(99, $ledgerRepo->rearmed[0]['docId']);
    }

    /**
     * M68.6: a `202` whose follow-up `GET /documents/{id}` fails (or the
     * body doesn't decode to a usable `path`) never crashes the response
     * already computed for the original caller — it's a best-effort side
     * effect, not part of the request's own outcome.
     */
    public function testReprocessDocumentStillReturnsTheAcceptedResponseWhenTheRearmLookupFails(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $userSession = $this->createConfiguredMock(IUserSession::class, ['getUser' => $user]);

        $reprocessResponse = $this->createMock(IResponse::class);
        $reprocessResponse->method('getStatusCode')->willReturn(202);
        $reprocessResponse->method('getBody')->willReturn('{"status":"pending"}');

        $getResponse = $this->createMock(IResponse::class);
        $getResponse->method('getStatusCode')->willReturn(404);
        $getResponse->method('getBody')->willReturn('{"error":"not_found"}');

        $client = $this->createMock(IClient::class);
        $client->method('request')->willReturnCallback(
            fn (string $method) => $method === 'POST' ? $reprocessResponse : $getResponse,
        );

        $ledgerRepo = new FakeSyncWorkLedgerRepository();
        $controller = $this->buildController($client, $userSession, ledgerRepo: $ledgerRepo);

        $result = $controller->reprocessDocument('42');

        self::assertInstanceOf(DataDisplayResponse::class, $result);
        self::assertSame(202, $result->getStatus());
        self::assertSame('{"status":"pending"}', $result->render());
        self::assertSame([], $ledgerRepo->rearmed);
    }

    /**
     * Builds a real ApiProxyController, unless $requestBody is given, in
     * which case rawBody() (php://input isn't practically mockable) is
     * stubbed via a partial mock instead - every other method keeps its
     * real implementation.
     */
    private function buildController(
        IClient $client,
        IUserSession $userSession,
        ?IGroupManager $groupManager = null,
        ?FakeDBConnection $db = null,
        ?FakeConfig $tokenConfig = null,
        ?string $requestBody = null,
        ?IRootFolder $rootFolder = null,
        ?FakeSyncWorkLedgerRepository $ledgerRepo = null,
    ): ApiProxyController {
        $groupManager ??= $this->createConfiguredMock(IGroupManager::class, ['getUserGroupIds' => ['acme-corp']]);
        $db ??= new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 42, 'backend_url' => self::BACKEND_URL],
        ]);
        $tenantMapper = new TenantMapper($db, $groupManager, $this->createMock(LoggerInterface::class), new FakeConfig());

        $tokenConfig ??= new FakeConfig(['momentum_eddsa_private_key' => base64_encode(sodium_crypto_sign_secretkey(sodium_crypto_sign_keypair()))]);
        $tokenMinter = new TokenMinter($tokenConfig, new FakeTimeFactory(1_700_000_000));

        $clientService = $this->createMock(IClientService::class);
        $clientService->method('newClient')->willReturn($client);

        $proxyService = new ApiProxyService($tenantMapper, $tokenMinter, $clientService, $this->createMock(LoggerInterface::class));
        $request = $this->createMock(IRequest::class);

        // No test cares about the M68.6 re-arm path unless it explicitly
        // supplies its own $rootFolder — an unconfigured mock's
        // getUserFolder()->get() returns a bare Node double (not a File),
        // so LedgerRearmer::rearm() always falls through to a no-op by
        // default, same outcome as a document the acting user doesn't own.
        $rootFolder ??= $this->createMock(IRootFolder::class);
        $ledgerRearmer = new LedgerRearmer(
            $tenantMapper,
            $rootFolder,
            $ledgerRepo ?? new FakeSyncWorkLedgerRepository(),
            new FakeTimeFactory(1_700_000_000),
            new FakeConfig(),
            $this->createMock(LoggerInterface::class),
        );

        if ($requestBody === null) {
            return new ApiProxyController('momentum', $request, $proxyService, $userSession, $ledgerRearmer);
        }

        $controller = $this->getMockBuilder(ApiProxyController::class)
            ->setConstructorArgs(['momentum', $request, $proxyService, $userSession, $ledgerRearmer])
            ->onlyMethods(['rawBody'])
            ->getMock();
        $controller->method('rawBody')->willReturn($requestBody);

        return $controller;
    }
}
