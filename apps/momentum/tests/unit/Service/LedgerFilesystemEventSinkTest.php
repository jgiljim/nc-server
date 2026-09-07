<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Service;

use DateTimeImmutable;
use OCA\Momentum\Service\AccessResolver;
use OCA\Momentum\Service\LedgerFilesystemEventSink;
use OCA\Momentum\Service\TenantMapper;
use OCA\Momentum\Tests\Support\FakeConfig;
use OCA\Momentum\Tests\Support\FakeDBConnection;
use OCA\Momentum\Tests\Support\FakeNode;
use OCA\Momentum\Tests\Support\FakeSyncWorkLedgerRepository;
use OCA\Momentum\Tests\Support\FakeTimeFactory;
use OCA\Momentum\Tests\Support\TenantMapperTestFactory;
use OCP\Files\Config\IUserMountCache;
use OCP\IGroupManager;
use OCP\IUser;
use OCP\IUserManager;
use OCP\IUserSession;
use OCP\Share\IManager;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

final class LedgerFilesystemEventSinkTest extends TestCase
{
    public function testCreatedEventEnqueuesBothAnEventsRowAndAnAccessSeedingRow(): void
    {
        $owner = $this->createConfiguredMock(IUser::class, ['getUID' => 'dave']);
        $node = new FakeNode(42, '/Invoices/2026/acme-q1.pdf', 'application/pdf', 1024, 'etag-1', 1717059600, $owner);
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'carol']);

        $userSession = $this->createMock(IUserSession::class);
        $userSession->method('getUser')->willReturn($user);

        $tenantMapper = $this->tenantMapperResolvingTo($user, ['acme-corp'], 12345);

        $shareManager = $this->createMock(IManager::class);
        $shareManager->method('getAccessList')->with($node)->willReturn(['users' => ['alice', 'carol']]);
        $mountCache = $this->createMock(IUserMountCache::class);
        $mountCache->method('getMountsForFileId')->willReturn([]);
        $accessResolver = new AccessResolver(
            $mountCache,
            $shareManager,
            TenantMapperTestFactory::unresolvable(),
            $this->createMock(IUserManager::class),
            $this->createMock(LoggerInterface::class),
        );

        $ledger = new FakeSyncWorkLedgerRepository();
        $config = new FakeConfig(appValues: ['momentum' => ['nc_instance_id' => '7']]);

        $sink = new LedgerFilesystemEventSink(
            $userSession,
            $tenantMapper,
            $accessResolver,
            $ledger,
            new FakeTimeFactory(1717059600),
            $config,
            $this->createMock(LoggerInterface::class),
        );

        $sink->handle($node, 'created');

        $rows = $ledger->claimDue(new DateTimeImmutable(), 10);
        self::assertCount(2, $rows);

        [$eventsRow, $accessRow] = $rows;

        self::assertSame('events', $eventsRow->target);
        self::assertSame('created', $eventsRow->eventType);
        self::assertSame(42, $eventsRow->docId);
        self::assertSame([
            'tenant_id' => 12345,
            'nc_instance_id' => 7,
            'doc_id' => 42,
            'event_type' => 'created',
            'mime_type' => 'application/pdf',
            'path' => '/Invoices/2026/acme-q1.pdf',
            'etag' => 'etag-1',
            'mtime' => 1717059600,
            'owner_uid' => 'dave',
            'nc_user_id' => 'carol',
            'backend_url' => 'https://acme.example',
        ], $eventsRow->payload);

        self::assertSame('access', $accessRow->target);
        self::assertNull($accessRow->eventType);
        self::assertSame(42, $accessRow->docId);
        self::assertSame(12345, $accessRow->payload['tenant_id']);
        self::assertSame(42, $accessRow->payload['doc_id']);
        self::assertSame(['alice', 'carol'], $accessRow->payload['uids']);
        self::assertIsString($accessRow->payload['resolved_at']);
        self::assertSame('carol', $accessRow->payload['nc_user_id']);
        self::assertSame('https://acme.example', $accessRow->payload['backend_url']);
    }

    public function testUpdatedEventEnqueuesOnlyAnEventsRow(): void
    {
        $node = new FakeNode(42, '/Invoices/2026/acme-q1.pdf', 'application/pdf', 1024);
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'carol']);

        $userSession = $this->createMock(IUserSession::class);
        $userSession->method('getUser')->willReturn($user);

        $tenantMapper = $this->tenantMapperResolvingTo($user, ['acme-corp'], 12345);

        $mountCache = $this->createMock(IUserMountCache::class);
        $mountCache->expects(self::never())->method('getMountsForFileId');
        $shareManager = $this->createMock(IManager::class);
        $shareManager->expects(self::never())->method('getAccessList');
        $accessResolver = new AccessResolver(
            $mountCache,
            $shareManager,
            TenantMapperTestFactory::unresolvable(),
            $this->createMock(IUserManager::class),
            $this->createMock(LoggerInterface::class),
        );

        $ledger = new FakeSyncWorkLedgerRepository();

        $sink = new LedgerFilesystemEventSink(
            $userSession,
            $tenantMapper,
            $accessResolver,
            $ledger,
            new FakeTimeFactory(1717059600),
            new FakeConfig(),
            $this->createMock(LoggerInterface::class),
        );

        $sink->handle($node, 'updated');

        $rows = $ledger->claimDue(new DateTimeImmutable(), 10);
        self::assertCount(1, $rows);
        self::assertSame('events', $rows[0]->target);
        self::assertSame('', $rows[0]->payload['owner_uid'], 'a node with no resolvable owner must not crash the sink');
    }

    public function testDropsTheEventWhenThereIsNoActingUser(): void
    {
        $node = new FakeNode(42, '/Invoices/2026/acme-q1.pdf', 'application/pdf', 1024);

        $userSession = $this->createMock(IUserSession::class);
        $userSession->method('getUser')->willReturn(null);

        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->expects(self::never())->method('getUserGroupIds');
        $tenantMapper = new TenantMapper(new FakeDBConnection(), $groupManager, $this->createMock(LoggerInterface::class), new FakeConfig());

        $ledger = new FakeSyncWorkLedgerRepository();

        $sink = new LedgerFilesystemEventSink(
            $userSession,
            $tenantMapper,
            new AccessResolver(
                $this->createMock(IUserMountCache::class),
                $this->createMock(IManager::class),
                TenantMapperTestFactory::unresolvable(),
                $this->createMock(IUserManager::class),
                $this->createMock(LoggerInterface::class),
            ),
            $ledger,
            new FakeTimeFactory(1717059600),
            new FakeConfig(),
            $this->createMock(LoggerInterface::class),
        );

        $sink->handle($node, 'created');

        self::assertCount(0, $ledger->claimDue(new DateTimeImmutable(), 10));
    }

    public function testDropsTheEventWhenTheUserHasNoTenantMapping(): void
    {
        $node = new FakeNode(42, '/Invoices/2026/acme-q1.pdf', 'application/pdf', 1024);
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'bob']);

        $userSession = $this->createMock(IUserSession::class);
        $userSession->method('getUser')->willReturn($user);

        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->with($user)->willReturn([]);

        $logger = $this->createMock(LoggerInterface::class);
        $logger->expects(self::once())->method('info');

        $tenantMapper = new TenantMapper(new FakeDBConnection(), $groupManager, $logger, new FakeConfig());
        $ledger = new FakeSyncWorkLedgerRepository();

        $sink = new LedgerFilesystemEventSink(
            $userSession,
            $tenantMapper,
            new AccessResolver(
                $this->createMock(IUserMountCache::class),
                $this->createMock(IManager::class),
                TenantMapperTestFactory::unresolvable(),
                $this->createMock(IUserManager::class),
                $this->createMock(LoggerInterface::class),
            ),
            $ledger,
            new FakeTimeFactory(1717059600),
            new FakeConfig(),
            $logger,
        );

        $sink->handle($node, 'created');

        self::assertCount(0, $ledger->claimDue(new DateTimeImmutable(), 10));
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
