<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Service\SyncWorkLedger;

use DateTimeImmutable;
use OCA\Momentum\Db\DbSyncWorkLedgerRepository;
use OCA\Momentum\Service\SyncWorkLedger\DrainPass;
use OCA\Momentum\Tests\Support\FakeEventDeliveryClient;
use OCA\Momentum\Tests\Support\FakeSyncLedgerDbConnection;
use OCA\Momentum\Tests\Support\FakeSyncWorkLedgerRepository;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;
use Psr\Log\NullLogger;

final class DrainPassTest extends TestCase
{
    private DateTimeImmutable $now;

    protected function setUp(): void
    {
        $this->now = new DateTimeImmutable('2026-07-17T12:00:00+00:00');
    }

    public function testDeliveredAccessRowIsDroppedOnSuccess(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        $id = $repo->seed('access', null, 42, ['uids' => ['alice']]);
        $client = new FakeEventDeliveryClient(defaultStatus: 200);

        $result = (new DrainPass($repo, $client, new NullLogger()))->run($this->now);

        self::assertSame(1, $result->claimed);
        self::assertSame(1, $result->delivered);
        self::assertSame(0, $result->retried);
        self::assertSame([$id], $repo->deliveredTerminal);
        self::assertCount(1, $repo->sentMarked);
        self::assertSame($id, $repo->sentMarked[0]['id']);
        self::assertSame('/internal/access', $client->calls[0]['path']);
    }

    public function testDeliveredDeletedEventRowIsDroppedOnSuccess(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        $id = $repo->seed('events', 'deleted', 42, ['doc_id' => 42, 'event_type' => 'deleted']);
        $client = new FakeEventDeliveryClient(defaultStatus: 202);

        (new DrainPass($repo, $client, new NullLogger()))->run($this->now);

        self::assertSame([$id], $repo->deliveredTerminal);
        self::assertSame([], $repo->deliveredAwaiting);
    }

    public function testDeliveredCreatedEventRowAdvancesToAwaitingWithEtag(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        $id = $repo->seed('events', 'created', 42, ['doc_id' => 42, 'etag' => 'abc123']);
        $client = new FakeEventDeliveryClient(defaultStatus: 202);

        (new DrainPass($repo, $client, new NullLogger()))->run($this->now);

        self::assertSame([], $repo->deliveredTerminal);
        self::assertCount(1, $repo->deliveredAwaiting);
        self::assertSame($id, $repo->deliveredAwaiting[0]['id']);
        self::assertSame('abc123', $repo->deliveredAwaiting[0]['sentEtag']);
        self::assertEquals($this->now, $repo->deliveredAwaiting[0]['sentAt']);
        self::assertCount(1, $repo->sentMarked);
        self::assertSame($id, $repo->sentMarked[0]['id']);
        self::assertSame('abc123', $repo->sentMarked[0]['sentEtag']);
        self::assertEquals($this->now, $repo->sentMarked[0]['sentAt']);
        self::assertSame('/internal/events', $client->calls[0]['path']);
    }

    public function testNonSuccessResponseSchedulesARetryWithBackoff(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        $id = $repo->seed('events', 'created', 42, ['etag' => 'abc123'], attempts: 2);
        $client = new FakeEventDeliveryClient(defaultStatus: 500);

        $result = (new DrainPass($repo, $client, new NullLogger()))->run($this->now);

        self::assertSame(0, $result->delivered);
        self::assertSame(1, $result->retried);
        self::assertCount(1, $repo->retried);
        self::assertSame($id, $repo->retried[0]['id']);
        self::assertSame(3, $repo->retried[0]['attempts']);
        self::assertEquals($this->now->modify('+20 seconds'), $repo->retried[0]['nextRetry']);
    }

    public function testProcessesEveryClaimedRowAndTalliesTheResult(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        $repo->seed('access', null, 1, ['uids' => []]);
        $repo->seed('events', 'created', 2, ['etag' => 'a']);
        $repo->seed('events', 'updated', 3, ['etag' => 'b']);
        $client = new FakeEventDeliveryClient(statusQueue: [200, 202, 500]);

        $result = (new DrainPass($repo, $client, new NullLogger()))->run($this->now);

        self::assertSame(3, $result->claimed);
        self::assertSame(2, $result->delivered);
        self::assertSame(1, $result->retried);
    }

