<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Db;

use DateTimeImmutable;
use OCA\Momentum\Db\DbSyncWorkLedgerRepository;
use OCA\Momentum\Tests\Support\FakeSyncLedgerDbConnection;
use PHPUnit\Framework\TestCase;

final class DbSyncWorkLedgerRepositoryTest extends TestCase
{
    public function testEnqueueWritesAnEnqueuedRow(): void
    {
        $db = new FakeSyncLedgerDbConnection();
        $repo = new DbSyncWorkLedgerRepository($db);
        $now = new DateTimeImmutable('2026-07-17T12:00:00+00:00');

        $id = $repo->enqueue('events', 'created', 42, ['doc_id' => 42, 'etag' => 'abc123'], $now);

        $row = $db->row($id);
        self::assertNotNull($row);
        self::assertSame('events', $row['target']);
        self::assertSame('created', $row['event_type']);
        self::assertSame(42, $row['doc_id']);
        self::assertSame('enqueued', $row['phase']);
        self::assertSame(0, $row['attempts']);
        self::assertSame(['doc_id' => 42, 'etag' => 'abc123'], json_decode($row['payload'], true));
    }

    public function testEnqueueSupersedesAnExistingOpenRowForTheSameDoc(): void
    {
        $db = new FakeSyncLedgerDbConnection();
        $repo = new DbSyncWorkLedgerRepository($db);
        $now = new DateTimeImmutable('2026-07-17T12:00:00+00:00');

        $firstId = $repo->enqueue('events', 'created', 42, ['etag' => 'v1'], $now);
        $secondId = $repo->enqueue('events', 'updated', 42, ['etag' => 'v2'], $now->modify('+1 second'));

        self::assertNull($db->row($firstId));
        self::assertNotNull($db->row($secondId));
        self::assertSame(1, $db->count());
    }

    public function testEnqueueDoesNotSupersedeADeletedEventOrAnAccessRow(): void
    {
        $db = new FakeSyncLedgerDbConnection();
        $repo = new DbSyncWorkLedgerRepository($db);
        $now = new DateTimeImmutable('2026-07-17T12:00:00+00:00');

        $createdId = $repo->enqueue('events', 'created', 42, ['etag' => 'v1'], $now);
        $accessId = $repo->enqueue('access', null, 42, ['uids' => ['alice']], $now);
        $deletedId = $repo->enqueue('events', 'deleted', 43, ['doc_id' => 43], $now);

        self::assertNotNull($db->row($createdId));
        self::assertNotNull($db->row($accessId));
        self::assertNotNull($db->row($deletedId));
        self::assertSame(3, $db->count());
    }

    public function testClaimDueReturnsOnlyEnqueuedRowsPastNextRetry(): void
    {
        $db = new FakeSyncLedgerDbConnection();
        $repo = new DbSyncWorkLedgerRepository($db);
        $now = new DateTimeImmutable('2026-07-17T12:00:00+00:00');

        $dueId = $repo->enqueue('events', 'created', 1, ['etag' => 'a'], $now);
        $repo->scheduleRetry($dueId, 1, $now->modify('-1 second'));

        $notYetDueId = $repo->enqueue('events', 'created', 2, ['etag' => 'b'], $now);
        $repo->scheduleRetry($notYetDueId, 1, $now->modify('+1 hour'));

        $freshId = $repo->enqueue('events', 'created', 3, ['etag' => 'c'], $now);

        $awaitingId = $repo->enqueue('events', 'created', 4, ['etag' => 'd'], $now);
        $repo->markDeliveredAwaiting($awaitingId, 'd', $now);

        $due = $repo->claimDue($now, 10);

        $ids = array_map(static fn ($row) => $row->docId, $due);
        self::assertEqualsCanonicalizing([1, 3], $ids);
    }

