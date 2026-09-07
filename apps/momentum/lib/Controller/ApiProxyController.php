<?php

declare(strict_types=1);

namespace OCA\Momentum\Controller;

use OCA\Momentum\Exception\AmbiguousTenantMappingException;
use OCA\Momentum\Exception\NoTenantMappingException;
use OCA\Momentum\Exception\TokenMintingException;
use OCA\Momentum\Service\ApiProxy\ApiProxyResponse;
use OCA\Momentum\Service\ApiProxy\ApiProxyService;
use OCA\Momentum\Service\SyncWorkLedger\LedgerRearmer;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\DataDisplayResponse;
use OCP\AppFramework\Http\DataResponse;
use OCP\IRequest;
use OCP\IUser;
use OCP\IUserSession;

/**
 * Thin controller layer for every `/apps/momentum/api/*` route (frontend.md
 * § API Bindings Summary; backlog/v1.md M20.2-M20.9): resolves the acting NC
 * user and delegates method/path/body forwarding entirely to
 * {@see ApiProxyService} (M20.1) — this class adds no new auth/forwarding
 * logic of its own, only per-endpoint path building and the one piece every
 * endpoint needs uniformly: translating the service's propagated
 * tenant-resolution/token-minting failures into an HTTP response, since
 * {@see ApiProxyService::forward()} deliberately lets those exceptions
 * surface here rather than coercing them into a synthetic
 * {@see ApiProxyResponse} itself.
 */
class ApiProxyController extends Controller
{
    public function __construct(
        string $appName,
        IRequest $request,
        private readonly ApiProxyService $apiProxyService,
        private readonly IUserSession $userSession,
        private readonly LedgerRearmer $ledgerRearmer,
    ) {
        parent::__construct($appName, $request);
    }

    /**
     * M20.4, `specs/api.md` § `GET /documents/{id}`.
     */
    #[NoAdminRequired]
    #[NoCSRFRequired]
    public function getDocument(string $id): DataResponse|DataDisplayResponse
    {
        return $this->forward('GET', '/documents/' . rawurlencode($id));
    }

    /**
     * M127.2, `specs/api.md` § `GET /documents/by-file/{file_id}`: resolve a
     * Nextcloud fileId to its document, so a click on a row in the app's file
     * browser can open the document split view instead of only a preview
     * (frontend.md § Opening a file).
     *
     * A `404` — most files are not documents, and a just-ingested one is still
     * `pending` — is relayed as a `404`, which is what the page falls back on.
     * Nothing here interprets the status: `forward()` relays the backend's
     * response verbatim, exactly as the other read routes do.
     */
    #[NoAdminRequired]
    #[NoCSRFRequired]
    public function getDocumentByFile(string $fileId): DataResponse|DataDisplayResponse
    {
        return $this->forward('GET', '/documents/by-file/' . rawurlencode($fileId));
    }

    /**
     * M20.3, `specs/api.md` § `GET /document-types/{type_name}/schema`.
     */
    #[NoAdminRequired]
    #[NoCSRFRequired]
    public function getDocumentTypeSchema(string $typeName): DataResponse|DataDisplayResponse
    {
        return $this->forward('GET', '/document-types/' . rawurlencode($typeName) . '/schema');
    }

    /**
     * M20.8, `specs/api.md` § `GET /search/documents`. The raw `QUERY_STRING`
     * is forwarded verbatim rather than rebuilt from parsed route/query
     * parameters: PHP's parsed request representation collapses repeated
     * keys (`f=a&f=b`) to the last value, which would silently drop all but
     * one of documents.ts's `buildSearchQuery` filter params.
     */
    #[NoAdminRequired]
    #[NoCSRFRequired]
    public function searchDocuments(): DataResponse|DataDisplayResponse
    {
        // IRequest has no getServerParams() method (confirmed live,
        // 2026-07-27: "Call to undefined method ...Request::getServerParams()"
        // 500s every call). IRequest::server is only a docblock-documented
        // magic property on the concrete Request class, not part of the
        // interface contract, so it isn't mockable through createMock(IRequest
        // ::class) either - reading $_SERVER directly is both correct at
        // runtime and the simplest thing to actually test.
        $queryString = (string) ($_SERVER['QUERY_STRING'] ?? '');
        $path = '/search/documents' . ($queryString !== '' ? '?' . $queryString : '');

        return $this->forward('GET', $path);
    }

    /**
     * M20.5, `specs/api.md` § `PATCH /documents/{id}` — an RFC 7396 JSON
     * merge patch (`reviewed` / `direction`), so the body is forwarded
     * exactly as it arrived: re-encoding a parsed body could drop or
     * reshape keys, and under merge-patch semantics which keys are present
     * *is* the instruction.
     *
     * CSRF protection stays enabled (G66 item 1): this route is only ever
     * called same-origin by this app's own JS via `@nextcloud/axios`, which
     * attaches NC's `requesttoken` header automatically, so there is no
     * cross-origin preflight for a JSON content-type to force around — the
     * usual justification for `#[NoCSRFRequired]` on a JSON-body mutation
     * doesn't apply here.
     *
     * A `doc_type` correction is the one call through this method that
     * returns `202` rather than `204`/an error (api.md § PATCH
     * /documents/{public_id} "Correcting doc_type") — see `$rearmDocumentId`
     * on `forward()` (M68.6).
     */
    #[NoAdminRequired]
    public function patchDocument(string $id): DataResponse|DataDisplayResponse
    {
        return $this->forward('PATCH', '/documents/' . rawurlencode($id), $this->rawBody(), $id);
    }

