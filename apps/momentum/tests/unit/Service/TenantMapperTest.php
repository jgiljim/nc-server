<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Service;

use OCA\Momentum\AppInfo\Application;
use OCA\Momentum\Exception\AmbiguousTenantMappingException;
use OCA\Momentum\Exception\NoTenantMappingException;
use OCA\Momentum\Service\TenantMapper;
use OCA\Momentum\Tests\Support\FakeConfig;
use OCA\Momentum\Tests\Support\FakeDBConnection;
use OCP\IGroupManager;
use OCP\IUser;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

final class TenantMapperTest extends TestCase
{
    public function testResolvesTenantWhenExactlyOneRegisteredGroupMatches(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->with($user)->willReturn(['acme-corp', 'some-other-group']);

        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 42, 'backend_url' => 'https://acme.momentum.example'],
        ]);

        $mapper = new TenantMapper($db, $groupManager, $this->createMock(LoggerInterface::class), new FakeConfig());

        $mapping = $mapper->resolve($user);

        self::assertSame(42, $mapping->tenantId);
        self::assertSame('https://acme.momentum.example', $mapping->backendUrl);
    }

    public function testThrowsNoTenantMappingExceptionWhenUserHasNoGroups(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'bob']);
        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturn([]);

        $mapper = new TenantMapper(new FakeDBConnection(), $groupManager, $this->createMock(LoggerInterface::class), new FakeConfig());

        $this->expectException(NoTenantMappingException::class);
        $mapper->resolve($user);
    }

    public function testThrowsNoTenantMappingExceptionWhenNoGroupIsRegisteredAsACustomer(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'carol']);
        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturn(['unregistered-group']);

        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 42, 'backend_url' => 'https://acme.momentum.example'],
        ]);

        $mapper = new TenantMapper($db, $groupManager, $this->createMock(LoggerInterface::class), new FakeConfig());

        $this->expectException(NoTenantMappingException::class);
        $mapper->resolve($user);
    }

    public function testFailsClosedAndAlertsWhenUserMatchesTwoRegisteredCustomerGroups(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'dave']);
        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturn(['acme-corp', 'globex-corp']);

        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 42, 'backend_url' => 'https://acme.momentum.example'],
            ['user_group_id' => 'globex-corp', 'tenant_id' => 43, 'backend_url' => 'https://globex.momentum.example'],
        ]);

        $logger = $this->createMock(LoggerInterface::class);
        $logger->expects(self::once())->method('error');

        $mapper = new TenantMapper($db, $groupManager, $logger, new FakeConfig());

        $this->expectException(AmbiguousTenantMappingException::class);
        $mapper->resolve($user);
    }

    public function testListAllReturnsEveryRegisteredTenantGroupMapping(): void
    {
        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 42, 'backend_url' => 'https://acme.momentum.example'],
            ['user_group_id' => 'globex-corp', 'tenant_id' => 43, 'backend_url' => 'https://globex.momentum.example'],
        ]);

        $mapper = new TenantMapper($db, $this->createMock(IGroupManager::class), $this->createMock(LoggerInterface::class), new FakeConfig());

        $mappings = $mapper->listAll();

        self::assertCount(2, $mappings);
        self::assertSame(42, $mappings[0]->tenantId);
        self::assertSame('acme-corp', $mappings[0]->groupId);
        self::assertSame(43, $mappings[1]->tenantId);
        self::assertSame('globex-corp', $mappings[1]->groupId);
    }

    public function testListAllReturnsEmptyArrayWhenNoTenantsAreRegistered(): void
    {
        $mapper = new TenantMapper(new FakeDBConnection(), $this->createMock(IGroupManager::class), $this->createMock(LoggerInterface::class), new FakeConfig());

        self::assertSame([], $mapper->listAll());
    }

    public function testBackendUrlForTenantResolvesDirectlyByTenantIdWithoutConsultingGroupMembership(): void
    {
        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 42, 'backend_url' => 'https://acme.momentum.example'],
            ['user_group_id' => 'globex-corp', 'tenant_id' => 43, 'backend_url' => 'https://globex.momentum.example'],
        ]);
        // A group manager that would fail the test if consulted — this
        // lookup must not re-derive the tenant via resolve()'s
        // group-intersection logic (see backendUrlForTenant()'s docblock).
        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->expects(self::never())->method('getUserGroupIds');

        $mapper = new TenantMapper($db, $groupManager, $this->createMock(LoggerInterface::class), new FakeConfig());

        self::assertSame('https://globex.momentum.example', $mapper->backendUrlForTenant(43));
    }

    public function testBackendUrlForTenantReturnsNullWhenTheTenantIsNotRegistered(): void
    {
        $mapper = new TenantMapper(new FakeDBConnection(), $this->createMock(IGroupManager::class), $this->createMock(LoggerInterface::class), new FakeConfig());

        self::assertNull($mapper->backendUrlForTenant(99));
    }

    public function testGroupIdForTenantResolvesDirectlyByTenantIdWithoutConsultingGroupMembership(): void
    {
        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 42, 'backend_url' => 'https://acme.momentum.example'],
            ['user_group_id' => 'globex-corp', 'tenant_id' => 43, 'backend_url' => 'https://globex.momentum.example'],
        ]);
        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->expects(self::never())->method('getUserGroupIds');

        $mapper = new TenantMapper($db, $groupManager, $this->createMock(LoggerInterface::class), new FakeConfig());

        self::assertSame('globex-corp', $mapper->groupIdForTenant(43));
    }

    public function testGroupIdForTenantReturnsNullWhenTheTenantIsNotRegistered(): void
    {
        $mapper = new TenantMapper(new FakeDBConnection(), $this->createMock(IGroupManager::class), $this->createMock(LoggerInterface::class), new FakeConfig());

        self::assertNull($mapper->groupIdForTenant(99));
    }

    public function testAccountAttributeModeResolvesTenantFromTheStampedAttributeIgnoringGroups(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'erin']);
        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->expects(self::never())->method('getUserGroupIds');

        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 42, 'backend_url' => 'https://acme.momentum.example'],
        ]);

        $config = new FakeConfig(
            appValues: [Application::APP_ID => ['tenant_resolution_mode' => 'account_attribute']],
            userValues: [Application::APP_ID => ['erin' => ['tenant_attribute' => 'acme-corp']]],
        );

        $mapper = new TenantMapper($db, $groupManager, $this->createMock(LoggerInterface::class), $config);

        $mapping = $mapper->resolve($user);

        self::assertSame(42, $mapping->tenantId);
        self::assertSame('https://acme.momentum.example', $mapping->backendUrl);
    }

    public function testAccountAttributeModeThrowsNoTenantMappingExceptionWhenAttributeIsUnset(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'frank']);

        $config = new FakeConfig(
            appValues: [Application::APP_ID => ['tenant_resolution_mode' => 'account_attribute']],
        );

        $mapper = new TenantMapper(new FakeDBConnection(), $this->createMock(IGroupManager::class), $this->createMock(LoggerInterface::class), $config);

        $this->expectException(NoTenantMappingException::class);
        $mapper->resolve($user);
    }

    public function testAccountAttributeModeThrowsNoTenantMappingExceptionWhenAttributeMatchesNoRegisteredTenant(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'grace']);

        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 42, 'backend_url' => 'https://acme.momentum.example'],
        ]);

        $config = new FakeConfig(
            appValues: [Application::APP_ID => ['tenant_resolution_mode' => 'account_attribute']],
            userValues: [Application::APP_ID => ['grace' => ['tenant_attribute' => 'unregistered-attribute']]],
        );

        $mapper = new TenantMapper($db, $this->createMock(IGroupManager::class), $this->createMock(LoggerInterface::class), $config);

        $this->expectException(NoTenantMappingException::class);
        $mapper->resolve($user);
    }

    public function testResolveTenantIdsBatchesGroupIntersectionUsersIntoASingleQuery(): void
    {
        $alice = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $bob = $this->createConfiguredMock(IUser::class, ['getUID' => 'bob']);

        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturnCallback(
            static fn (IUser $user): array => $user->getUID() === 'bob' ? ['globex-corp'] : ['acme-corp'],
        );

        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 42, 'backend_url' => 'https://acme.momentum.example'],
            ['user_group_id' => 'globex-corp', 'tenant_id' => 43, 'backend_url' => 'https://globex.momentum.example'],
        ]);

        $mapper = new TenantMapper($db, $groupManager, $this->createMock(LoggerInterface::class), new FakeConfig());

        self::assertSame(
            ['alice' => 42, 'bob' => 43],
            $mapper->resolveTenantIds([$alice, $bob]),
        );
    }

    public function testResolveTenantIdsOmitsAUserWithNoRegisteredGroupWithoutFailingTheBatch(): void
    {
        $alice = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $orphan = $this->createConfiguredMock(IUser::class, ['getUID' => 'orphan']);

        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturnCallback(
            static fn (IUser $user): array => $user->getUID() === 'orphan' ? [] : ['acme-corp'],
        );

        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 42, 'backend_url' => 'https://acme.momentum.example'],
        ]);

        $logger = $this->createMock(LoggerInterface::class);
        $logger->expects(self::once())->method('info');

        $mapper = new TenantMapper($db, $groupManager, $logger, new FakeConfig());

        self::assertSame(
            ['alice' => 42],
            $mapper->resolveTenantIds([$alice, $orphan]),
        );
    }

    public function testResolveTenantIdsOmitsAUserWhoMatchesMultipleTenantsWithoutFailingTheBatch(): void
    {
        $alice = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $dave = $this->createConfiguredMock(IUser::class, ['getUID' => 'dave']);

        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturnCallback(
            static fn (IUser $user): array => $user->getUID() === 'dave' ? ['acme-corp', 'globex-corp'] : ['acme-corp'],
        );

        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 42, 'backend_url' => 'https://acme.momentum.example'],
            ['user_group_id' => 'globex-corp', 'tenant_id' => 43, 'backend_url' => 'https://globex.momentum.example'],
        ]);

        $logger = $this->createMock(LoggerInterface::class);
        $logger->expects(self::once())->method('error');

        $mapper = new TenantMapper($db, $groupManager, $logger, new FakeConfig());

        self::assertSame(
            ['alice' => 42],
            $mapper->resolveTenantIds([$alice, $dave]),
        );
    }

    public function testResolveTenantIdsBatchesAccountAttributeUsersIntoASingleQuery(): void
    {
        $erin = $this->createConfiguredMock(IUser::class, ['getUID' => 'erin']);
        $frank = $this->createConfiguredMock(IUser::class, ['getUID' => 'frank']);

        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 42, 'backend_url' => 'https://acme.momentum.example'],
        ]);

        $config = new FakeConfig(
            appValues: [Application::APP_ID => ['tenant_resolution_mode' => 'account_attribute']],
            userValues: [Application::APP_ID => ['erin' => ['tenant_attribute' => 'acme-corp']]],
        );

        $logger = $this->createMock(LoggerInterface::class);
        $logger->expects(self::once())->method('info');

        $mapper = new TenantMapper($db, $this->createMock(IGroupManager::class), $logger, $config);

        self::assertSame(
            ['erin' => 42],
            $mapper->resolveTenantIds([$erin, $frank]),
        );
    }
}
