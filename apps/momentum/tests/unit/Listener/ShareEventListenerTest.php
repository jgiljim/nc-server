<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Listener;

use DateTimeImmutable;
use OCA\Momentum\Listener\ShareEventListener;
use OCA\Momentum\Service\AccessResolver;
use OCA\Momentum\Service\TenantMapper;
use OCA\Momentum\Tests\Support\FakeConfig;
use OCA\Momentum\Tests\Support\FakeDBConnection;
use OCA\Momentum\Tests\Support\FakeNode;
use OCA\Momentum\Tests\Support\FakeSyncWorkLedgerRepository;
use OCA\Momentum\Tests\Support\FakeTimeFactory;
use OCA\Momentum\Tests\Support\TenantMapperTestFactory;
use OCP\EventDispatcher\Event;
use OCP\Files\Config\IUserMountCache;
use OCP\IGroupManager;
use OCP\IUser;
use OCP\IUserManager;
use OCP\Share\Events\ShareCreatedEvent;
use OCP\Share\Events\ShareDeletedEvent;
use OCP\Share\IManager;
use OCP\Share\IShare;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

final class ShareEventListenerTest extends TestCase
{
    public function testShareCreatedEventResolvesTheOwnersTenantAndEnqueuesAnAccessRow(): void
    {
        $node = new FakeNode(42, '/Invoices/2026/acme-q1.pdf', 'application/pdf', 1024);
        $share = $this->createMock(IShare::class);
        $share->method('getNode')->willReturn($node);
        $share->method('getShareOwner')->willReturn('carol');

        $owner = $this->createConfiguredMock(IUser::class, ['getUID' => 'carol']);
        $userManager = $this->createMock(IUserManager::class);
        $userManager->method('get')->with('carol')->willReturn($owner);

        $tenantMapper = $this->tenantMapperResolvingTo($owner, ['acme-corp'], 12345);

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

        $listener = new ShareEventListener(
            $userManager,
            $tenantMapper,
            $accessResolver,
            $ledger,
            new FakeTimeFactory(1717059600),
            $this->createMock(LoggerInterface::class),
        );

        $listener->handle(new ShareCreatedEvent($share));

        $rows = $ledger->claimDue(new DateTimeImmutable(), 10);
        self::assertCount(1, $rows);
        self::assertSame('access', $rows[0]->target);
        self::assertNull($rows[0]->eventType);
        self::assertSame(42, $rows[0]->docId);
        self::assertSame(12345, $rows[0]->payload['tenant_id']);
        self::assertSame(['alice', 'carol'], $rows[0]->payload['uids']);
        // Confirmed live, 2026-07-28: omitted here (unlike
        // LedgerFilesystemEventSink's own enqueue calls), HttpEventDeliveryClient
        // defaults backend_url to '' at delivery time, building a hostless URL
        // that Nextcloud's own SSRF guard (preventLocalAddress) rejects with
        // "Could not detect any host" on every single attempt, forever — the
        // ledger has no dead-letter tier (RetryBackoff's own docblock), so the
        // row just retries capped-backoff forever instead of ever delivering.
        self::assertSame('https://acme.example', $rows[0]->payload['backend_url']);
        // Confirmed live, 2026-07-28: also omitted here, unlike
        // LedgerFilesystemEventSink's own enqueue calls — HttpEventDeliveryClient
        // mints a token with an empty nc_user_id claim, which the backend's
        // EdDSAVerifier rejects with 401 "missing nc_user_id claim" on every
        // attempt.
        self::assertSame('carol', $rows[0]->payload['nc_user_id']);
    }

    public function testShareDeletedEventAlsoResolvesAndEnqueuesAnAccessRow(): void
    {
        $node = new FakeNode(42, '/Invoices/2026/acme-q1.pdf', 'application/pdf', 1024);
        $share = $this->createMock(IShare::class);
        $share->method('getNode')->willReturn($node);
        $share->method('getShareOwner')->willReturn('carol');

        $owner = $this->createConfiguredMock(IUser::class, ['getUID' => 'carol']);
        $userManager = $this->createMock(IUserManager::class);
        $userManager->method('get')->willReturn($owner);

        $tenantMapper = $this->tenantMapperResolvingTo($owner, ['acme-corp'], 12345);

        $shareManager = $this->createMock(IManager::class);
        $shareManager->method('getAccessList')->willReturn(['users' => ['carol']]);
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

        $listener = new ShareEventListener(
            $userManager,
            $tenantMapper,
            $accessResolver,
            $ledger,
            new FakeTimeFactory(1717059600),
            $this->createMock(LoggerInterface::class),
        );

        $listener->handle(new ShareDeletedEvent($share));

        self::assertCount(1, $ledger->claimDue(new DateTimeImmutable(), 10));
    }

    public function testIgnoresAnUnrelatedEvent(): void
    {
        $userManager = $this->createMock(IUserManager::class);
        $userManager->expects(self::never())->method('get');

        $ledger = new FakeSyncWorkLedgerRepository();

        $tenantMapper = new TenantMapper(new FakeDBConnection(), $this->createMock(IGroupManager::class), $this->createMock(LoggerInterface::class), new FakeConfig());
        $accessResolver = new AccessResolver(
            $this->createMock(IUserMountCache::class),
            $this->createMock(IManager::class),
            TenantMapperTestFactory::unresolvable(),
            $this->createMock(IUserManager::class),
            $this->createMock(LoggerInterface::class),
        );

        $listener = new ShareEventListener(
            $userManager,
            $tenantMapper,
            $accessResolver,
            $ledger,
            new FakeTimeFactory(1717059600),
            $this->createMock(LoggerInterface::class),
        );

        $listener->handle(new Event());

        self::assertCount(0, $ledger->claimDue(new DateTimeImmutable(), 10));
    }