    /**
     * M20.9, `specs/api.md` § `GET /stats/overview`.
     */
    #[NoAdminRequired]
    #[NoCSRFRequired]
    public function getStatsOverview(): DataResponse|DataDisplayResponse
    {
        return $this->forward('GET', '/stats/overview');
    }

    /**
     * M20.6, `specs/api.md` § `PATCH /documents/{id}/fields`. CSRF
     * protection stays enabled — see `patchDocument()`'s docblock (G66
     * item 1).
     */
    #[NoAdminRequired]
    public function patchDocumentFields(string $id): DataResponse|DataDisplayResponse
    {
        return $this->forward('PATCH', '/documents/' . rawurlencode($id) . '/fields', $this->rawBody());
    }

    /**
     * M20.7, `specs/api.md` § `POST /documents/{id}/reprocess`. CSRF
     * protection stays enabled — see `patchDocument()`'s docblock (G66
     * item 1). Always returns `202` on acceptance — see `$rearmDocumentId`
     * on `forward()` (M68.6).
     */
    #[NoAdminRequired]
    public function reprocessDocument(string $id): DataResponse|DataDisplayResponse
    {
        return $this->forward('POST', '/documents/' . rawurlencode($id) . '/reprocess', null, $id);
    }

    /**
     * @param string|null $rearmDocumentId the request's `public_id`, passed
     *     only by the two calls that can trigger an async full-pipeline
     *     re-run (`patchDocument()`'s `doc_type` branch, `reprocessDocument()`)
     *     — a `202` response from either means the document's sync-work
     *     ledger row may need re-arming (M68.6, see `rearmSyncWorkLedger()`).
     *     `null` for every other call, which never returns `202` and so
     *     never needs this.
     */
    private function forward(
        string $method,
        string $path,
        ?string $body = null,
        ?string $rearmDocumentId = null,
    ): DataResponse|DataDisplayResponse {
        $user = $this->userSession->getUser();
        if ($user === null) {
            return new DataResponse(['error' => 'unauthenticated'], 401);
        }

        try {
            $response = $this->apiProxyService->forward($user, $method, $path, $body);
        } catch (NoTenantMappingException) {
            return new DataResponse(['error' => 'no_tenant_mapping'], 403);
        } catch (AmbiguousTenantMappingException|TokenMintingException) {
            return new DataResponse(['error' => 'server_misconfigured'], 500);
        }

        if ($rearmDocumentId !== null && $response->statusCode === 202) {
            $this->rearmSyncWorkLedger($user, $rearmDocumentId);
        }

        return $this->toResponse($response);
    }

    /**
     * M68.6: fetches the document's current `path` (api.md § GET
     * /documents/{public_id}) fresh — `reprocessDocument()`'s caller never
     * has one in hand — and hands it to {@see LedgerRearmer}. Never lets a
     * failure here affect the response already computed for the caller: the
     * Doc-Mgr Backend write already succeeded by the time this runs, so this
     * is a best-effort side effect, not part of the request's own outcome
     * (mirrors `LedgerRearmer::rearm()`'s own fail-open-to-skip posture).
     */
    private function rearmSyncWorkLedger(IUser $user, string $publicId): void
    {
        try {
            $getResponse = $this->apiProxyService->forward($user, 'GET', '/documents/' . rawurlencode($publicId));
        } catch (NoTenantMappingException|AmbiguousTenantMappingException|TokenMintingException) {
            return;
        }

        if ($getResponse->statusCode !== 200) {
            return;
        }

        $decoded = json_decode($getResponse->body, true);
        $relPath = is_array($decoded) ? ($decoded['path'] ?? null) : null;
        if (!is_string($relPath) || $relPath === '') {
            return;
        }

        $this->ledgerRearmer->rearm($user, $relPath);
    }

    /**
     * `IRequest::getContent()` doesn't exist on the public interface - the
     * concrete `Request` class has a same-named method, but it's `protected`
     * (confirmed live, 2026-07-27: "Call to protected method ...getContent()
     * from scope ApiProxyController" 500s every PATCH/POST). It's also
     * unsuitable even if it were public: it decodes `application/json`
     * bodies into a parsed array (merged into `getParams()`), and
     * re-encoding that back to JSON is exactly the byte-preservation problem
     * this method exists to avoid (RFC 7396 merge-patch semantics). Reading
     * `php://input` directly is the standard way to get the untouched
     * request body bytes in a plain PHP/AppFramework controller.
     */
    // protected, not private: php://input isn't practically mockable in a
    // unit test, so tests that need to control the raw body stub this method
    // via a partial mock instead (ApiProxyControllerTest::buildController()).
    protected function rawBody(): string
    {
        return (string) file_get_contents('php://input');
    }

    private function toResponse(ApiProxyResponse $response): DataDisplayResponse
    {
        $dataResponse = new DataDisplayResponse($response->body, $response->statusCode);
        $dataResponse->addHeader('Content-Type', 'application/json');

        return $dataResponse;
    }
}
