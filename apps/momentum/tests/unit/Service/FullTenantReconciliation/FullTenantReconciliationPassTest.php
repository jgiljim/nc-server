<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Service\FullTenantReconciliation;

use DateTimeImmutable;
use OCA\Momentum\AppInfo\Application;
use OCA\Momentum\Service\FullTenantReconciliation\FullTenantReconciliationPass;
use OCA\Momentum\Service\TenantMapper;
use OCA\Momentum\Tests\Support\FakeConfig;
use OCA\Momentum\Tests\Support\FakeDBConnection;
use OCA\Momentum\Tests\Support\FakeScopedReconcileTaskRepository;
use OCP\Group\IGroup;
use OCP\IGroupManager;
use OCP\IUser;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

final class FullTenantReconciliationPassTest extends TestCase
{
    private function group(string $gid, array $uids): IGroup
    {
        $group = $this->createMock(IGroup::class);
        $group->method('getGID')->willReturn($gid);
        $group->method('getUsers')->willReturn(array_map(
            fn (string $uid) => $this->createConfiguredMock(IUser::class, ['getUID' => $uid]),
            $uids,
        ));

        return $group;
    }

    public function testEnqueuesOneTaskPerGroupMemberAcrossAllRegisteredTenantsWhenDue(): void
    {
        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 42, 'backend_url' => 'https://acme.example'],
            ['user_group_id' => 'globex', 'tenant_id' => 7, 'backend_url' => 'https://globex.example'],
        ]);
        $tenantMapper = new TenantMapper($db, $this->createMock(IGroupManager::class), $this->createMock(LoggerInterface::class), new FakeConfig());

        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('get')->willReturnMap([
            ['acme-corp', $this->group('acme-corp', ['alice', 'bob'])],
            ['globex', $this->group('globex', ['carol'])],
        ]);

        $tasks = new FakeScopedReconcileTaskRepository();
        $config = new FakeConfig();
        $now = new DateTimeImmutable('2026-07-18T02:00:00+00:00');

        $pass = new FullTenantReconciliationPass(
            $tenantMapper,
            $groupManager,
            $tasks,
            $config,
            $this->createMock(LoggerInterface::class),
        );

        $result = $pass->run($now, 86400);

        self::assertTrue($result->ran);
        self::assertSame(2, $result->tenantsEnumerated);
        self::assertSame(3, $result->tasksEnqueued);
        self::assertCount(3, $tasks->all());

        $ownerUids = array_column($tasks->all(), 'ownerUid');
        sort($ownerUids);
        self::assertSame(['alice', 'bob', 'carol'], $ownerUids);

        foreach ($tasks->all() as $row) {
            self::assertSame('tenant', $row['scope']);
            self::assertNull($row['rootFileId']);
        }
    }

    public function testSkipsWhenLastRunWasWithinTheInterval(): void
    {
        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 42, 'backend_url' => 'https://acme.example'],
        ]);
        $tenantMapper = new TenantMapper($db, $this->createMock(IGroupManager::class), $this->createMock(LoggerInterface::class), new FakeConfig());
        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('get')->willReturn($this->group('acme-corp', ['alice']));

        $tasks = new FakeScopedReconcileTaskRepository();
        $config = new FakeConfig([], [
            Application::APP_ID => ['full_tenant_reconcile_last_run_at' => '1784332800'], // 2026-07-18T00:00:00Z
        ]);
        $now = new DateTimeImmutable('2026-07-18T02:00:00+00:00'); // 2h later, interval is 24h

        $pass = new FullTenantReconciliationPass(
            $tenantMapper,
            $groupManager,
            $tasks,
            $config,
            $this->createMock(LoggerInterface::class),
        );

        $result = $pass->run($now, 86400);

        self::assertFalse($result->ran);
        self::assertSame(0, $result->tenantsEnumerated);
        self::assertSame(0, $result->tasksEnqueued);
        self::assertCount(0, $tasks->all());
    }

    public function testRunsAgainOncePastTheIntervalAndUpdatesLastRun(): void
    {
        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 42, 'backend_url' => 'https://acme.example'],
        ]);
        $tenantMapper = new TenantMapper($db, $this->createMock(IGroupManager::class), $this->createMock(LoggerInterface::class), new FakeConfig());
        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('get')->willReturn($this->group('acme-corp', ['alice']));

        $tasks = new FakeScopedReconcileTaskRepository();
        $config = new FakeConfig([], [
            Application::APP_ID => ['full_tenant_reconcile_last_run_at' => '1784332800'], // 2026-07-18T00:00:00Z
        ]);
        $now = new DateTimeImmutable('2026-07-19T01:00:00+00:00'); // 25h later

        $pass = new FullTenantReconciliationPass(
            $tenantMapper,
            $groupManager,
            $tasks,
            $config,
            $this->createMock(LoggerInterface::class),
        );

        $result = $pass->run($now, 86400);

        self::assertTrue($result->ran);
        self::assertSame(1, $result->tasksEnqueued);
        self::assertSame((string) $now->getTimestamp(), $config->getAppValue(Application::APP_ID, 'full_tenant_reconcile_last_run_at'));
    }

    public function testSkipsATenantWhoseGroupNoLongerExists(): void
    {
        $db = new FakeDBConnection([
            ['user_group_id' => 'deleted-group', 'tenant_id' => 99, 'backend_url' => 'https://deleted.example'],
        ]);
        $tenantMapper = new TenantMapper($db, $this->createMock(IGroupManager::class), $this->createMock(LoggerInterface::class), new FakeConfig());
        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('get')->willReturn(null);

        $tasks = new FakeScopedReconcileTaskRepository();
        $config = new FakeConfig();
        $now = new DateTimeImmutable('2026-07-18T02:00:00+00:00');

        $pass = new FullTenantReconciliationPass(
            $tenantMapper,
            $groupManager,
            $tasks,
            $config,
            $this->createMock(LoggerInterface::class),
        );

        $result = $pass->run($now, 86400);

        self::assertTrue($result->ran);
        self::assertSame(1, $result->tenantsEnumerated);
        self::assertSame(0, $result->tasksEnqueued);
        self::assertCount(0, $tasks->all());
    }
}
