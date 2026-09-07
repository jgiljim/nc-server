<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Service;

use OCA\Momentum\Service\AccessResolver;
use OCA\Momentum\Service\TenantMapper;
use OCA\Momentum\Tests\Support\FakeConfig;
use OCA\Momentum\Tests\Support\FakeDBConnection;
use OCA\Momentum\Tests\Support\FakeNode;
use OCA\Momentum\Tests\Support\TenantMapperTestFactory;
use OCP\Files\Config\ICachedMountInfo;
use OCP\Files\Config\IUserMountCache;
use OCP\IGroupManager;
use OCP\IUser;
use OCP\IUserManager;
use OCP\Share\IManager;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

final class AccessResolverTest extends TestCase
{
    public function testMergesMountOwnerAndShareRecipientsDeduplicatedAndSorted(): void
    {
        $node = new FakeNode(42, '/Invoices/2026/acme-q1.pdf', 'application/pdf', 1024);

        $ownerMount = $this->createMock(ICachedMountInfo::class);
        $ownerMount->method('getUser')->willReturn($this->createConfiguredMock(IUser::class, ['getUID' => 'carol']));

        $mountCache = $this->createMock(IUserMountCache::class);
        $mountCache->method('getMountsForFileId')->with(42)->willReturn([$ownerMount]);

        $shareManager = $this->createMock(IManager::class);
        $shareManager->method('getAccessList')->with($node)->willReturn([
            'users' => ['alice', 'carol'],
        ]);

        $resolver = new AccessResolver(
            $mountCache,
            $shareManager,
            TenantMapperTestFactory::unresolvable(),
            $this->createMock(IUserManager::class),
            $this->createMock(LoggerInterface::class),
        );

        self::assertSame(['alice', 'carol'], $resolver->resolveUids($node));
    }

    public function testResolvesToAnEmptySetWhenTheFileIsFullyRevoked(): void
    {
        $node = new FakeNode(42, '/Invoices/2026/acme-q1.pdf', 'application/pdf', 1024);

        $mountCache = $this->createMock(IUserMountCache::class);
        $mountCache->method('getMountsForFileId')->willReturn([]);

        $shareManager = $this->createMock(IManager::class);
        $shareManager->method('getAccessList')->willReturn(['users' => []]);

        $resolver = new AccessResolver(
            $mountCache,
            $shareManager,
            TenantMapperTestFactory::unresolvable(),
            $this->createMock(IUserManager::class),
            $this->createMock(LoggerInterface::class),
        );

        self::assertSame([], $resolver->resolveUids($node));
    }

