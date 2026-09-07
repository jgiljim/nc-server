<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Db;

use DateTimeImmutable;
use OCA\Momentum\Db\DbScopedReconcileTaskRepository;
use OCA\Momentum\Tests\Support\FakeScopedReconcileDbConnection;
use PHPUnit\Framework\TestCase;

final class DbScopedReconcileTaskRepositoryTest extends TestCase
{
    public function testEnqueueWritesAPendingTaskRow(): void
    {
        $db = new FakeScopedReconcileDbConnection();
        $repo = new DbScopedReconcileTaskRepository($db);
        $now = new DateTimeImmutable('2026-07-18T09:00:00+00:00');

        $id = $repo->enqueue(7, 'group', 'alice', null, $now);

        $row = $db->row($id);
        self::assertNotNull($row);
        self::assertSame(7, $row['tenant_id']);
        self::assertSame('group', $row['scope']);
        self::assertSame('alice', $row['owner_uid']);
        self::assertNull($row['root_file_id']);
        self::assertSame('pending', $row['status']);
    }

    public function testEnqueueWritesExactlyOneRowRegardlessOfScope(): void
    {
        $db = new FakeScopedReconcileDbConnection();
        $repo = new DbScopedReconcileTaskRepository($db);
        $now = new DateTimeImmutable('2026-07-18T09:00:00+00:00');

        $repo->enqueue(7, 'groupfolder', 'bob', 555, $now);

        self::assertSame(1, $db->count());
    }

    public function testClaimNextPendingReturnsTheOldestPendingTask(): void
    {
        $db = new FakeScopedReconcileDbConnection();
        $repo = new DbScopedReconcileTaskRepository($db);
        $now = new DateTimeImmutable('2026-07-18T09:00:00+00:00');

        $repo->enqueue(1, 'group', 'later', null, $now->modify('+1 second'));
        $firstId = $repo->enqueue(1, 'group', 'earlier', null, $now);

        $claimed = $repo->claimNextPending($now);

        self::assertNotNull($claimed);
        self::assertSame($firstId, $claimed->id);
        self::assertSame('earlier', $claimed->ownerUid);
    }

    public function testClaimNextPendingReturnsNullWhenNothingPending(): void
    {
        $db = new FakeScopedReconcileDbConnection();
        $repo = new DbScopedReconcileTaskRepository($db);
        $now = new DateTimeImmutable('2026-07-18T09:00:00+00:00');

        self::assertNull($repo->claimNextPending($now));
    }

    public function testClaimNextPendingSkipsDoneTasks(): void
    {
        $db = new FakeScopedReconcileDbConnection();
        $repo = new DbScopedReconcileTaskRepository($db);
        $now = new DateTimeImmutable('2026-07-18T09:00:00+00:00');

        $id = $repo->enqueue(1, 'group', 'alice', null, $now);
        $repo->markDone($id, $now);

        self::assertNull($repo->claimNextPending($now));
    }

    public function testAdvanceCursorUpdatesCursorAndUpdatedAt(): void
    {
        $db = new FakeScopedReconcileDbConnection();
        $repo = new DbScopedReconcileTaskRepository($db);
        $now = new DateTimeImmutable('2026-07-18T09:00:00+00:00');

        $id = $repo->enqueue(1, 'group', 'alice', null, $now);
        $repo->advanceCursor($id, 4200, $now->modify('+1 minute'));

        $row = $db->row($id);
        self::assertSame(4200, $row['cursor_file_id']);
        self::assertSame('pending', $row['status']);
    }

    public function testMarkDoneSetsStatusDone(): void
    {
        $db = new FakeScopedReconcileDbConnection();
        $repo = new DbScopedReconcileTaskRepository($db);
        $now = new DateTimeImmutable('2026-07-18T09:00:00+00:00');

        $id = $repo->enqueue(1, 'groupfolder', 'bob', 555, $now);
        $repo->markDone($id, $now);

        $row = $db->row($id);
        self::assertSame('done', $row['status']);
    }
}
