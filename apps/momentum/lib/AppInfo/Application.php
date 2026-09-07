<?php

declare(strict_types=1);

namespace OCA\Momentum\AppInfo;

use OCA\AppAPI\Middleware\AppAPIAuthMiddleware;
use OCA\Files\Event\LoadAdditionalScriptsEvent;
use OCA\Momentum\Db\DbScopedReconcileTaskRepository;
use OCA\Momentum\Db\DbSyncWorkLedgerRepository;
use OCA\Momentum\Db\ScopedReconcileTaskRepository;
use OCA\Momentum\Db\SyncWorkLedgerRepository;
use OCA\Momentum\Listener\FilesystemEventListener;
use OCA\Momentum\Listener\GroupMembershipListener;
use OCA\Momentum\Listener\LoadAdditionalScriptsListener;
use OCA\Momentum\Listener\ShareEventListener;
use OCA\Momentum\Service\FilesystemEventSink;
use OCA\Momentum\Service\LedgerFilesystemEventSink;
use OCA\Momentum\Service\SyncWorkLedger\EventDeliveryClient;
use OCA\Momentum\Service\SyncWorkLedger\FilesMetadataLabelWriter;
use OCA\Momentum\Service\SyncWorkLedger\HttpEventDeliveryClient;
use OCA\Momentum\Service\SyncWorkLedger\HttpStatusPollClient;
use OCA\Momentum\Service\SyncWorkLedger\EventDispatcherNotifyPushDispatcher;
use OCA\Momentum\Service\SyncWorkLedger\LabelWriter;
use OCA\Momentum\Service\SyncWorkLedger\NotifyPushDispatcher;
use OCA\Momentum\Service\SyncWorkLedger\StatusPollClient;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\Files\Events\Node\BeforeNodeDeletedEvent;
use OCP\Files\Events\Node\NodeCreatedEvent;
use OCP\Files\Events\Node\NodeRenamedEvent;
use OCP\Files\Events\Node\NodeWrittenEvent;
use OCP\Group\Events\UserAddedEvent;
use OCP\Group\Events\UserRemovedEvent;
use OCP\Share\Events\ShareCreatedEvent;
use OCP\Share\Events\ShareDeletedEvent;

/**
 * NC Glue App bootstrap (architecture.md § ⑨). Registers the
 * filesystem-event listener (M5.2), the sync-work-ledger-backed event sink
 * and access resolver (M6.3), the HTTP-backed outbound ledger-drain client
 * (M10.11), the scoped-reconciliation trigger for group-membership changes
 * (M6.8), and the label-sync writer used by `StatusPollPass` (M10.10). The
 * OCS file-serving/access-verify controllers are added by a later milestone
 * (M5.8). The full-tenant reconciliation `ITimedJob` (M6.9,
 * `BackgroundJob\ReconciliationJob`), the sync-work ledger cleanup sweep
 * (M7.4/M10.9, `BackgroundJob\CleanupSweepJob`), and the "AI Filing"
 * navigation entry mounting the Vue app shell (M4.1, frontend.md §
 * Integration Model) are all registered declaratively via
 * `appinfo/info.xml`'s `<background-jobs>`/`<navigations>`, not here —
 * `IRegistrationContext::registerNavigationEntry()` doesn't exist on any
 * real Nextcloud OCP version (confirmed against the actual NC 34
 * `IRegistrationContext` interface via a live install, 2026-07-24); it threw
 * a fatal `Error` on every single app-framework bootstrap, including
 * `status.php` health checks and `occ` commands, which is what was actually
 * blocking `occ app_api:app:register` from ever completing. Modern Nextcloud
 * apps (see apps/{photos,dashboard,activity}/appinfo/info.xml in the
 * server's own image) declare navigation via info.xml's `<navigations>`
 * instead of PHP.
 *
 * `ScopedReconcileTaskRepository`/`SyncWorkLedgerRepository` are also
 * `registerServiceAlias`'d here — both interfaces had a real `Db*`
 * implementation already written but were never actually bound, so
 * Nextcloud's DI container (which can only auto-wire concrete classes, not
 * interfaces) threw `QueryException: ... Class can not be instantiated` any
 * time something needed one: every cron tick (`StatusPollPass`/`DrainPass`
 * depend on `SyncWorkLedgerRepository`) and — the one that actually blocks
 * end-user file uploads — `GroupMembershipListener` and
 * `LedgerFilesystemEventSink` (behind the `FilesystemEventSink` alias
 * above), so every `NodeCreatedEvent` on a real upload 403'd until this was
 * fixed. Confirmed via a live install, 2026-07-25, testing a real file
 * upload end-to-end. Same class of gap as `registerNavigationEntry()`
 * above — untestable by the existing PHP unit tests, which construct
 * listeners/services directly rather than through the real DI container.
 *
 * `StatusPollClient` had the identical gap: {@see HttpStatusPollClient}
 * existed with no `registerServiceAlias`, so every cron tick's
 * `StatusPollPass` threw the same `QueryException` and inbound label/status
 * sync never ran (confirmed via a live install, 2026-07-29 — ledger rows
 * stayed `awaiting` forever even after their outbound half succeeded).
 *
 * `NotifyPushDispatcher` had the same gap once more: {@see
 * EventDispatcherNotifyPushDispatcher} existed with no
 * `registerServiceAlias`, so `StatusPollPass` (which also depends on this)
 * still threw the identical `QueryException` even after the
 * `StatusPollClient` alias above was added. Confirmed via a live install,
 * 2026-07-29 — `StatusPollPass` now constructs and `run()` executes.
 */
