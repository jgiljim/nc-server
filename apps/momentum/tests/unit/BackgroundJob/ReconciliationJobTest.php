<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\BackgroundJob;

use OCA\Momentum\AppInfo\Application;
use OCA\Momentum\BackgroundJob\ReconciliationJob;
use OCA\Momentum\Db\DbScopedReconcileTaskRepository;
use OCA\Momentum\Service\AccessResolver;
use OCA\Momentum\Service\FullTenantReconciliation\FullTenantReconciliationPass;
use OCA\Momentum\Service\ScopedReconciliation\ScopedReconciliationPass;
use OCA\Momentum\Service\TenantMapper;
use OCA\Momentum\Tests\Support\FakeConfig;
use OCA\Momentum\Tests\Support\FakeDBConnection;
use OCA\Momentum\Tests\Support\FakeFile;
use OCA\Momentum\Tests\Support\FakeFolder;
use OCA\Momentum\Tests\Support\FakeScopedReconcileDbConnection;
use OCA\Momentum\Tests\Support\FakeScopedReconcileTaskRepository;
use OCA\Momentum\Tests\Support\FakeSyncWorkLedgerRepository;
use OCA\Momentum\Tests\Support\TenantMapperTestFactory;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\Config\IUserMountCache;
use OCP\Files\IRootFolder;
use OCP\Group\IGroup;
use OCP\IGroupManager;
use OCP\IUser;
use OCP\IUserManager;
use OCP\Share\IManager;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;
use ReflectionMethod;

final class ReconciliationJobTest extends TestCase
{
    private function invokeRun(ReconciliationJob $job): void
    {
        $method = new ReflectionMethod($job, 'run');
        $method->setAccessible(true);
        $method->invoke($job, null);
    }