    public function testClaimDueDoesNotStarveAnOlderFreshRowBehindManyNewerRetryingRows(): void
    {
        $db = new FakeSyncLedgerDbConnection();
        $repo = new DbSyncWorkLedgerRepository($db);
        $now = new DateTimeImmutable('2026-07-17T12:00:00+00:00');

        // The fresh row is the oldest (enqueued an hour ago) and has never
        // been retried, so its next_retry is still NULL.
        $repo->enqueue('events', 'created', 99, ['etag' => 'fresh'], $now->modify('-1 hour'));

        // Five newer rows that have already failed once and are due again
        // right now — a plain `ORDER BY next_retry ASC` with Postgres's
        // default NULLS LAST would sort every one of these ahead of the
        // older NULL row, even though the NULL row is the most overdue.
        for ($i = 1; $i <= 5; $i++) {
            $poisonId = $repo->enqueue('events', 'created', $i, ['etag' => (string) $i], $now);
            $repo->scheduleRetry($poisonId, 1, $now);
        }

        $due = $repo->claimDue($now, 5);

        $ids = array_map(static fn ($row) => $row->docId, $due);
        self::assertContains(99, $ids, 'an older never-retried row must not queue behind newer retrying rows');
    }

    public function testClaimDueDrainsAFreshRowBehindFiftyOnePoisonRowsAtTheProductionLimit(): void
    {
        // Regression for the starvation this repository was built to fix
        // (`backlog/to_change.md` § G62): `DrainPass::DEFAULT_LIMIT` is 50, so
        // 51 poison rows alone already exceed one drain pass's capacity. If a
        // single fresh row queued behind them never drains, ingest stalls
        // completely for as long as poison rows keep retrying.
        $db = new FakeSyncLedgerDbConnection();
        $repo = new DbSyncWorkLedgerRepository($db);
        $now = new DateTimeImmutable('2026-07-17T12:00:00+00:00');

        for ($i = 1; $i <= 51; $i++) {
            $poisonId = $repo->enqueue('events', 'created', $i, ['etag' => (string) $i], $now->modify('-1 second'));
            $repo->scheduleRetry($poisonId, 1, $now);
        }

        $freshId = $repo->enqueue('events', 'created', 999, ['etag' => 'fresh'], $now->modify('-1 hour'));

        $due = $repo->claimDue($now, 50);

        $ids = array_map(static fn ($row) => $row->docId, $due);
        self::assertCount(50, $due);
        self::assertContains(999, $ids, 'the fresh row must drain within a single production-limit pass');
        self::assertSame($freshId, $due[0]->id, 'the oldest row (the fresh one) must be claimed first');
    }

    public function testClaimDueDecodesPayloadAndRespectsLimit(): void
    {
        $db = new FakeSyncLedgerDbConnection();
        $repo = new DbSyncWorkLedgerRepository($db);
        $now = new DateTimeImmutable('2026-07-17T12:00:00+00:00');

        $repo->enqueue('events', 'created', 1, ['etag' => 'a'], $now);
        $repo->enqueue('events', 'created', 2, ['etag' => 'b'], $now);

        $due = $repo->claimDue($now, 1);

        self::assertCount(1, $due);
        self::assertSame('events', $due[0]->target);
        self::assertSame('created', $due[0]->eventType);
        self::assertIsArray($due[0]->payload);
        self::assertArrayHasKey('etag', $due[0]->payload);
    }

    public function testClaimDueLeasesClaimedRowsSoAConcurrentPassCannotReclaimThem(): void
    {
        $db = new FakeSyncLedgerDbConnection();
        $repo = new DbSyncWorkLedgerRepository($db);
        $now = new DateTimeImmutable('2026-07-17T12:00:00+00:00');

        $repo->enqueue('events', 'created', 1, ['etag' => 'a'], $now);
        $repo->enqueue('events', 'created', 2, ['etag' => 'b'], $now);

        $firstPass = $repo->claimDue($now, 10);
        self::assertCount(2, $firstPass);

        // A second drain pass racing the first (e.g. an overlapping cron
        // tick) must not see the same rows again until the claim lease
        // expires — otherwise both passes would POST the same delivery.
        $secondPass = $repo->claimDue($now, 10);
        self::assertSame([], $secondPass);
    }

