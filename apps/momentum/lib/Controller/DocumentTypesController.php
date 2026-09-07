<?php

declare(strict_types=1);

namespace OCA\Momentum\Controller;

use OCA\Momentum\Exception\AmbiguousTenantMappingException;
use OCA\Momentum\Exception\NoTenantMappingException;
use OCA\Momentum\Exception\TokenMintingException;
use OCA\Momentum\Service\ApiProxy\ApiProxyService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\DataResponse;
use OCP\IRequest;
use OCP\IUserSession;

/**
 * Thin proxy for `GET /apps/momentum/api/document-types` (backlog/v1.md
 * M20.2; `specs/api.md` § `GET /document-types`). All tenant resolution,
 * token minting, and request forwarding lives in {@see ApiProxyService}
 * (M20.1) — this controller only resolves the acting NC user, forwards
 * the call, and relays the response verbatim.
 */
class DocumentTypesController extends Controller
{
    public function __construct(
        string $appName,
        IRequest $request,
        private readonly IUserSession $userSession,
        private readonly ApiProxyService $apiProxy,
    ) {
        parent::__construct($appName, $request);
    }

    /**
     * @param string $scope `all` for the full global catalog, anything else
     *                      (including the default) for the tenant's
     *                      usage-scoped list — the Document Viewer's doc_type
     *                      correction control is the sole `all` consumer, the
     *                      nav tree and Files-app View stay on the default
     *                      (`specs/frontend.md` § Type control, M83.2)
     */
    #[NoAdminRequired]
    #[NoCSRFRequired]
    public function list(string $scope = ''): DataResponse
    {
        $user = $this->userSession->getUser();

        if ($user === null) {
            return new DataResponse([], 401);
        }

        // Only the literal `all` is relayed: the backend already treats every
        // other value as `classified`, so a strict allowlist keeps unvalidated
        // caller input out of the forwarded backend URL.
        $path = $scope === 'all' ? '/document-types?scope=all' : '/document-types';

        try {
            $response = $this->apiProxy->forward($user, 'GET', $path);
        } catch (NoTenantMappingException | AmbiguousTenantMappingException) {
            return new DataResponse([], 403);
        } catch (TokenMintingException) {
            return new DataResponse([], 500);
        }

        $data = json_decode($response->body, true);

        return new DataResponse(is_array($data) ? $data : [], $response->statusCode);
    }
}
