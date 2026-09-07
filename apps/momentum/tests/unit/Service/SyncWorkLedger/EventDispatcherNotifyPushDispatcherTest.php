<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Service\SyncWorkLedger;

use OCA\Momentum\AppInfo\Application;
use OCA\Momentum\Event\MomentumStatusPushEvent;
use OCA\Momentum\Service\AccessResolver;
use OCA\Momentum\Service\SyncWorkLedger\EventDispatcherNotifyPushDispatcher;
use OCA\Momentum\Service\SyncWorkLedger\StatusItem;
use OCA\Momentum\Tests\Support\FakeConfig;
use OCA\Momentum\Tests\Support\FakeEventDispatcher;
use OCA\Momentum\Tests\Support\TenantMapperTestFactory;
use OCP\Files\Config\IUserMountCache;
use OCP\Files\File;
use OCP\Files\IRootFolder;
use OCP\IUserManager;
use OCP\Share\IManager;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

final class EventDispatcherNotifyPushDispatcherTest extends TestCase
{
    public function testDispatchesMomentumStatusToEveryResolvedUid(): void
    {
        $file = $this->createMock(File::class);
        $file->method('getId')->willReturn(42);

        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getById')->with(42)->willReturn([$file]);

        $mountCache = $this->createMock(IUserMountCache::class);
        $mountCache->method('getMountsForFileId')->willReturn([]);
        $shareManager = $this->createMock(IManager::class);
        $shareManager->method('getAccessList')->willReturn(['users' => ['alice', 'bob']]);
        $accessResolver = new AccessResolver(
            $mountCache,
            $shareManager,
            TenantMapperTestFactory::unresolvable(),
            $this->createMock(IUserManager::class),
            $this->createMock(LoggerInterface::class),
        );

        $eventDispatcher = new FakeEventDispatcher();

        $dispatcher = new EventDispatcherNotifyPushDispatcher(
            $rootFolder,
            $accessResolver,
            $eventDispatcher,
            new FakeConfig(),
            $this->createMock(LoggerInterface::class),
        );

        $dispatcher->push(new StatusItem(42, 'done', 'sales_invoice', 'inbound', false, 1));

        self::assertCount(2, $eventDispatcher->dispatched);
        $uids = array_map(static fn (MomentumStatusPushEvent $e) => $e->uid, $eventDispatcher->dispatched);
        self::assertEqualsCanonicalizing(['alice', 'bob'], $uids);
        self::assertSame(42, $eventDispatcher->dispatched[0]->docId);
        self::assertSame('done', $eventDispatcher->dispatched[0]->status);
        self::assertFalse($eventDispatcher->dispatched[0]->reviewed);
    }

    public function testSkipsWhenTheVisibleUidSetExceedsTheConfiguredCap(): void
    {
        $file = $this->createMock(File::class);
        $file->method('getId')->willReturn(42);

        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getById')->with(42)->willReturn([$file]);

        $mountCache = $this->createMock(IUserMountCache::class);
        $mountCache->method('getMountsForFileId')->willReturn([]);
        $shareManager = $this->createMock(IManager::class);
        $shareManager->method('getAccessList')->willReturn(['users' => ['alice', 'bob', 'carol']]);
        $accessResolver = new AccessResolver(
            $mountCache,
            $shareManager,
            TenantMapperTestFactory::unresolvable(),
            $this->createMock(IUserManager::class),
            $this->createMock(LoggerInterface::class),
        );

        $eventDispatcher = new FakeEventDispatcher();
        $config = new FakeConfig([], [Application::APP_ID => ['notify_push_recipient_cap' => '2']]);

        $dispatcher = new EventDispatcherNotifyPushDispatcher(
            $rootFolder,
            $accessResolver,
            $eventDispatcher,
            $config,
            $this->createMock(LoggerInterface::class),
        );

        $dispatcher->push(new StatusItem(42, 'done', 'sales_invoice', 'inbound', false, 1));

        self::assertSame([], $eventDispatcher->dispatched);
    }

    public function testSkipsWhenTheFileNoLongerExistsInNextcloud(): void
    {
        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getById')->with(42)->willReturn([]);

        $mountCache = $this->createMock(IUserMountCache::class);
        $shareManager = $this->createMock(IManager::class);
        $accessResolver = new AccessResolver(
            $mountCache,
            $shareManager,
            TenantMapperTestFactory::unresolvable(),
            $this->createMock(IUserManager::class),
            $this->createMock(LoggerInterface::class),
        );

        $eventDispatcher = new FakeEventDispatcher();

        $dispatcher = new EventDispatcherNotifyPushDispatcher(
            $rootFolder,
            $accessResolver,
            $eventDispatcher,
            new FakeConfig(),
            $this->createMock(LoggerInterface::class),
        );

        $dispatcher->push(new StatusItem(42, 'done', 'sales_invoice', 'inbound', false, 1));

        self::assertSame([], $eventDispatcher->dispatched);
    }

    public function testSkipsWhenTheVisibleUidSetIsEmpty(): void
    {
        $file = $this->createMock(File::class);
        $file->method('getId')->willReturn(42);

        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getById')->with(42)->willReturn([$file]);

        $mountCache = $this->createMock(IUserMountCache::class);
        $mountCache->method('getMountsForFileId')->willReturn([]);
        $shareManager = $this->createMock(IManager::class);
        $shareManager->method('getAccessList')->willReturn(['users' => []]);
        $accessResolver = new AccessResolver(
            $mountCache,
            $shareManager,
            TenantMapperTestFactory::unresolvable(),
            $this->createMock(IUserManager::class),
            $this->createMock(LoggerInterface::class),
        );

        $eventDispatcher = new FakeEventDispatcher();

        $dispatcher = new EventDispatcherNotifyPushDispatcher(
            $rootFolder,
            $accessResolver,
            $eventDispatcher,
            new FakeConfig(),
            $this->createMock(LoggerInterface::class),
        );

        $dispatcher->push(new StatusItem(42, 'done', 'sales_invoice', 'inbound', false, 1));

        self::assertSame([], $eventDispatcher->dispatched);
    }
}