    public function testClaimDueReclaimsRowsOnceTheClaimLeaseExpires(): void
    {
        $db = new FakeSyncLedgerDbConnection();
        $repo = new DbSyncWorkLedgerRepository($db);
        $now = new DateTimeImmutable('2026-07-17T12:00:00+00:00');

        $repo->enqueue('events', 'created', 1, ['etag' => 'a'], $now);
        self::assertCount(1, $repo->claimDue($now, 10));

        // A worker that claimed the row and then died before delivering
        // must not strand it forever — once the lease window passes, the
        // row becomes claimable again.
        self::assertSame([], $repo->claimDue($now->modify('+10 seconds'), 10));
        self::assertCount(1, $repo->claimDue($now->modify('+1 hour'), 10));
    }

    public function testMarkDeliveredTerminalDeletesTheRow(): void
    {
        $db = new FakeSyncLedgerDbConnection();
        $repo = new DbSyncWorkLedgerRepository($db);
        $now = new DateTimeImmutable('2026-07-17T12:00:00+00:00');

        $id = $repo->enqueue('access', null, 42, ['uids' => ['alice']], $now);
        $repo->markDeliveredTerminal($id);

        self::assertNull($db->row($id));
    }

    public function testMarkDeliveredAwaitingAdvancesPhaseAndStampsEtag(): void
    {
        $db = new FakeSyncLedgerDbConnection();
        $repo = new DbSyncWorkLedgerRepository($db);
        $now = new DateTimeImmutable('2026-07-17T12:00:00+00:00');

        $id = $repo->enqueue('events', 'created', 42, ['etag' => 'abc'], $now);
        $repo->markDeliveredAwaiting($id, 'abc', $now);

        $row = $db->row($id);
        self::assertSame('awaiting', $row['phase']);
        self::assertSame('abc', $row['sent_etag']);
        self::assertNotNull($row['sent_at']);
    }

    public function testScheduleRetryBumpsAttemptsAndNextRetry(): void
    {
        $db = new FakeSyncLedgerDbConnection();
        $repo = new DbSyncWorkLedgerRepository($db);
        $now = new DateTimeImmutable('2026-07-17T12:00:00+00:00');

        $id = $repo->enqueue('events', 'created', 42, ['etag' => 'abc'], $now);
        $repo->scheduleRetry($id, 1, $now->modify('+5 seconds'));

        $row = $db->row($id);
        self::assertSame(1, $row['attempts']);
        self::assertNotNull($row['next_retry']);
    }

    public function testMarkDeadLetteredMovesTheRowToTheDeadPhaseAndClearsItsRetrySchedule(): void
    {
        $db = new FakeSyncLedgerDbConnection();
        $repo = new DbSyncWorkLedgerRepository($db);
        $now = new DateTimeImmutable('2026-07-17T12:00:00+00:00');

        $id = $repo->enqueue('events', 'created', 42, ['etag' => 'abc'], $now);
        $repo->scheduleRetry($id, 9, $now->modify('+5 seconds'));

        $repo->markDeadLettered($id, 10, $now);

        $row = $db->row($id);
        self::assertSame('dead', $row['phase']);
        self::assertSame(10, $row['attempts']);
        // The payload is retained: a dead-lettered row IS the dead-letter
        // store, so an operator can inspect and requeue it.
        self::assertNotNull($row['payload']);
        self::assertSame($now->format('Y-m-d H:i:s'), $row['dead_at']);
        // No next_retry: nothing reschedules a dead row.
        self::assertNull($row['next_retry']);
    }

    public function testClaimDueNeverReturnsADeadLetteredRow(): void
    {
        $db = new FakeSyncLedgerDbConnection();
        $repo = new DbSyncWorkLedgerRepository($db);
        $now = new DateTimeImmutable('2026-07-17T12:00:00+00:00');

        $deadId = $repo->enqueue('events', 'created', 1, ['etag' => 'poison'], $now);
        $repo->markDeadLettered($deadId, 10, $now);

        $liveId = $repo->enqueue('events', 'created', 2, ['etag' => 'live'], $now);

        $due = $repo->claimDue($now->modify('+1 hour'), 10);

        self::assertSame([$liveId], array_map(static fn ($row) => $row->id, $due));
    }