    public function testDropsTheEventWhenTheOwnerNoLongerExists(): void
    {
        $node = new FakeNode(42, '/Invoices/2026/acme-q1.pdf', 'application/pdf', 1024);
        $share = $this->createMock(IShare::class);
        $share->method('getNode')->willReturn($node);
        $share->method('getShareOwner')->willReturn('deleted-user');

        $userManager = $this->createMock(IUserManager::class);
        $userManager->method('get')->willReturn(null);

        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->expects(self::never())->method('getUserGroupIds');
        $tenantMapper = new TenantMapper(new FakeDBConnection(), $groupManager, $this->createMock(LoggerInterface::class), new FakeConfig());

        $ledger = new FakeSyncWorkLedgerRepository();

        $listener = new ShareEventListener(
            $userManager,
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
            $this->createMock(LoggerInterface::class),
        );

        $listener->handle(new ShareCreatedEvent($share));

        self::assertCount(0, $ledger->claimDue(new DateTimeImmutable(), 10));
    }

    public function testDropsTheEventWhenTheOwnerHasNoTenantMapping(): void
    {
        $node = new FakeNode(42, '/Invoices/2026/acme-q1.pdf', 'application/pdf', 1024);
        $share = $this->createMock(IShare::class);
        $share->method('getNode')->willReturn($node);
        $share->method('getShareOwner')->willReturn('carol');

        $owner = $this->createConfiguredMock(IUser::class, ['getUID' => 'carol']);
        $userManager = $this->createMock(IUserManager::class);
        $userManager->method('get')->willReturn($owner);

        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->with($owner)->willReturn([]);

        $logger = $this->createMock(LoggerInterface::class);
        $logger->expects(self::once())->method('info');

        $tenantMapper = new TenantMapper(new FakeDBConnection(), $groupManager, $logger, new FakeConfig());
        $ledger = new FakeSyncWorkLedgerRepository();

        $listener = new ShareEventListener(
            $userManager,
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
            $logger,
        );

        $listener->handle(new ShareCreatedEvent($share));

        self::assertCount(0, $ledger->claimDue(new DateTimeImmutable(), 10));
    }

    public function testCrossTenantShareDropsTheForeignRecipientFromThePostedAccessRow(): void
    {
        $owner = $this->createConfiguredMock(IUser::class, ['getUID' => 'carol']);
        $sameTenantRecipient = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $foreignTenantRecipient = $this->createConfiguredMock(IUser::class, ['getUID' => 'mallory']);

        $node = new FakeNode(42, '/Invoices/2026/acme-q1.pdf', 'application/pdf', 1024, 'etag', 0, $owner);
        $share = $this->createMock(IShare::class);
        $share->method('getNode')->willReturn($node);
        $share->method('getShareOwner')->willReturn('carol');

        $listenerUserManager = $this->createMock(IUserManager::class);
        $listenerUserManager->method('get')->with('carol')->willReturn($owner);

        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturnCallback(
            static fn (IUser $user): array => $user->getUID() === 'mallory' ? ['globex-corp'] : ['acme-corp'],
        );

        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 12345, 'backend_url' => 'https://acme.example'],
            ['user_group_id' => 'globex-corp', 'tenant_id' => 99999, 'backend_url' => 'https://globex.example'],
        ]);
        // One TenantMapper instance, shared between the listener (resolving the
        // owner's own tenant to stamp on the ledger row) and the AccessResolver
        // it's wired with (filtering candidate uids down to that same tenant) —
        // mirrors how these two collaborators are actually wired in production
        // (Application.php's DI container), unlike the other tests in this file
        // which pass AccessResolver an unresolvable TenantMapper and so never
        // exercise the G61 cross-tenant filtering this listener depends on.
        $tenantMapper = new TenantMapper($db, $groupManager, $this->createMock(LoggerInterface::class), new FakeConfig());

        $accessUserManager = $this->createMock(IUserManager::class);
        $accessUserManager->method('get')->willReturnMap([
            ['alice', $sameTenantRecipient],
            ['carol', $owner],
            ['mallory', $foreignTenantRecipient],
        ]);

        $shareManager = $this->createMock(IManager::class);
        $shareManager->method('getAccessList')->with($node)->willReturn([
            'users' => ['alice', 'carol', 'mallory'],
        ]);
        $mountCache = $this->createMock(IUserMountCache::class);
        $mountCache->method('getMountsForFileId')->willReturn([]);
        $accessResolver = new AccessResolver(
            $mountCache,
            $shareManager,
            $tenantMapper,
            $accessUserManager,
            $this->createMock(LoggerInterface::class),
        );

        $ledger = new FakeSyncWorkLedgerRepository();

        $listener = new ShareEventListener(
            $listenerUserManager,
            $tenantMapper,
            $accessResolver,
            $ledger,
            new FakeTimeFactory(1717059600),
            $this->createMock(LoggerInterface::class),
        );

        $listener->handle(new ShareCreatedEvent($share));

        $rows = $ledger->claimDue(new DateTimeImmutable(), 10);
        self::assertCount(1, $rows);
        self::assertSame(['alice', 'carol'], $rows[0]->payload['uids']);
        self::assertNotContains('mallory', $rows[0]->payload['uids']);
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
