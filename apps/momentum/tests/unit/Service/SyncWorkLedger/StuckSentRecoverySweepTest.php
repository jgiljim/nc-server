<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Service\SyncWorkLedger;

use DateTimeImmutable;
use OCA\Momentum\Service\SyncWorkLedger\StuckSentRecoverySweep;
use OCA\Momentum\Tests\Support\FakeSyncWorkLedgerRepository;
use PHPUnit\Framework\TestCase;

final class StuckSentRecoverySweepTest extends TestCase
{
    public function testAdvancesAStuckCreatedRowToAwaiting(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        $now = new DateTimeImmutable('2026-07-24T12:00:00+00:00');
        $sentAt = $now->modify('-10 minutes');
        $id = $repo->seedSent('events', 'created', 'abc123', $sentAt);

        $result = (new StuckSentRecoverySweep($repo))->run($now, 300);

        self::assertSame(1, $result->claimed);
        self::assertSame(1, $result->advanced);
        self::assertSame(0, $result->deleted);
        self::assertCount(1, $repo->deliveredAwaiting);
        self::assertSame($id, $repo->deliveredAwaiting[0]['id']);
        self::assertSame('abc123', $repo->deliveredAwaiting[0]['sentEtag']);
        self::assertEquals($sentAt, $repo->deliveredAwaiting[0]['sentAt']);
    }

    public function testDeletesAStuckAccessRow(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        $now = new DateTimeImmutable('2026-07-24T12:00:00+00:00');
        $id = $repo->seedSent('access', null, null, $now->modify('-10 minutes'));

        $result = (new StuckSentRecoverySweep($repo))->run($now, 300);

        self::assertSame(1, $result->deleted);
        self::assertSame(0, $result->advanced);
        self::assertSame([$id], $repo->deliveredTerminal);
        self::assertFalse($repo->hasRow($id));
    }

    public function testDeletesAStuckDeletedEventRow(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        $now = new DateTimeImmutable('2026-07-24T12:00:00+00:00');
        $id = $repo->seedSent('events', 'deleted', null, $now->modify('-10 minutes'));

        $result = (new StuckSentRecoverySweep($repo))->run($now, 300);

        self::assertSame(1, $result->deleted);
        self::assertSame([$id], $repo->deliveredTerminal);
    }

    public function testLeavesARowFresherThanTheStalenessThresholdAlone(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        $now = new DateTimeImmutable('2026-07-24T12:00:00+00:00');
        // 30s old: fresher than the 300s staleness threshold, so the drain pass
        // might still be mid-way through its own follow-up write — leave it be.
        $id = $repo->seedSent('events', 'created', 'abc123', $now->modify('-30 seconds'));

        $result = (new StuckSentRecoverySweep($repo))->run($now, 300);

        self::assertSame(0, $result->claimed);
        self::assertSame([], $repo->deliveredAwaiting);
        self::assertSame([], $repo->deliveredTerminal);
        self::assertTrue($repo->hasRow($id));
    }

    public function testIsANoOpWhenNoRowIsStuck(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        $now = new DateTimeImmutable('2026-07-24T12:00:00+00:00');

        $result = (new StuckSentRecoverySweep($repo))->run($now, 300);

        self::assertSame(0, $result->claimed);
        self::assertSame(0, $result->advanced);
        self::assertSame(0, $result->deleted);
    }
}
