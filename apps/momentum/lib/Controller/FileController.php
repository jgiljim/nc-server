<?php

declare(strict_types=1);

namespace OCA\Momentum\Controller;

use OCA\AppAPI\Attribute\AppAPIAuth;
use OCA\Momentum\Exception\AmbiguousTenantMappingException;
use OCA\Momentum\Exception\NoTenantMappingException;
use OCA\Momentum\Service\FileAllowlist;
use OCA\Momentum\Service\TenantMapper;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\DataDownloadResponse;
use OCP\AppFramework\OCS\OCSForbiddenException;
use OCP\AppFramework\OCS\OCSNotFoundException;
use OCP\AppFramework\OCSController;
use OCP\Files\File;
use OCP\Files\IRootFolder;
use OCP\Files\NotFoundException;
use OCP\Files\NotPermittedException;
use OCP\IRequest;
use OCP\IUserManager;

/**
 * File-serving OCS endpoint (architecture.md § ⑨): resolves a `fileId` to a
 * byte stream via `getUserFolder($uid)->getById($fileId)` (the
 * `context_chat` `QueueController` pattern), authenticated by AppAPI.
 * Replaces pre-signed download URLs — the pipeline fetches document
 * content through this endpoint instead (M5.9).
 *
 * `#[AppAPIAuth]` alone only proves *some* registered ExApp made the call,
 * not that the requested file's owner belongs to a tenant this Glue App
 * install actually serves — `backlog/to_change.md` § G55 items 1-2 close
 * that gap: the owner is resolved to a tenant via {@see TenantMapper}
 * (rejecting an owner in no registered customer group, or in two or more,
 * with `403`), and the resolved mimetype is checked against the same
 * {@see FileAllowlist} `FilesystemEventListener` already applies at
 * intake, since the pipeline only ever needs allowlisted formats back out.
 *
 * `#[AppAPIAuth]`'s check only runs because `AppAPIAuthMiddleware` is
 * registered non-globally by the `app_api` app and re-registered here in
 * `Application::register()` — if that app is ever disabled/uninstalled, the
 * middleware disappears and, since this controller is also `#[PublicPage]`,
 * nothing else stands between an anonymous caller and file bytes.
 * `backlog/to_change.md` § G55 item 3 closes that single point of failure:
 * `show()` also asserts, in-controller, that the two headers
 * `AppAPIAuthMiddleware` itself checks (`EX-APP-ID` and
 * `AUTHORIZATION-APP-API`) are present before touching `$rootFolder` at
 * all, so a request that reaches this method with the middleware absent
 * still gets `403`, not the file.
 *
 * `#[AppAPIAuth]` + `#[PublicPage]` (not `#[NoAdminRequired]`) is the exact
 * pairing `apps/app_api/lib/Controller/OCSApiController.php` itself uses on
 * its own AppAPI-authenticated OCS routes — confirmed by reading it directly
 * off a live install, 2026-07-27, after two wrong guesses:
 * `#[NoAdminRequired]` alone 401s ("Current user is not logged in") because
 * that attribute still requires NC's core `SecurityMiddleware` to see an
 * already-logged-in user, and OCS requests (`ocs/v1.php`) call
 * `\OC\Route\Router::match()` directly rather than going through
 * `OC::handleRequest()`'s guest-login block, so the core-level
 * `tryAppAPILogin()` (`lib/base.php`) that would otherwise recognize
 * `AUTHORIZATION-APP-API` never runs for this entry point either.
 * `#[ExAppRequired]` (tried next) 412s ("ExApp required") because
 * `SecurityMiddleware` is constructed — and its checks evaluated — *before*
 * any app's own registered middlewares run, so even a successful
 * `AppAPIAuthMiddleware::beforeController` (which sets the live session
 * flag `#[ExAppRequired]` checks) runs too late to matter. `#[PublicPage]`
 * sidesteps `SecurityMiddleware`'s login requirement entirely instead of
 * racing it, leaving `#[AppAPIAuth]`'s own `EX-APP-ID`/
 * `AUTHORIZATION-APP-API` check (registered via `Application::register()`)
 * as the sole, sufficient gate — exactly as AppAPI's own controller relies
 * on it.
 */
class FileController extends OCSController
{
    public function __construct(
        string $appName,
        IRequest $request,
        private readonly IRootFolder $rootFolder,
        private readonly IUserManager $userManager,
        private readonly TenantMapper $tenantMapper,
        private readonly FileAllowlist $allowlist,
    ) {
        parent::__construct($appName, $request);
    }

    #[AppAPIAuth]
    #[PublicPage]
    #[NoCSRFRequired]
    public function show(string $uid, int $fileId): DataDownloadResponse
    {
        // backlog/to_change.md § G55 item 3: assert ExApp identity ourselves
        // instead of trusting solely that AppAPIAuthMiddleware ran — a
        // missing header here means the middleware never validated this
        // request, which must fail closed (403), not fall through to an
        // unauthenticated file read.
        if ($this->request->getHeader('EX-APP-ID') === '' || $this->request->getHeader('AUTHORIZATION-APP-API') === '') {
            throw new OCSForbiddenException('Missing ExApp identity headers.');
        }

        try {
            $userFolder = $this->rootFolder->getUserFolder($uid);
        } catch (NotFoundException) {
            throw new OCSNotFoundException('User not found.');
        }

        $node = $userFolder->getById($fileId)[0] ?? null;

        if (!$node instanceof File) {
            throw new OCSNotFoundException('File not found.');
        }

        // backlog/to_change.md § G55 items 1-2: resolve the file's owner to
        // a Doc-Mgr tenant and reject bytes for an owner this ExApp's own
        // tenant registry doesn't serve, before ever touching content —
        // `#[AppAPIAuth]` alone proves *some* registered ExApp is calling,
        // not that the requested file belongs to a tenant it's allowed to
        // read.
        $owner = $this->userManager->get($uid);

        if ($owner === null) {
            throw new OCSForbiddenException('No registered Doc-Mgr tenant for this file owner.');
        }

        try {
            $this->tenantMapper->resolve($owner);
        } catch (NoTenantMappingException | AmbiguousTenantMappingException) {
            throw new OCSForbiddenException('No registered Doc-Mgr tenant for this file owner.');
        }

        if (!$this->allowlist->isAllowedMimetype($node->getMimeType())) {
            throw new OCSForbiddenException('File mimetype is not on the Doc-Mgr allowlist.');
        }

        try {
            $content = $node->getContent();
        } catch (NotPermittedException) {
            throw new OCSForbiddenException('Not permitted to read this file.');
        }

        return new DataDownloadResponse($content, $node->getName(), $node->getMimeType());
    }
}
