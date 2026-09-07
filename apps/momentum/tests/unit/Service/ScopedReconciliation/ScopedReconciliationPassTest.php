<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Service\ScopedReconciliation;

use DateTimeImmutable;
use OCA\Momentum\Db\DbScopedReconcileTaskRepository;
use OCA\Momentum\Service\AccessResolver;
use OCA\Momentum\Service\ScopedReconciliation\ScopedReconciliationPass;
use OCA\Momentum\Service\TenantMapper;
use OCA\Momentum\Tests\Support\FakeConfig;
use OCA\Momentum\Tests\Support\FakeDBConnection;
use OCA\Momentum\Tests\Support\FakeFile;
use OCA\Momentum\Tests\Support\FakeFolder;
use OCA\Momentum\Tests\Support\FakeScopedReconcileDbConnection;
use OCA\Momentum\Tests\Support\FakeSyncWorkLedgerRepository;
use OCA\Momentum\Tests\Support\TenantMapperTestFactory;
use OCP\Files\Config\IUserMountCache;
use OCP\Files\IRootFolder;
use OCP\Files\NotFoundException;
use OCP\IGroupManager;
use OCP\IUserManager;
use OCP\Share\IManager;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

final class ScopedReconciliationPassTest extends TestCase
{
    private function accessResolver(array $visibleUids): AccessResolver
    {
        $mountCache = $this->createMock(IUserMountCache::class);
        $mountCache->method('getMountsForFileId')->willReturn([]);
        $shareManager = $this->createMock(IManager::class);
        $shareManager->method('getAccessList')->willReturn(['users' => $visibleUids]);

        return new AccessResolver(
            $mountCache,
            $shareManager,
            TenantMapperTestFactory::unresolvable(),
            $this->createMock(IUserManager::class),
            $this->createMock(LoggerInterface::class),
        );
    }

    private function tenantMapperWithBackendUrl(int $tenantId, string $backendUrl): TenantMapper
    {
        $db = new FakeDBConnection([
            ['user_group_id' => 'irrelevant', 'tenant_id' => $tenantId, 'backend_url' => $backendUrl],
        ]);

        return new TenantMapper($db, $this->createMock(IGroupManager::class), $this->createMock(LoggerInterface::class), new FakeConfig());
    }

    public function testReturnsUnclaimedResultWhenNoTaskIsPending(): void
    {
        $db = new FakeScopedReconcileDbConnection();
        $tasks = new DbScopedReconcileTaskRepository($db);
        $rootFolder = $this->createMock(IRootFolder::class);
        $now = new DateTimeImmutable('2026-07-18T09:00:00+00:00');

        $pass = new ScopedReconciliationPass(
            $tasks,
            $rootFolder,
            $this->accessResolver(['alice']),
            new FakeSyncWorkLedgerRepository(),
            $this->tenantMapperWithBackendUrl(7, 'https://acme.example'),
            $this->createMock(LoggerInterface::class),
        );

        $result = $pass->run($now);

        self::assertFalse($result->claimed);
        self::assertSame(0, $result->filesResolved);
        self::assertFalse($result->taskDone);
    }

    public function testWalksAGroupScopedTaskRootedAtTheOwnersHomeFolderAndPostsPerFileAccessRows(): void
    {
        $db = new FakeScopedReconcileDbConnection();
        $tasks = new DbScopedReconcileTaskRepository($db);
        $now = new DateTimeImmutable('2026-07-18T09:00:00+00:00');
        $tasks->enqueue(7, 'group', 'alice', null, $now);

        $fileA = new FakeFile(101, '/alice/Shared/a.pdf');
        $fileB = new FakeFile(102, '/alice/Shared/sub/b.pdf');
        $subfolder = new FakeFolder(200, '/alice/Shared/sub', [$fileB]);
        $homeFolder = new FakeFolder(1, '/alice', [$fileA, $subfolder]);

        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getUserFolder')->with('alice')->willReturn($homeFolder);

        $ledger = new FakeSyncWorkLedgerRepository();

        $pass = new ScopedReconciliationPass(
            $tasks,
            $rootFolder,
            $this->accessResolver(['alice', 'bob']),
            $ledger,
            $this->tenantMapperWithBackendUrl(7, 'https://acme.example'),
            $this->createMock(LoggerInterface::class),
        );

        $result = $pass->run($now);

        self::assertTrue($result->claimed);
        self::assertSame(2, $result->filesResolved);
        self::assertTrue($result->taskDone);

        $rows = $ledger->claimDue($now, 10);
        self::assertCount(2, $rows);
        $docIds = array_map(static fn ($row) => $row->docId, $rows);
        self::assertEqualsCanonicalizing([101, 102], $docIds);
        self::assertSame(['alice', 'bob'], $rows[0]->payload['uids']);
        self::assertSame(7, $rows[0]->payload['tenant_id']);
        // Same gap as ShareEventListener had (Phase 26): without these,
        // delivery fails forever with a hostless-URL SSRF rejection and,
        // one layer deeper, a missing-nc_user_id 401 — confirmed live,
        // 2026-07-29, for this exact pass.
        self::assertSame('https://acme.example', $rows[0]->payload['backend_url']);
        self::assertSame('alice', $rows[0]->payload['nc_user_id']);
    }

