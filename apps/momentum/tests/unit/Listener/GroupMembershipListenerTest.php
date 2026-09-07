<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Listener;

use OCA\Momentum\Listener\GroupMembershipListener;
use OCA\Momentum\Service\TenantMapper;
use OCA\Momentum\Tests\Support\FakeConfig;
use OCA\Momentum\Tests\Support\FakeDBConnection;
use OCA\Momentum\Tests\Support\FakeScopedReconcileTaskRepository;
use OCA\Momentum\Tests\Support\FakeTimeFactory;
use OCP\EventDispatcher\Event;
use OCP\Group\Events\UserAddedEvent;
use OCP\Group\Events\UserRemovedEvent;
use OCP\IGroupManager;
use OCP\IUser;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

final class GroupMembershipListenerTest extends TestCase
{
    public function testUserAddedEventEnqueuesExactlyOneTaskRootedAtTheUsersHomeFolder(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $tenantMapper = $this->tenantMapperResolvingTo($user, ['acme-corp'], 12345);
        $tasks = new FakeScopedReconcileTaskRepository();

        $listener = new GroupMembershipListener(
            $tenantMapper,
            $tasks,
            new FakeTimeFactory(1717059600),
            $this->createMock(LoggerInterface::class),
        );

        $listener->handle(new UserAddedEvent($user));

        self::assertSame(1, $tasks->count());
        $task = $tasks->all()[0];
        self::assertSame(12345, $task['tenantId']);
        self::assertSame('group', $task['scope']);
        self::assertSame('alice', $task['ownerUid']);
        self::assertNull($task['rootFileId']);
    }

    public function testUserRemovedEventAlsoEnqueuesOneTask(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'bob']);
        $tenantMapper = $this->tenantMapperResolvingTo($user, ['acme-corp'], 999);
        $tasks = new FakeScopedReconcileTaskRepository();

        $listener = new GroupMembershipListener(
            $tenantMapper,
            $tasks,
            new FakeTimeFactory(1717059600),
            $this->createMock(LoggerInterface::class),
        );

        $listener->handle(new UserRemovedEvent($user));

        self::assertSame(1, $tasks->count());
    }

    public function testIgnoresAnUnrelatedEvent(): void
    {
        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->expects(self::never())->method('getUserGroupIds');
        $tenantMapper = new TenantMapper(new FakeDBConnection(), $groupManager, $this->createMock(LoggerInterface::class), new FakeConfig());
        $tasks = new FakeScopedReconcileTaskRepository();

        $listener = new GroupMembershipListener(
            $tenantMapper,
            $tasks,
            new FakeTimeFactory(1717059600),
            $this->createMock(LoggerInterface::class),
        );

        $listener->handle(new Event());

        self::assertSame(0, $tasks->count());
    }

    public function testDropsTheEventWhenTheUserHasNoTenantMapping(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'ghost']);
        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->with($user)->willReturn([]);

        $logger = $this->createMock(LoggerInterface::class);
        $logger->expects(self::once())->method('info');

        $tenantMapper = new TenantMapper(new FakeDBConnection(), $groupManager, $logger, new FakeConfig());
        $tasks = new FakeScopedReconcileTaskRepository();

        $listener = new GroupMembershipListener(
            $tenantMapper,
            $tasks,
            new FakeTimeFactory(1717059600),
            $logger,
        );

        $listener->handle(new UserAddedEvent($user));

        self::assertSame(0, $tasks->count());
    }

    /**
     * @param list<string> $groupIds
     */
    private function tenantMapperResolvingTo(IUser $user, array $groupIds, int $tenantId): TenantMapper
    {
        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->with($user)->willReturn($groupIds);

        $db = new FakeDBConnection([
            ['user_group_id' => $groupIds[0], 'tenant_id' => $tenantId, 'backend_url' => 'https://acme.example'],
        ]);

        return new TenantMapper($db, $groupManager, $this->createMock(LoggerInterface::class), new FakeConfig());
    }
}