class Application extends App implements IBootstrap
{
    public const APP_ID = 'momentum';

    public function __construct()
    {
        parent::__construct(self::APP_ID);
    }

    public function register(IRegistrationContext $context): void
    {
        $context->registerServiceAlias(FilesystemEventSink::class, LedgerFilesystemEventSink::class);
        $context->registerServiceAlias(EventDeliveryClient::class, HttpEventDeliveryClient::class);
        $context->registerServiceAlias(StatusPollClient::class, HttpStatusPollClient::class);
        $context->registerServiceAlias(LabelWriter::class, FilesMetadataLabelWriter::class);
        $context->registerServiceAlias(NotifyPushDispatcher::class, EventDispatcherNotifyPushDispatcher::class);
        $context->registerServiceAlias(ScopedReconcileTaskRepository::class, DbScopedReconcileTaskRepository::class);
        $context->registerServiceAlias(SyncWorkLedgerRepository::class, DbSyncWorkLedgerRepository::class);

        // AppAPI registers its own AppAPIAuthMiddleware non-globally
        // ($global=false, apps/app_api/lib/AppInfo/Application.php), so it
        // only runs for app_api's own controllers by default — a
        // #[AppAPIAuth] attribute on one of *our* controllers (FileController,
        // M18.1) is otherwise silently never checked, falling through to
        // Nextcloud's ordinary session/basic-auth check instead, which a
        // Go-worker AppAPI-credentialed request can never satisfy ("Current
        // user is not logged in", confirmed live 2026-07-27). Registering the
        // same middleware class here scopes it to momentum's own controllers.
        //
        // Guarded by class_exists: `app_api` is an optional dependency, and on
        // an instance without it this registration does far more than lose
        // AppAPI auth. DIContainer builds the *whole* MiddlewareDispatcher in
        // one service closure and registers every app-scoped middleware inside
        // it (lib/private/AppFramework/DependencyInjection/DIContainer.php);
        // an unresolvable class there throws a QueryException that
        // DIContainer::query() silently swallows, falling back to the server
        // container, which auto-wires a *bare* MiddlewareDispatcher with zero
        // middlewares. Every momentum controller then ran with no
        // SecurityMiddleware (the page shell was reachable logged-out, 200
        // instead of 401), no CSPMiddleware, and — the visible symptom — no
        // AdditionalScriptsMiddleware, so BeforeTemplateRenderedEvent never
        // fired and core never injected core/css/server.css, core-common.js
        // or core-main.js: the app rendered as an unstyled page with no
        // Nextcloud chrome. Confirmed live, 2026-08-20, on a dev instance
        // where `app_api` is not installed.
        if (class_exists(AppAPIAuthMiddleware::class)) {
            $context->registerMiddleware(AppAPIAuthMiddleware::class);
        }

        $context->registerEventListener(NodeCreatedEvent::class, FilesystemEventListener::class);
        $context->registerEventListener(NodeWrittenEvent::class, FilesystemEventListener::class);
        $context->registerEventListener(NodeRenamedEvent::class, FilesystemEventListener::class);
        $context->registerEventListener(BeforeNodeDeletedEvent::class, FilesystemEventListener::class);

        $context->registerEventListener(ShareCreatedEvent::class, ShareEventListener::class);
        $context->registerEventListener(ShareDeletedEvent::class, ShareEventListener::class);

        $context->registerEventListener(UserAddedEvent::class, GroupMembershipListener::class);
        $context->registerEventListener(UserRemovedEvent::class, GroupMembershipListener::class);

        // Injects js/momentum-files.js (the M4.14 AI Filing custom View + the
        // M4.16 Ask AI sidebar tab) on every Files page — see
        // LoadAdditionalScriptsListener's docblock for why this event, not
        // info.xml's <navigations>, is the right mechanism for Files-app
        // chrome specifically.
        $context->registerEventListener(LoadAdditionalScriptsEvent::class, LoadAdditionalScriptsListener::class);
    }

    public function boot(IBootContext $context): void
    {
    }
}