    public function testCrossTenantShareDropsTheForeignRecipientButKeepsSameTenantUids(): void
    {
        $owner = $this->createConfiguredMock(IUser::class, ['getUID' => 'carol']);
        $sameTenantRecipient = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $foreignTenantRecipient = $this->createConfiguredMock(IUser::class, ['getUID' => 'mallory']);

        $node = new FakeNode(42, '/Invoices/2026/acme-q1.pdf', 'application/pdf', 1024, 'etag', 0, $owner);

        $mountCache = $this->createMock(IUserMountCache::class);
        $mountCache->method('getMountsForFileId')->willReturn([]);
        $shareManager = $this->createMock(IManager::class);
        $shareManager->method('getAccessList')->with($node)->willReturn([
            'users' => ['alice', 'carol', 'mallory'],
        ]);

        $userManager = $this->createMock(IUserManager::class);
        $userManager->method('get')->willReturnMap([
            ['alice', $sameTenantRecipient],
            ['carol', $owner],
            ['mallory', $foreignTenantRecipient],
        ]);

        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturnCallback(
            static fn (IUser $user): array => $user->getUID() === 'mallory' ? ['globex-corp'] : ['acme-corp'],
        );

        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 42, 'backend_url' => 'https://acme.example'],
            ['user_group_id' => 'globex-corp', 'tenant_id' => 43, 'backend_url' => 'https://globex.example'],
        ]);
        $tenantMapper = new TenantMapper($db, $groupManager, $this->createMock(LoggerInterface::class), new FakeConfig());

        $resolver = new AccessResolver(
            $mountCache,
            $shareManager,
            $tenantMapper,
            $userManager,
            $this->createMock(LoggerInterface::class),
        );

        self::assertSame(['alice', 'carol'], $resolver->resolveUids($node));
    }

    public function testDropsOnlyTheOneCandidateUidThatHasNoTenantMapping(): void
    {
        $owner = $this->createConfiguredMock(IUser::class, ['getUID' => 'carol']);
        $sameTenantRecipient = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $unmappedRecipient = $this->createConfiguredMock(IUser::class, ['getUID' => 'orphan']);

        $node = new FakeNode(42, '/Invoices/2026/acme-q1.pdf', 'application/pdf', 1024, 'etag', 0, $owner);

        $mountCache = $this->createMock(IUserMountCache::class);
        $mountCache->method('getMountsForFileId')->willReturn([]);
        $shareManager = $this->createMock(IManager::class);
        $shareManager->method('getAccessList')->with($node)->willReturn([
            'users' => ['alice', 'carol', 'orphan'],
        ]);

        $userManager = $this->createMock(IUserManager::class);
        $userManager->method('get')->willReturnMap([
            ['alice', $sameTenantRecipient],
            ['carol', $owner],
            ['orphan', $unmappedRecipient],
        ]);

        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturnCallback(
            static fn (IUser $user): array => $user->getUID() === 'orphan' ? [] : ['acme-corp'],
        );

        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 42, 'backend_url' => 'https://acme.example'],
        ]);
        $tenantMapper = new TenantMapper($db, $groupManager, $this->createMock(LoggerInterface::class), new FakeConfig());

        $logger = $this->createMock(LoggerInterface::class);
        $logger->expects(self::atLeastOnce())->method('info');

        $resolver = new AccessResolver($mountCache, $shareManager, $tenantMapper, $userManager, $logger);

        self::assertSame(['alice', 'carol'], $resolver->resolveUids($node));
    }

    public function testDropsAUidThatIsNoLongerARegisteredNextcloudUser(): void
    {
        $owner = $this->createConfiguredMock(IUser::class, ['getUID' => 'carol']);
        $node = new FakeNode(42, '/Invoices/2026/acme-q1.pdf', 'application/pdf', 1024, 'etag', 0, $owner);

        $mountCache = $this->createMock(IUserMountCache::class);
        $mountCache->method('getMountsForFileId')->willReturn([]);
        $shareManager = $this->createMock(IManager::class);
        $shareManager->method('getAccessList')->with($node)->willReturn([
            'users' => ['carol', 'deleted-user'],
        ]);

        $userManager = $this->createMock(IUserManager::class);
        $userManager->method('get')->willReturnMap([
            ['carol', $owner],
            ['deleted-user', null],
        ]);

        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->with($owner)->willReturn(['acme-corp']);

        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 42, 'backend_url' => 'https://acme.example'],
        ]);
        $tenantMapper = new TenantMapper($db, $groupManager, $this->createMock(LoggerInterface::class), new FakeConfig());

        $resolver = new AccessResolver(
            $mountCache,
            $shareManager,
            $tenantMapper,
            $userManager,
            $this->createMock(LoggerInterface::class),
        );

        self::assertSame(['carol'], $resolver->resolveUids($node));
    }

    public function testFallsBackToTheUnfilteredSetWhenTheOwnersTenantCannotBeResolved(): void
    {
        $owner = $this->createConfiguredMock(IUser::class, ['getUID' => 'carol']);
        $node = new FakeNode(42, '/Invoices/2026/acme-q1.pdf', 'application/pdf', 1024, 'etag', 0, $owner);

        $mountCache = $this->createMock(IUserMountCache::class);
        $mountCache->method('getMountsForFileId')->willReturn([]);
        $shareManager = $this->createMock(IManager::class);
        $shareManager->method('getAccessList')->with($node)->willReturn([
            'users' => ['alice', 'carol'],
        ]);

        $logger = $this->createMock(LoggerInterface::class);
        $logger->expects(self::once())->method('warning');

        $resolver = new AccessResolver(
            $mountCache,
            $shareManager,
            TenantMapperTestFactory::unresolvable(),
            $this->createMock(IUserManager::class),
            $logger,
        );

        self::assertSame(['alice', 'carol'], $resolver->resolveUids($node));
    }

    public function testFallsBackToTheUnfilteredSetWhenTheNodeHasNoOwner(): void
    {
        $node = new FakeNode(42, '/Invoices/2026/acme-q1.pdf', 'application/pdf', 1024);

        $mountCache = $this->createMock(IUserMountCache::class);
        $mountCache->method('getMountsForFileId')->willReturn([]);
        $shareManager = $this->createMock(IManager::class);
        $shareManager->method('getAccessList')->with($node)->willReturn([
            'users' => ['alice', 'carol'],
        ]);

        $logger = $this->createMock(LoggerInterface::class);
        $logger->expects(self::once())->method('warning');

        $resolver = new AccessResolver(
            $mountCache,
            $shareManager,
            TenantMapperTestFactory::unresolvable(),
            $this->createMock(IUserManager::class),
            $logger,
        );

        self::assertSame(['alice', 'carol'], $resolver->resolveUids($node));
    }
}