    public function testDeleteSyncedOlderThanLeavesDeadLetteredRowsForOperatorInspection(): void
    {
        $db = new FakeSyncLedgerDbConnection();
        $repo = new DbSyncWorkLedgerRepository($db);
        $now = new DateTimeImmutable('2026-07-17T12:00:00+00:00');

        $deadId = $repo->enqueue('events', 'created', 1, ['etag' => 'poison'], $now->modify('-1 year'));
        $repo->markDeadLettered($deadId, 10, $now->modify('-1 year'));

        self::assertSame(0, $repo->deleteSyncedOlderThan($now));
        self::assertNotNull($db->row($deadId));
    }

    public function testClaimAwaitingReturnsOnlyAwaitingRows(): void
    {
        $db = new FakeSyncLedgerDbConnection();
        $repo = new DbSyncWorkLedgerRepository($db);
        $now = new DateTimeImmutable('2026-07-17T12:00:00+00:00');

        $awaitingId = $repo->enqueue('events', 'created', 42, ['etag' => 'a'], $now);
        $repo->markDeliveredAwaiting($awaitingId, 'a', $now);

        $enqueuedId = $repo->enqueue('events', 'created', 43, ['etag' => 'b'], $now);

        $rows = $repo->claimAwaiting(10);

        self::assertCount(1, $rows);
        self::assertSame($awaitingId, $rows[0]->id);
        self::assertSame(42, $rows[0]->docId);
        self::assertNull($rows[0]->lastStatus);
        self::assertNull($rows[0]->lastReviewed);
        self::assertNotContains($enqueuedId, array_map(static fn ($row) => $row->id, $rows));
    }

    public function testClaimAwaitingRespectsLimit(): void
    {
        $db = new FakeSyncLedgerDbConnection();
        $repo = new DbSyncWorkLedgerRepository($db);
        $now = new DateTimeImmutable('2026-07-17T12:00:00+00:00');

        foreach ([1, 2, 3] as $docId) {
            $id = $repo->enqueue('events', 'created', $docId, ['etag' => (string) $docId], $now);
            $repo->markDeliveredAwaiting($id, (string) $docId, $now);
        }

        self::assertCount(2, $repo->claimAwaiting(2));
    }

    public function testMarkStatusUpdatedSetsLastStatusAndLastReviewedAndKeepsTheRow(): void
    {
        $db = new FakeSyncLedgerDbConnection();
        $repo = new DbSyncWorkLedgerRepository($db);
        $now = new DateTimeImmutable('2026-07-17T12:00:00+00:00');

        $id = $repo->enqueue('events', 'created', 42, ['etag' => 'a'], $now);
        $repo->markDeliveredAwaiting($id, 'a', $now);

        $repo->markStatusUpdated($id, 'processing', true);

        $row = $db->row($id);
        self::assertNotNull($row);
        self::assertSame('processing', $row['last_status']);
        self::assertTrue($row['last_reviewed']);
        self::assertSame('awaiting', $row['phase']);
    }

    public function testMarkSyncedDeletesTheRow(): void
    {
        $db = new FakeSyncLedgerDbConnection();
        $repo = new DbSyncWorkLedgerRepository($db);
        $now = new DateTimeImmutable('2026-07-17T12:00:00+00:00');

        $id = $repo->enqueue('events', 'created', 42, ['etag' => 'a'], $now);
        $repo->markDeliveredAwaiting($id, 'a', $now);

        $repo->markSynced($id);

        self::assertNull($db->row($id));
    }