    public function testTwoOverlappingDrainPassesNeverPostTheSameRowTwice(): void
    {
        // Backed by the real repository (FOR UPDATE SKIP LOCKED + claim
        // lease), not the hand-written FakeSyncWorkLedgerRepository above —
        // that fake's claimDue() doesn't model claiming at all, so it can't
        // exercise this race. Two DrainPass instances share one repository
        // to stand in for two overlapping cron ticks.
        $db = new FakeSyncLedgerDbConnection();
        $repo = new DbSyncWorkLedgerRepository($db);
        $client = new FakeEventDeliveryClient(defaultStatus: 200);

        $ids = [];
        for ($i = 1; $i <= 5; $i++) {
            $ids[] = $repo->enqueue('access', null, $i, ['uids' => ['uid-' . $i]], $this->now);
        }

        $firstPass = new DrainPass($repo, $client, new NullLogger());
        $secondPass = new DrainPass($repo, $client, new NullLogger());

        // Racing cron ticks each claim before either has delivered, so the
        // lease set by the first claimDue() must exclude these rows from
        // the second before any POST happens.
        $firstResult = $firstPass->run($this->now);
        $secondResult = $secondPass->run($this->now);

        self::assertSame(5, $firstResult->claimed);
        self::assertSame(0, $secondResult->claimed, 'a second overlapping pass must not re-claim already-leased rows');

        $postedUids = array_map(static fn (array $call) => $call['payload']['uids'][0], $client->calls);
        self::assertCount(5, $client->calls, 'each row must be POSTed exactly once across both passes');
        self::assertCount(5, array_unique($postedUids), 'no row was POSTed more than once');

        // Every row was actually delivered and dropped (target=access is
        // terminal on success) — none left behind, none double-processed.
        foreach ($ids as $id) {
            self::assertNull($db->row($id));
        }
    }

    public function testRowThatExhaustsTheAttemptsCapIsDeadLetteredInsteadOfRetried(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        $id = $repo->seed('events', 'created', 42, ['etag' => 'abc123'], attempts: 9);
        $client = new FakeEventDeliveryClient(defaultStatus: 500);
        $logger = $this->createMock(LoggerInterface::class);
        // The operator alert (G62 item 2, pairs with G63): a permanently
        // rejected row is an error, not routine retry noise.
        $logger->expects(self::once())->method('error');

        $result = (new DrainPass($repo, $client, $logger))->run($this->now, maxAttempts: 10);

        self::assertSame(0, $result->delivered);
        self::assertSame(0, $result->retried);
        self::assertSame(1, $result->deadLettered);
        self::assertSame([], $repo->retried);
        self::assertCount(1, $repo->deadLettered);
        self::assertSame($id, $repo->deadLettered[0]['id']);
        self::assertSame(10, $repo->deadLettered[0]['attempts']);
        self::assertEquals($this->now, $repo->deadLettered[0]['deadAt']);
        // Out of the drain pass's way for good: no further claim sees it.
        self::assertSame([], $repo->claimDue($this->now, 10));
    }

    public function testRowStillUnderTheAttemptsCapIsRetriedNotDeadLettered(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        $id = $repo->seed('events', 'created', 42, ['etag' => 'abc123'], attempts: 8);
        $client = new FakeEventDeliveryClient(defaultStatus: 500);
        $logger = $this->createMock(LoggerInterface::class);
        $logger->expects(self::never())->method('error');

        $result = (new DrainPass($repo, $client, $logger))->run($this->now, maxAttempts: 10);

        self::assertSame(1, $result->retried);
        self::assertSame(0, $result->deadLettered);
        self::assertSame([], $repo->deadLettered);
        self::assertSame($id, $repo->retried[0]['id']);
        self::assertSame(9, $repo->retried[0]['attempts']);
    }

    public function testAttemptsCapOfZeroRestoresUnboundedRetry(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        $repo->seed('events', 'created', 42, ['etag' => 'abc123'], attempts: 500);
        $client = new FakeEventDeliveryClient(defaultStatus: 500);

        $result = (new DrainPass($repo, $client, new NullLogger()))->run($this->now, maxAttempts: 0);

        self::assertSame(1, $result->retried);
        self::assertSame(0, $result->deadLettered);
        self::assertSame([], $repo->deadLettered);
    }

    public function testDeliveredRowIsNeverDeadLetteredEvenPastTheCap(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        $repo->seed('access', null, 42, ['uids' => ['alice']], attempts: 99);
        $client = new FakeEventDeliveryClient(defaultStatus: 200);

        $result = (new DrainPass($repo, $client, new NullLogger()))->run($this->now, maxAttempts: 10);

        self::assertSame(1, $result->delivered);
        self::assertSame(0, $result->deadLettered);
        self::assertSame([], $repo->deadLettered);
    }

    public function testAppliesTheDefaultAttemptsCapWhenTheCallerPassesNone(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        $repo->seed('events', 'created', 42, ['etag' => 'abc123'], attempts: DrainPass::DEFAULT_MAX_ATTEMPTS - 1);
        $client = new FakeEventDeliveryClient(defaultStatus: 500);

        $result = (new DrainPass($repo, $client, new NullLogger()))->run($this->now);

        self::assertSame(1, $result->deadLettered);
        self::assertSame(0, $result->retried);
    }
}
