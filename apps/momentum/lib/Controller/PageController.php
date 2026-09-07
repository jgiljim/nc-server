<?php

declare(strict_types=1);

namespace OCA\Momentum\Controller;

use OCA\Files\Event\LoadAdditionalScriptsEvent;
use OCA\Files\Event\LoadSidebar;
use OCA\Viewer\Event\LoadViewer;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\EventDispatcher\IEventDispatcher;
use OCP\Util;

/**
 * Mounts the Vue app shell (frontend.md § Integration Model). A single
 * `index` template/action serves every page route registered in
 * `appinfo/routes.php` (`/`, `/type/{typeName}`, `/recent`,
 * `/document/{docId}`, `/chat`) — Vue Router owns client-side routing from
 * there, mirroring the `assistant`/`photos`/`contacts` NC app pattern.
 */
class PageController extends Controller
{
    public function __construct(
        string $appName,
        \OCP\IRequest $request,
        private IEventDispatcher $eventDispatcher,
    ) {
        parent::__construct($appName, $request);
    }

    #[NoAdminRequired]
    #[NoCSRFRequired]
    public function index(): TemplateResponse
    {
        // Without this, `window.OCA.Viewer` never loads on our page — the
        // `viewer` app only loads its script in response to this event
        // (`OCA\Viewer\Listener\LoadViewerScript`), which it never receives
        // outside pages that explicitly dispatch it themselves (see
        // `files`' ViewController / `photos`' PageController for the same
        // pattern). DocumentViewerPage.vue's `getNcViewer()` silently found
        // `window.OCA.Viewer` undefined and fell back to "Preview
        // unavailable" for every document, even with `viewer` enabled.
        if (class_exists(LoadViewer::class)) {
            $this->eventDispatcher->dispatchTyped(new LoadViewer());
        }

        // Standalone chrome (frontend.md § Standalone chrome): core's
        // app-switcher waffle and unified-search field live in `header`,
        // OUTSIDE the `#content` element this app's Vue bundle mounts into,
        // so the bundle's own runtime-injected CSS (vite.config.ts builds an
        // IIFE, which injects a <style> tag rather than emitting a css file)
        // cannot reach them. A server-added stylesheet can. Adding it here
        // rather than from Application/a global listener is what scopes it to
        // this app's own pages — the Files app and every other surface keep
        // their full chrome, which is the acceptance criterion this is most
        // likely to break.
        Util::addStyle($this->appName, 'app-chrome');

        // Files & Shares bridge (frontend.md § Files & Shares Bridge, M123.1):
        // load Nextcloud's own file registry onto this page. Measured on a
        // running NC 34 instance (2026-08-24): our pages start with an EMPTY
        // registry, and these three steps fill it with 14 views, 18 file
        // actions and 5 filters — which is what `src/services/ncFilesBridge.ts`
        // then reads. Mirrors `apps/files`' own ViewController, with one
        // deliberate omission: NOT `addScript('files', 'main')`, the Files SPA.
        // We want the data, not their UI.
        //
        // Every reference is class_exists/interface-guarded because `files`,
        // `files_sharing` and `files_trashbin` are all technically optional
        // apps, and an unresolvable class reference inside this app's DI scope
        // does not fail loudly — it can strip the ENTIRE middleware stack
        // (SecurityMiddleware included) with no log line (CLAUDE.md §
        // Nextcloud integration rules).
        if (class_exists(LoadAdditionalScriptsEvent::class)) {
            Util::addInitScript('files', 'init');
            // files_sharing / files_trashbin / comments register their own
            // scripts in response to this, so the six sharing views and the
            // trash view arrive without this app naming them.
            $this->eventDispatcher->dispatchTyped(new LoadAdditionalScriptsEvent());
        }

        // `window.OCA.Files.Sidebar` — the details/sharing panel the file
        // browser opens per row. Exists only on pages that ask for it.
        if (class_exists(LoadSidebar::class)) {
            $this->eventDispatcher->dispatchTyped(new LoadSidebar());
        }

        $response = new TemplateResponse($this->appName, 'index');

        // Ask AI panel (frontend.md § Ask AI embed) frames IonosGPT's chat UI at
        // /apps/momentum/chat; without this, the default frame-src 'self' silently
        // blocks the embed and the panel stays blank.
        $csp = new ContentSecurityPolicy();
        $csp->addAllowedFrameDomain('https://gpt.ionos.com');
        $response->setContentSecurityPolicy($csp);

        return $response;
    }
}
