<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\BackgroundJob;

use DateTimeImmutable;
use OCA\Momentum\BackgroundJob\DrainJob;
use OCA\Momentum\Service\SyncWorkLedger\DrainPass;
use OCA\Momentum\Service\SyncWorkLedger\StuckSentRecoverySweep;
use OCA\Momentum\Tests\Support\FakeConfig;
use OCA\Momentum\Tests\Support\FakeEventDeliveryClient;
use OCA\Momentum\Tests\Support\FakeSyncWorkLedgerRepository;
use OCP\AppFramework\Utility\ITimeFactory;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;
use Psr\Log\NullLogger;
use ReflectionMethod;

final class DrainJobTest extends TestCase
{
    private function invokeRun(DrainJob $job): void
    {
        $method = new ReflectionMethod($job, 'run');
        $method->setAccessible(true);
        $method->invoke($job, null);
    }

    public function testDrainsDueRowsOnEachTick(): void
    {
        $timeFactory = $this->createMock(ITimeFactory::class);
        $timeFactory->method('getTime')->willReturn(1784332800); // 2026-07-18T00:00:00Z

        $repo = new FakeSyncWorkLedgerRepository();
        $repo->seed('access', null, 42, ['uids' => ['alice']]);
        $client = new FakeEventDeliveryClient(defaultStatus: 200);
        $drainPass = new DrainPass($repo, $client, new NullLogger());
        $recoverySweep = new StuckSentRecoverySweep($repo);

        $logger = $this->createMock(LoggerInterface::class);
        $logger->expects(self::once())->method('info');

        $job = new DrainJob($timeFactory, $drainPass, $recoverySweep, new FakeConfig(), $logger);
        $this->invokeRun($job);

        self::assertCount(1, $repo->deliveredTerminal);
    }

    /**
     * M102.20. The per-tick claim limit is the ONLY lever on how long a user's
     * own upload stays invisible to list/search, and it was hardcoded.
     *
     * Filter B (`access_projection`) is populated through this ledger, so a
     * document is not returned by list/search/vector until its `access` row has
     * been drained — direct fetch by id is unaffected, since thin-A is live
     * per-request. With a hardcoded 50 rows per tick and a 60s tick, a burst of
     * N ledger rows takes ceil(N/50) minutes to become searchable: the e2e suite
     * enqueues ~80 rows per run and therefore needs two ticks (which is why it
     * forces DrainJob between polls rather than waiting on cron).
     *
     * `DrainJob` already reads `ledger_max_attempts` from app config on every
     * tick, with a comment explaining that a documented setting nobody honours
     * is the "G49 class of gap" — and then passed no limit at all, leaving
     * DrainPass::DEFAULT_LIMIT in force with no way to raise it short of a
     * redeploy. One knob wired, the other not.
     */
    public function testClaimLimitDefaultsToTheDrainPassDefault(): void
    {
        $timeFactory = $this->createMock(ITimeFactory::class);
        $timeFactory->method('getTime')->willReturn(1784332800);

        $repo = new FakeSyncWorkLedgerRepository();
        // One more row than the default limit, so the boundary is observable.
        for ($i = 1; $i <= DrainPass::DEFAULT_LIMIT + 1; $i++) {
            $repo->seed('access', null, $i, ['uids' => ['alice']]);
        }
        $client = new FakeEventDeliveryClient(defaultStatus: 200);
        $drainPass = new DrainPass($repo, $client, new NullLogger());
        $recoverySweep = new StuckSentRecoverySweep($repo);

        $job = new DrainJob($timeFactory, $drainPass, $recoverySweep, new FakeConfig(), new NullLogger());
        $this->invokeRun($job);

        self::assertCount(
            DrainPass::DEFAULT_LIMIT,
            $repo->deliveredTerminal,
            'an unconfigured tick must drain exactly DrainPass::DEFAULT_LIMIT rows',
        );
    }