    public function testWalksAGroupfolderScopedTaskRootedAtASpecificSubtree(): void
    {
        $db = new FakeScopedReconcileDbConnection();
        $tasks = new DbScopedReconcileTaskRepository($db);
        $now = new DateTimeImmutable('2026-07-18T09:00:00+00:00');
        $tasks->enqueue(7, 'groupfolder', 'bob', 555, $now);

        $file = new FakeFile(900, '/GroupFolders/finance/report.pdf');
        $groupFolder = new FakeFolder(555, '/GroupFolders/finance', [$file]);
        $ownerHome = new FakeFolder(1, '/bob', [$groupFolder]);

        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getUserFolder')->with('bob')->willReturn($ownerHome);

        $ledger = new FakeSyncWorkLedgerRepository();

        $pass = new ScopedReconciliationPass(
            $tasks,
            $rootFolder,
            $this->accessResolver(['bob', 'carol']),
            $ledger,
            $this->tenantMapperWithBackendUrl(7, 'https://acme.example'),
            $this->createMock(LoggerInterface::class),
        );

        $result = $pass->run($now);

        self::assertSame(1, $result->filesResolved);
        self::assertTrue($result->taskDone);
        self::assertCount(1, $ledger->claimDue($now, 10));
    }

    public function testPacesTheWalkAcrossBatchesLeavingTheTaskPendingUntilExhausted(): void
    {
        $db = new FakeScopedReconcileDbConnection();
        $tasks = new DbScopedReconcileTaskRepository($db);
        $now = new DateTimeImmutable('2026-07-18T09:00:00+00:00');
        $tasks->enqueue(7, 'group', 'alice', null, $now);

        $files = [];
        for ($i = 1; $i <= 5; $i++) {
            $files[] = new FakeFile(100 + $i, "/alice/f{$i}.pdf");
        }
        $homeFolder = new FakeFolder(1, '/alice', $files);

        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getUserFolder')->with('alice')->willReturn($homeFolder);

        $ledger = new FakeSyncWorkLedgerRepository();
        $pass = new ScopedReconciliationPass(
            $tasks,
            $rootFolder,
            $this->accessResolver(['alice']),
            $ledger,
            $this->tenantMapperWithBackendUrl(7, 'https://acme.example'),
            $this->createMock(LoggerInterface::class),
        );

        $first = $pass->run($now, 2);
        self::assertTrue($first->claimed);
        self::assertSame(2, $first->filesResolved);
        self::assertFalse($first->taskDone);
        self::assertCount(2, $ledger->claimDue($now, 10));

        // Simulate the ledger draining between ticks so claimDue only sees new rows.
        foreach ($ledger->claimDue($now, 10) as $row) {
            $ledger->markDeliveredTerminal($row->id);
        }

        $second = $pass->run($now, 2);
        self::assertTrue($second->claimed);
        self::assertSame(2, $second->filesResolved);
        self::assertFalse($second->taskDone);

        foreach ($ledger->claimDue($now, 10) as $row) {
            $ledger->markDeliveredTerminal($row->id);
        }

        $third = $pass->run($now, 2);
        self::assertTrue($third->claimed);
        self::assertSame(1, $third->filesResolved);
        self::assertTrue($third->taskDone);
    }

    public function testUnresolvableRootMarksTheTaskDoneWithoutPostingAnyRows(): void
    {
        $db = new FakeScopedReconcileDbConnection();
        $tasks = new DbScopedReconcileTaskRepository($db);
        $now = new DateTimeImmutable('2026-07-18T09:00:00+00:00');
        $tasks->enqueue(7, 'group', 'ghost', null, $now);

        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getUserFolder')->with('ghost')->willThrowException(new NotFoundException());

        $ledger = new FakeSyncWorkLedgerRepository();
        $pass = new ScopedReconciliationPass(
            $tasks,
            $rootFolder,
            $this->accessResolver(['ghost']),
            $ledger,
            $this->tenantMapperWithBackendUrl(7, 'https://acme.example'),
            $this->createMock(LoggerInterface::class),
        );

        $result = $pass->run($now);

        self::assertTrue($result->claimed);
        self::assertSame(0, $result->filesResolved);
        self::assertTrue($result->taskDone);
        self::assertCount(0, $ledger->claimDue($now, 10));
        self::assertNull($tasks->claimNextPending($now));
    }

    public function testAnUnregisteredTenantMarksTheTaskDoneWithoutPostingAnyRows(): void
    {
        $db = new FakeScopedReconcileDbConnection();
        $tasks = new DbScopedReconcileTaskRepository($db);
        $now = new DateTimeImmutable('2026-07-18T09:00:00+00:00');
        $tasks->enqueue(7, 'group', 'alice', null, $now);

        $fileA = new FakeFile(101, '/alice/Shared/a.pdf');
        $homeFolder = new FakeFolder(1, '/alice', [$fileA]);

        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getUserFolder')->with('alice')->willReturn($homeFolder);

        $ledger = new FakeSyncWorkLedgerRepository();
        // No tenant 7 registered in this mapper's backing store.
        $tenantMapper = $this->tenantMapperWithBackendUrl(99, 'https://unrelated.example');

        $pass = new ScopedReconciliationPass(
            $tasks,
            $rootFolder,
            $this->accessResolver(['alice']),
            $ledger,
            $tenantMapper,
            $this->createMock(LoggerInterface::class),
        );

        $result = $pass->run($now);

        self::assertTrue($result->claimed);
        self::assertSame(0, $result->filesResolved);
        self::assertTrue($result->taskDone);
        self::assertCount(0, $ledger->claimDue($now, 10));
        self::assertNull($tasks->claimNextPending($now));
    }
}
