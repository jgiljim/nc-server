<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\AppInfo;

use OCA\Momentum\AppInfo\Application;
use OCA\Momentum\Db\DbScopedReconcileTaskRepository;
use OCA\Momentum\Db\DbSyncWorkLedgerRepository;
use OCA\Momentum\Db\ScopedReconcileTaskRepository;
use OCA\Momentum\Db\SyncWorkLedgerRepository;
use OCA\Files\Event\LoadAdditionalScriptsEvent;
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
use OCA\Momentum\Service\SyncWorkLedger\LabelWriter;
use OCA\Momentum\Service\SyncWorkLedger\EventDispatcherNotifyPushDispatcher;
use OCA\Momentum\Service\SyncWorkLedger\NotifyPushDispatcher;
use OCA\Momentum\Service\SyncWorkLedger\StatusPollClient;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\Files\Events\Node\BeforeNodeDeletedEvent;
use OCP\Files\Events\Node\NodeCreatedEvent;
use OCP\Files\Events\Node\NodeRenamedEvent;
use OCP\Files\Events\Node\NodeWrittenEvent;
use OCP\Group\Events\UserAddedEvent;
use OCP\Group\Events\UserRemovedEvent;
use OCP\Share\Events\ShareCreatedEvent;
use OCP\Share\Events\ShareDeletedEvent;
use PHPUnit\Framework\TestCase;

final class ApplicationTest extends TestCase
{
    public function testAppIdMatchesTheRegisteredNextcloudAppId(): void
    {
        // Must match appinfo/info.xml <id> and frontend.md's Application::APP_ID.
        self::assertSame('momentum', Application::APP_ID);
    }

    public function testConstructsWithTheAppId(): void
    {
        $app = new Application();

        self::assertSame(Application::APP_ID, $app->getAppName());
    }

    public function testRegisterWiresTheFilesystemEventListenerToAllFourNodeEvents(): void
    {
        $app = new Application();
        $context = $this->createMock(IRegistrationContext::class);
        $context->expects(self::exactly(9))
            ->method('registerEventListener')
            ->with(
                self::logicalOr(
                    NodeCreatedEvent::class,
                    NodeWrittenEvent::class,
                    NodeRenamedEvent::class,
                    BeforeNodeDeletedEvent::class,
                    ShareCreatedEvent::class,
                    ShareDeletedEvent::class,
                    UserAddedEvent::class,
                    UserRemovedEvent::class,
                    LoadAdditionalScriptsEvent::class,
                ),
                self::logicalOr(
                    FilesystemEventListener::class,
                    ShareEventListener::class,
                    GroupMembershipListener::class,
                    LoadAdditionalScriptsListener::class,
                ),
            );
        $registeredAliases = [];
        $context->expects(self::exactly(7))
            ->method('registerServiceAlias')
            ->willReturnCallback(function (string $alias, string $target) use (&$registeredAliases): void {
                $registeredAliases[$alias] = $target;
            });

        $app->register($context);

        self::assertSame([
            FilesystemEventSink::class => LedgerFilesystemEventSink::class,
            EventDeliveryClient::class => HttpEventDeliveryClient::class,
            StatusPollClient::class => HttpStatusPollClient::class,
            LabelWriter::class => FilesMetadataLabelWriter::class,
            NotifyPushDispatcher::class => EventDispatcherNotifyPushDispatcher::class,
            ScopedReconcileTaskRepository::class => DbScopedReconcileTaskRepository::class,
            SyncWorkLedgerRepository::class => DbSyncWorkLedgerRepository::class,
        ], $registeredAliases);
    }

    public function testRegisterDoesNotCallRegisterNavigationEntry(): void
    {
        // frontend.md § Integration Model / Nextcloud App Registration: the
        // "AI Filing" entry is declared statically in appinfo/info.xml's
        // <navigations> instead (see InfoXmlTest) — registerNavigationEntry()
        // doesn't exist on any real Nextcloud OCP version (Application.php's
        // class doc comment) and must never be called here.
        $app = new Application();
        $context = $this->createMock(IRegistrationContext::class);
        $context->expects(self::never())->method('registerNavigationEntry');

        $app->register($context);
    }

    public function testRegisterWiresLabelWriterToFilesMetadataLabelWriter(): void
    {
        $app = new Application();
        $context = $this->createMock(IRegistrationContext::class);
        $aliases = [];
        $context->method('registerServiceAlias')
            ->willReturnCallback(function (string $alias, string $target) use (&$aliases): void {
                $aliases[$alias] = $target;
            });

        $app->register($context);

        self::assertSame(FilesMetadataLabelWriter::class, $aliases[LabelWriter::class] ?? null);
    }

    public function testBootIsANoOpInThisSkeleton(): void
    {
        $app = new Application();

        $app->boot($this->createMock(IBootContext::class));

        $this->addToAssertionCount(1);
    }
}