    public function testClaimLimitIsRaisedByAppConfigWithoutARedeploy(): void
    {
        $timeFactory = $this->createMock(ITimeFactory::class);
        $timeFactory->method('getTime')->willReturn(1784332800);

        $repo = new FakeSyncWorkLedgerRepository();
        $total = DrainPass::DEFAULT_LIMIT + 30;
        for ($i = 1; $i <= $total; $i++) {
            $repo->seed('access', null, $i, ['uids' => ['alice']]);
        }
        $client = new FakeEventDeliveryClient(defaultStatus: 200);
        $drainPass = new DrainPass($repo, $client, new NullLogger());
        $recoverySweep = new StuckSentRecoverySweep($repo);
        $config = new FakeConfig([], ['momentum' => ['ledger_drain_limit' => (string) $total]]);

        $job = new DrainJob($timeFactory, $drainPass, $recoverySweep, $config, new NullLogger());
        $this->invokeRun($job);

        self::assertCount(
            $total,
            $repo->deliveredTerminal,
            'a raised ledger_drain_limit must reach DrainPass — otherwise the documented knob does nothing (the G49 class of gap ledger_max_attempts exists to avoid)',
        );
    }

    /**
     * A limit of 0 or below would silently stop the ledger draining altogether —
     * every upload would stay invisible to search forever, with no error. Clamp
     * to the default rather than honouring it: unlike `ledger_max_attempts`,
     * where 0 has a documented meaning (retry forever), there is no useful
     * reading of "drain no rows".
     */
    public function testANonPositiveConfiguredLimitFallsBackToTheDefault(): void
    {
        $timeFactory = $this->createMock(ITimeFactory::class);
        $timeFactory->method('getTime')->willReturn(1784332800);

        $repo = new FakeSyncWorkLedgerRepository();
        for ($i = 1; $i <= 5; $i++) {
            $repo->seed('access', null, $i, ['uids' => ['alice']]);
        }
        $client = new FakeEventDeliveryClient(defaultStatus: 200);
        $drainPass = new DrainPass($repo, $client, new NullLogger());
        $recoverySweep = new StuckSentRecoverySweep($repo);
        $config = new FakeConfig([], ['momentum' => ['ledger_drain_limit' => '0']]);

        $job = new DrainJob($timeFactory, $drainPass, $recoverySweep, $config, new NullLogger());
        $this->invokeRun($job);

        self::assertCount(5, $repo->deliveredTerminal, 'a limit of 0 must not stall the ledger');
    }

    public function testSetsTheConfiguredTickInterval(): void
    {
        $timeFactory = $this->createMock(ITimeFactory::class);
        $repo = new FakeSyncWorkLedgerRepository();
        $client = new FakeEventDeliveryClient(defaultStatus: 200);
        $drainPass = new DrainPass($repo, $client, new NullLogger());
        $recoverySweep = new StuckSentRecoverySweep($repo);
        $logger = $this->createMock(LoggerInterface::class);

        $job = new DrainJob($timeFactory, $drainPass, $recoverySweep, new FakeConfig(), $logger);

        self::assertSame(30, $job->getInterval());
    }

    public function testDoesNotLogWhenNothingIsClaimed(): void
    {
        $timeFactory = $this->createMock(ITimeFactory::class);
        $timeFactory->method('getTime')->willReturn(1784332800);

        $repo = new FakeSyncWorkLedgerRepository();
        $client = new FakeEventDeliveryClient(defaultStatus: 200);
        $drainPass = new DrainPass($repo, $client, new NullLogger());
        $recoverySweep = new StuckSentRecoverySweep($repo);

        $logger = $this->createMock(LoggerInterface::class);
        $logger->expects(self::never())->method('info');

        $job = new DrainJob($timeFactory, $drainPass, $recoverySweep, new FakeConfig(), $logger);
        $this->invokeRun($job);
    }

