<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Service\SyncWorkLedger;

use DateTimeImmutable;
use OCA\Momentum\Service\SyncWorkLedger\CleanupSweep;
use OCA\Momentum\Service\SyncWorkLedger\StatusItem;
use OCA\Momentum\Tests\Support\FakeStatusPollClient;
use OCA\Momentum\Tests\Support\FakeSyncWorkLedgerRepository;
use PHPUnit\Framework\TestCase;

final class CleanupSweepTest extends TestCase
{
    public function testDeletesSyncedRowsOlderThanTheRetentionWindow(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        $now = new DateTimeImmutable('2026-07-18T12:00:00+00:00');

        $staleId = $repo->seedSynced(1, $now->modify('-2 hours'));
        $freshId = $repo->seedSynced(2, $now->modify('-10 minutes'));

        $result = (new CleanupSweep($repo, new FakeStatusPollClient()))->run($now, 3600);

        self::assertSame(1, $result->syncedDeleted);
        self::assertFalse($repo->hasRow($staleId));
        self::assertTrue($repo->hasRow($freshId));
    }

    public function testAwaitingRowOmittedFromStatusResponseIsDeletedAsOrphaned(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        $now = new DateTimeImmutable('2026-07-18T12:00:00+00:00');

        $orphanId = $repo->seedAwaiting(42, 'processing');

        $client = new FakeStatusPollClient([]);

        $result = (new CleanupSweep($repo, $client))->run($now, 3600);

        self::assertSame(1, $result->awaitingChecked);
        self::assertSame(1, $result->orphanedDeleted);
        self::assertSame([$orphanId], $repo->orphanedAwaiting);
        self::assertSame([], $repo->claimAwaiting(10));
    }

    public function testAwaitingRowPresentInStatusResponseIsLeftUntouched(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        $now = new DateTimeImmutable('2026-07-18T12:00:00+00:00');

        $id = $repo->seedAwaiting(42, 'processing');

        $client = new FakeStatusPollClient([
            42 => new StatusItem(42, 'processing', null, null, false, 1),
        ]);

        $result = (new CleanupSweep($repo, $client))->run($now, 3600);

        self::assertSame(0, $result->orphanedDeleted);
        self::assertSame([], $repo->orphanedAwaiting);
        self::assertSame([$id], array_map(static fn ($row) => $row->id, $repo->claimAwaiting(10)));
    }

    public function testEmptyAwaitingSetDoesNotCallTheStatusClient(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        $now = new DateTimeImmutable('2026-07-18T12:00:00+00:00');
        $client = new FakeStatusPollClient([]);

        $result = (new CleanupSweep($repo, $client))->run($now, 3600);

        self::assertSame(0, $result->awaitingChecked);
        self::assertSame(0, $result->orphanedDeleted);
        self::assertSame([], $client->calls);
    }

    public function testBatchesDocIdsAtTwoHundredPerCall(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        $now = new DateTimeImmutable('2026-07-18T12:00:00+00:00');
        for ($docId = 1; $docId <= 250; $docId++) {
            $repo->seedAwaiting($docId, 'pending');
        }

        $client = new FakeStatusPollClient([]);

        (new CleanupSweep($repo, $client))->run($now, 3600, 300);

        self::assertCount(2, $client->calls);
        self::assertCount(200, $client->calls[0]);
        self::assertCount(50, $client->calls[1]);
    }
}