    public function testEnqueuesFullTenantTasksAndDrainsThemInTheSameTick(): void
    {
        $timeFactory = $this->createMock(ITimeFactory::class);
        $timeFactory->method('getTime')->willReturn(1784332800); // 2026-07-18T00:00:00Z

        $tenantDb = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 42, 'backend_url' => 'https://acme.example'],
        ]);
        $tenantMapper = new TenantMapper($tenantDb, $this->createMock(IGroupManager::class), $this->createMock(LoggerInterface::class), new FakeConfig());

        $aliceUser = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $group = $this->createMock(IGroup::class);
        $group->method('getUsers')->willReturn([$aliceUser]);
        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('get')->with('acme-corp')->willReturn($group);

        $reconcileDb = new FakeScopedReconcileDbConnection();
        $tasks = new DbScopedReconcileTaskRepository($reconcileDb);
        $config = new FakeConfig();

        $fullTenantPass = new FullTenantReconciliationPass(
            $tenantMapper,
            $groupManager,
            $tasks,
            $config,
            $this->createMock(LoggerInterface::class),
        );

        $file = new FakeFile(101, '/alice/files/doc.pdf');
        $aliceFolder = new FakeFolder(1, '/alice/files', [$file]);
        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getUserFolder')->with('alice')->willReturn($aliceFolder);

        $mountCache = $this->createMock(IUserMountCache::class);
        $mountCache->method('getMountsForFileId')->willReturn([]);
        $shareManager = $this->createMock(IManager::class);
        $shareManager->method('getAccessList')->willReturn(['users' => ['alice']]);
        $accessResolver = new AccessResolver(
            $mountCache,
            $shareManager,
            TenantMapperTestFactory::unresolvable(),
            $this->createMock(IUserManager::class),
            $this->createMock(LoggerInterface::class),
        );

        $ledger = new FakeSyncWorkLedgerRepository();

        $scopedPass = new ScopedReconciliationPass(
            $tasks,
            $rootFolder,
            $accessResolver,
            $ledger,
            $tenantMapper,
            $this->createMock(LoggerInterface::class),
        );

        $job = new ReconciliationJob($timeFactory, $fullTenantPass, $scopedPass, $config, $this->createMock(LoggerInterface::class));

        $this->invokeRun($job);

        self::assertSame('1784332800', $config->getAppValue('momentum', 'full_tenant_reconcile_last_run_at'));
        $payloads = $this->drainedLedgerPayloads($ledger);
        self::assertNotEmpty($payloads);
        self::assertSame('https://acme.example', $payloads[0]['backend_url']);
        self::assertSame('alice', $payloads[0]['nc_user_id']);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function drainedLedgerPayloads(FakeSyncWorkLedgerRepository $ledger): array
    {
        $rows = $ledger->claimDue(new \DateTimeImmutable('now'), 100);

        return array_map(static fn ($row) => $row->payload, $rows);
    }

    public function testDoesNothingWhenNoTenantsAreRegisteredAndNoTasksArePending(): void
    {
        $timeFactory = $this->createMock(ITimeFactory::class);
        $timeFactory->method('getTime')->willReturn(1784332800);

        $tenantMapper = new TenantMapper(new FakeDBConnection(), $this->createMock(IGroupManager::class), $this->createMock(LoggerInterface::class), new FakeConfig());
        $groupManager = $this->createMock(IGroupManager::class);
        $tasks = new DbScopedReconcileTaskRepository(new FakeScopedReconcileDbConnection());
        $config = new FakeConfig();

        $fullTenantPass = new FullTenantReconciliationPass(
            $tenantMapper,
            $groupManager,
            $tasks,
            $config,
            $this->createMock(LoggerInterface::class),
        );

        $rootFolder = $this->createMock(IRootFolder::class);
        $mountCache = $this->createMock(IUserMountCache::class);
        $shareManager = $this->createMock(IManager::class);
        $accessResolver = new AccessResolver(
            $mountCache,
            $shareManager,
            TenantMapperTestFactory::unresolvable(),
            $this->createMock(IUserManager::class),
            $this->createMock(LoggerInterface::class),
        );
        $ledger = new FakeSyncWorkLedgerRepository();

        $scopedPass = new ScopedReconciliationPass(
            $tasks,
            $rootFolder,
            $accessResolver,
            $ledger,
            $tenantMapper,
            $this->createMock(LoggerInterface::class),
        );

        $job = new ReconciliationJob($timeFactory, $fullTenantPass, $scopedPass, $config, $this->createMock(LoggerInterface::class));

        $this->invokeRun($job);

        self::assertSame([], $ledger->claimDue(new \DateTimeImmutable('now'), 100));
        self::assertSame('1784332800', $config->getAppValue('momentum', 'full_tenant_reconcile_last_run_at'));
    }

    public function testUsesTheConfiguredFullTenantReconcileIntervalInsteadOfTheHardcodedDefault(): void
    {
        $timeFactory = $this->createMock(ITimeFactory::class);
        $timeFactory->method('getTime')->willReturn(1784332800 + 3600); // 1h after last run

        $tenantDb = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 42, 'backend_url' => 'https://acme.example'],
        ]);
        $tenantMapper = new TenantMapper($tenantDb, $this->createMock(IGroupManager::class), $this->createMock(LoggerInterface::class), new FakeConfig());

        $aliceUser = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $group = $this->createMock(IGroup::class);
        $group->method('getUsers')->willReturn([$aliceUser]);
        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('get')->with('acme-corp')->willReturn($group);

        $tasks = new FakeScopedReconcileTaskRepository();

        // Last run was 1h ago; interval configured down to 30 minutes, so this tick should run
        // again even though the default (24h) would have skipped it.
        $config = new FakeConfig([], [
            'momentum' => [
                'full_tenant_reconcile_last_run_at' => '1784332800',
                'full_tenant_reconcile_interval_seconds' => '1800',
            ],
        ]);

        $fullTenantPass = new FullTenantReconciliationPass(
            $tenantMapper,
            $groupManager,
            $tasks,
            $config,
            $this->createMock(LoggerInterface::class),
        );

        $rootFolder = $this->createMock(IRootFolder::class);
        $mountCache = $this->createMock(IUserMountCache::class);
        $mountCache->method('getMountsForFileId')->willReturn([]);
        $shareManager = $this->createMock(IManager::class);
        $accessResolver = new AccessResolver(
            $mountCache,
            $shareManager,
            TenantMapperTestFactory::unresolvable(),
            $this->createMock(IUserManager::class),
            $this->createMock(LoggerInterface::class),
        );
        $ledger = new FakeSyncWorkLedgerRepository();

        $scopedPass = new ScopedReconciliationPass(
            $tasks,
            $rootFolder,
            $accessResolver,
            $ledger,
            $tenantMapper,
            $this->createMock(LoggerInterface::class),
        );

        $job = new ReconciliationJob($timeFactory, $fullTenantPass, $scopedPass, $config, $this->createMock(LoggerInterface::class));

        $this->invokeRun($job);

        self::assertSame((string) (1784332800 + 3600), $config->getAppValue(Application::APP_ID, 'full_tenant_reconcile_last_run_at'));
        self::assertCount(1, $tasks->all());
    }
}