    public function testRunsTheStuckSentRecoverySweepUsingTheConfiguredStatusPollIntervalMs(): void
    {
        $timeFactory = $this->createMock(ITimeFactory::class);
        $timeFactory->method('getTime')->willReturn(1784332800); // 2026-07-18T00:00:00Z

        $repo = new FakeSyncWorkLedgerRepository();
        $now = new DateTimeImmutable('@1784332800');
        // 2 minutes old: stuck under a 60s configured threshold but would
        // survive the 300s default, proving the config value is actually used.
        $stuckId = $repo->seedSent('events', 'created', 'abc123', $now->modify('-2 minutes'));

        $client = new FakeEventDeliveryClient(defaultStatus: 200);
        $drainPass = new DrainPass($repo, $client, new NullLogger());
        $recoverySweep = new StuckSentRecoverySweep($repo);
        $config = new FakeConfig([], ['momentum' => ['status_poll_interval_ms' => (string) (60 * 1000)]]);

        $logger = $this->createMock(LoggerInterface::class);
        $logger->expects(self::once())->method('info');

        $job = new DrainJob($timeFactory, $drainPass, $recoverySweep, $config, $logger);
        $this->invokeRun($job);

        self::assertCount(1, $repo->deliveredAwaiting);
        self::assertSame($stuckId, $repo->deliveredAwaiting[0]['id']);
    }

    public function testDeadLettersAPoisonRowUsingTheConfiguredLedgerMaxAttempts(): void
    {
        $timeFactory = $this->createMock(ITimeFactory::class);
        $timeFactory->method('getTime')->willReturn(1784332800);

        $repo = new FakeSyncWorkLedgerRepository();
        // Two failures already recorded: dead-lettered under the configured
        // cap of 3, still retried under the default of 10 — so this proves
        // the config value reaches DrainPass rather than being ignored (G49).
        $id = $repo->seed('events', 'created', 42, ['etag' => 'abc'], attempts: 2);
        $client = new FakeEventDeliveryClient(defaultStatus: 500);
        $logger = $this->createMock(LoggerInterface::class);
        $drainPass = new DrainPass($repo, $client, $logger);
        $recoverySweep = new StuckSentRecoverySweep($repo);
        $config = new FakeConfig([], ['momentum' => ['ledger_max_attempts' => '3']]);

        $job = new DrainJob($timeFactory, $drainPass, $recoverySweep, $config, $logger);
        $this->invokeRun($job);

        self::assertCount(1, $repo->deadLettered);
        self::assertSame($id, $repo->deadLettered[0]['id']);
        self::assertSame([], $repo->retried);
    }

    public function testRetriesTheSameRowUnderTheDefaultLedgerMaxAttempts(): void
    {
        $timeFactory = $this->createMock(ITimeFactory::class);
        $timeFactory->method('getTime')->willReturn(1784332800);

        $repo = new FakeSyncWorkLedgerRepository();
        $repo->seed('events', 'created', 42, ['etag' => 'abc'], attempts: 2);
        $client = new FakeEventDeliveryClient(defaultStatus: 500);
        $logger = $this->createMock(LoggerInterface::class);
        $drainPass = new DrainPass($repo, $client, $logger);
        $recoverySweep = new StuckSentRecoverySweep($repo);

        $job = new DrainJob($timeFactory, $drainPass, $recoverySweep, new FakeConfig(), $logger);
        $this->invokeRun($job);

        self::assertSame([], $repo->deadLettered);
        self::assertCount(1, $repo->retried);
    }

    public function testDoesNotRecoverARowFresherThanTheDefaultStalenessThreshold(): void
    {
        $timeFactory = $this->createMock(ITimeFactory::class);
        $timeFactory->method('getTime')->willReturn(1784332800);

        $repo = new FakeSyncWorkLedgerRepository();
        $now = new DateTimeImmutable('@1784332800');
        $repo->seedSent('events', 'created', 'abc123', $now->modify('-2 minutes'));

        $client = new FakeEventDeliveryClient(defaultStatus: 200);
        $drainPass = new DrainPass($repo, $client, new NullLogger());
        $recoverySweep = new StuckSentRecoverySweep($repo);

        $logger = $this->createMock(LoggerInterface::class);
        $logger->expects(self::never())->method('info');

        $job = new DrainJob($timeFactory, $drainPass, $recoverySweep, new FakeConfig(), $logger);
        $this->invokeRun($job);

        self::assertSame([], $repo->deliveredAwaiting);
    }
}
