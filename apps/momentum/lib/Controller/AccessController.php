<?php

declare(strict_types=1);

namespace OCA\Momentum\Controller;

use OCA\AppAPI\Attribute\AppAPIAuth;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\OCSController;
use OCP\Files\File;
use OCP\Files\IRootFolder;
use OCP\Files\NotFoundException;
use OCP\IRequest;

/**
 * Thin-A delivery-time re-verify OCS endpoint (architecture.md § ⑨ Access
 * resolver: "also performs the delivery-time thin-A re-verify (batched
 * getByIds) on behalf of read queries"; db.md § Layer 4 Thin-A). Given a
 * bounded candidate set filter B has already narrowed, resolves each
 * fileId's live visibility to uid via the same
 * `getUserFolder($uid)->getById($fileId)` primitive FileController#show
 * uses (M5.8) — calling it as this specific user is itself the
 * ACL-respecting check (db.md: "only an ACL-respecting getById($fileId) per
 * user catches" a group-folder per-path deny the projection can't
 * represent), so no separate permission check is needed beyond "did a File
 * node come back at all". This is the batched call the Doc-Mgr Backend's
 * per-nc_instance_id circuit breaker (backend/internal/thina.HTTPGetter)
 * wraps with a 300 ms timeout and degrades away from on failure.
 *
 * `#[AppAPIAuth]` + `#[PublicPage]` (not `#[NoAdminRequired]`) — same
 * pairing as `FileController::show`, for the same reason (see that
 * controller's docblock): OCS requests bypass `OC::handleRequest()`'s
 * guest-login block, so `#[NoAdminRequired]` alone requires an NC session
 * that the Go thin-A client (`backend/internal/thina/http_getter.go`,
 * `Authorization: Bearer <AppAPISecret>`) never has, 401ing every call and
 * leaving the circuit breaker permanently open (`to_change.md` § G53).
 * `#[NoAdminRequired]` also admitted any logged-in NC user regardless of
 * whether `$uid` matched the session user, since nothing compared the two —
 * a cross-user visibility oracle (`to_change.md` § G54), closed here as a
 * side effect since `#[PublicPage]` removes the browser-session path
 * entirely.
 */
class AccessController extends OCSController
{
    public function __construct(
        string $appName,
        IRequest $request,
        private readonly IRootFolder $rootFolder,
    ) {
        parent::__construct($appName, $request);
    }

    #[AppAPIAuth]
    #[PublicPage]
    #[NoCSRFRequired]
    public function verify(string $uid, array $fileIds): DataResponse
    {
        try {
            $userFolder = $this->rootFolder->getUserFolder($uid);
        } catch (NotFoundException) {
            return new DataResponse(['visible' => array_fill_keys(array_map('strval', $fileIds), false)]);
        }

        $visible = [];
        foreach ($fileIds as $fileId) {
            $node = $userFolder->getById((int) $fileId)[0] ?? null;
            $visible[(string) $fileId] = $node instanceof File;
        }

        return new DataResponse(['visible' => $visible]);
    }
}