    public function testDeleteSyncedOlderThanRemovesOnlyStaleSyncedRows(): void
    {
        $db = new FakeSyncLedgerDbConnection();
        $repo = new DbSyncWorkLedgerRepository($db);
        $now = new DateTimeImmutable('2026-07-18T12:00:00+00:00');

        $staleId = $db->seedSynced(1, $now->modify('-2 hours')->format('Y-m-d H:i:s'));
        $freshId = $db->seedSynced(2, $now->modify('-10 minutes')->format('Y-m-d H:i:s'));

        $deleted = $repo->deleteSyncedOlderThan($now->modify('-1 hour'));

        self::assertSame(1, $deleted);
        self::assertNull($db->row($staleId));
        self::assertNotNull($db->row($freshId));
    }

    public function testDeleteOrphanedAwaitingDeletesTheRow(): void
    {
        $db = new FakeSyncLedgerDbConnection();
        $repo = new DbSyncWorkLedgerRepository($db);
        $now = new DateTimeImmutable('2026-07-17T12:00:00+00:00');

        $id = $repo->enqueue('events', 'created', 42, ['etag' => 'a'], $now);
        $repo->markDeliveredAwaiting($id, 'a', $now);

        $repo->deleteOrphanedAwaiting($id);

        self::assertNull($db->row($id));
    }

    public function testRearmAwaitingInsertsAFreshAwaitingRowWhenTheOriginalWasPruned(): void
    {
        $db = new FakeSyncLedgerDbConnection();
        $repo = new DbSyncWorkLedgerRepository($db);
        $now = new DateTimeImmutable('2026-08-11T12:00:00+00:00');

        $repo->rearmAwaiting(42, ['doc_id' => 42, 'backend_url' => 'https://acme.example/api'], $now);

        self::assertSame(1, $db->count());
        $rows = array_filter(
            array_map(fn (int $id) => $db->row($id), range(1, 5)),
            static fn (?array $row) => $row !== null,
        );
        $row = array_values($rows)[0];
        self::assertSame('events', $row['target']);
        self::assertSame(42, $row['doc_id']);
        self::assertSame('awaiting', $row['phase']);
        self::assertNull($row['last_status']);
        self::assertNull($row['last_reviewed']);
        self::assertSame(
            ['doc_id' => 42, 'backend_url' => 'https://acme.example/api'],
            json_decode($row['payload'], true),
        );
    }

    public function testRearmAwaitingUpdatesAnExistingSyncedRowInPlaceInsteadOfInserting(): void
    {
        $db = new FakeSyncLedgerDbConnection();
        $repo = new DbSyncWorkLedgerRepository($db);
        $now = new DateTimeImmutable('2026-08-11T12:00:00+00:00');

        $id = $repo->enqueue('events', 'created', 42, ['etag' => 'v1'], $now);
        $repo->markDeliveredAwaiting($id, 'v1', $now);
        $repo->markStatusUpdated($id, 'done', false);

        $repo->rearmAwaiting(42, ['etag' => 'v2'], $now->modify('+1 hour'));

        self::assertSame(1, $db->count());
        $row = $db->row($id);
        self::assertNotNull($row);
        self::assertSame('awaiting', $row['phase']);
        self::assertNull($row['last_status']);
        self::assertNull($row['last_reviewed']);
        self::assertSame(['etag' => 'v2'], json_decode($row['payload'], true));
    }

    public function testRearmAwaitingNeverTouchesAnAccessRowForTheSameDocId(): void
    {
        $db = new FakeSyncLedgerDbConnection();
        $repo = new DbSyncWorkLedgerRepository($db);
        $now = new DateTimeImmutable('2026-08-11T12:00:00+00:00');

        $accessId = $repo->enqueue('access', null, 42, ['uids' => ['alice']], $now);

        $repo->rearmAwaiting(42, ['etag' => 'v2'], $now);

        $accessRow = $db->row($accessId);
        self::assertNotNull($accessRow);
        self::assertSame('access', $accessRow['target']);
        self::assertSame(['uids' => ['alice']], json_decode($accessRow['payload'], true));
        // The access row was left alone, so a fresh 'events' row was inserted
        // rather than the access row being repurposed.
        self::assertSame(2, $db->count());
    }
}
