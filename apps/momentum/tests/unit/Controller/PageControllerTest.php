<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Controller;

use OCA\Momentum\AppInfo\Application;
use OCA\Momentum\Controller\PageController;
use OCA\Files\Event\LoadAdditionalScriptsEvent;
use OCA\Files\Event\LoadSidebar;
use OCA\Viewer\Event\LoadViewer;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\EventDispatcher\IEventDispatcher;
use OCP\IRequest;
use OCP\Util;
use PHPUnit\Framework\TestCase;

final class PageControllerTest extends TestCase
{
    protected function setUp(): void
    {
        Util::$addStyleCalls = [];
        Util::$addInitScriptCalls = [];
    }

    public function testIndexRendersTheAppTemplate(): void
    {
        $controller = new PageController(
            Application::APP_ID,
            $this->createMock(IRequest::class),
            $this->createMock(IEventDispatcher::class),
        );

        $response = $controller->index();

        self::assertInstanceOf(TemplateResponse::class, $response);
        self::assertSame(Application::APP_ID, $response->getAppName());
        self::assertSame('index', $response->getTemplateName());
    }

    public function testIndexIgnoresAnyVueRouterPathSoDeepLinksAndRefreshesWork(): void
    {
        // Vue Router owns client-side routing (frontend.md § Integration Model); every
        // server-side page route (type/:type_name, recent, document/:doc_id, chat) maps back
        // to this same index() action, which always mounts the same app shell regardless of
        // which sub-path was requested.
        $controller = new PageController(
            Application::APP_ID,
            $this->createMock(IRequest::class),
            $this->createMock(IEventDispatcher::class),
        );

        $response = $controller->index();

        self::assertSame([], $response->getParams());
    }

    public function testIndexAllowsFramingByIonosGptForTheAskAiEmbed(): void
    {
        // The Ask AI panel (frontend.md § Ask AI embed) frames https://gpt.ionos.com/ inside
        // /apps/momentum/chat. Without an explicit CSP frame-src allowance, the browser's
        // default frame-src 'self' blocks the embed and the panel stays permanently blank.
        $controller = new PageController(
            Application::APP_ID,
            $this->createMock(IRequest::class),
            $this->createMock(IEventDispatcher::class),
        );

        $response = $controller->index();

        $csp = $response->getContentSecurityPolicy();
        self::assertNotNull($csp);
        self::assertContains('https://gpt.ionos.com', $csp->getAllowedFrameDomains());
    }

    public function testIndexDispatchesLoadViewerSoTheRealPreviewerScriptLoads(): void
    {
        // Without this, window.OCA.Viewer never loads on our page (the
        // `viewer` app only loads its script in response to this event) and
        // DocumentViewerPage.vue's getNcViewer() silently falls back to
        // "Preview unavailable" for every document.
        // Asserted by collecting the dispatched events rather than with
        // `expects(once())`: index() now also dispatches the two file-registry
        // events (M123.1), and pinning the *count* here would make this test
        // fail for a reason that has nothing to do with the previewer.
        $dispatched = [];
        $dispatcher = $this->createMock(IEventDispatcher::class);
        $dispatcher->method('dispatchTyped')->willReturnCallback(
            function (object $event) use (&$dispatched): void {
                $dispatched[] = $event::class;
            },
        );

        $controller = new PageController(Application::APP_ID, $this->createMock(IRequest::class), $dispatcher);

        $controller->index();

        self::assertContains(LoadViewer::class, $dispatched);
    }

    public function testIndexLoadsTheStandaloneChromeStylesheet(): void
    {
        // The app is presented as a standalone product inside Nextcloud
        // (frontend.md § Standalone chrome): no app-switcher waffle, no
        // unified-search field. Both live in core's `header`, OUTSIDE the
        // `#content` element our Vue bundle mounts into, so the bundle's own
        // runtime-injected CSS cannot reach them — the override has to be a
        // stylesheet the server adds to the page. Adding it from this
        // controller (rather than globally from Application) is what keeps it
        // scoped to this app's own pages: the Files app and every other
        // surface keep their full chrome.
        $controller = new PageController(
            Application::APP_ID,
            $this->createMock(IRequest::class),
            $this->createMock(IEventDispatcher::class),
        );

        $controller->index();

        self::assertSame([[Application::APP_ID, 'app-chrome']], Util::$addStyleCalls);
    }

    public function testIndexLoadsCoreFilesInitSoTheFileRegistryIsPopulated(): void
    {
        // The Files & Shares bridge (frontend.md § Files & Shares Bridge) reads
        // Nextcloud's own view/action registry. Measured on a running NC 34
        // instance: that registry is EMPTY on this app's pages until core's
        // `files-init` bundle is loaded, after which it carries 14 views and 18
        // file actions. `addInitScript` (not `addScript`) is what core's own
        // ViewController uses, and the init variant is what registers into the
        // shared scope before any page code runs.
        //
        // `files/main` is deliberately NOT loaded: that is the Files app's own
        // SPA, and this app renders its own list.
        $controller = new PageController(
            Application::APP_ID,
            $this->createMock(IRequest::class),
            $this->createMock(IEventDispatcher::class),
        );

        $controller->index();

        self::assertContains(['files', 'init'], Util::$addInitScriptCalls);
        self::assertNotContains(['files', 'main'], Util::$addScriptCalls);
    }

    public function testIndexDispatchesLoadAdditionalScriptsSoSharingAndTrashRegisterThemselves(): void
    {
        // files_sharing's own listener responds to this event with
        // `Util::addInitScript('files_sharing', 'init')`, and files_trashbin
        // does the same — which is how the six sharing views and the trash view
        // reach the registry without this app enumerating them. Same mechanism
        // core's `apps/files` ViewController uses.
        $dispatched = [];
        $dispatcher = $this->createMock(IEventDispatcher::class);
        $dispatcher->method('dispatchTyped')->willReturnCallback(
            function (object $event) use (&$dispatched): void {
                $dispatched[] = $event::class;
            },
        );

        $controller = new PageController(Application::APP_ID, $this->createMock(IRequest::class), $dispatcher);

        $controller->index();

        self::assertContains(LoadAdditionalScriptsEvent::class, $dispatched);
    }

    public function testIndexDispatchesLoadSidebarSoTheDetailsAndSharingPanelExists(): void
    {
        // `window.OCA.Files.Sidebar` only exists on pages that dispatch this;
        // without it the bridge reports the sidebar unavailable and the file
        // browser has no details/sharing panel.
        $dispatched = [];
        $dispatcher = $this->createMock(IEventDispatcher::class);
        $dispatcher->method('dispatchTyped')->willReturnCallback(
            function (object $event) use (&$dispatched): void {
                $dispatched[] = $event::class;
            },
        );

        $controller = new PageController(Application::APP_ID, $this->createMock(IRequest::class), $dispatcher);

        $controller->index();

        self::assertContains(LoadSidebar::class, $dispatched);
    }
}
