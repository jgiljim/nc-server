<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\BackgroundJob;

use OCA\Momentum\BackgroundJob\CleanupSweepJob;
use OCA\Momentum\Service\SyncWorkLedger\CleanupSweep;
use OCA\Momentum\Tests\Support\FakeConfig;
use OCA\Momentum\Tests\Support\FakeStatusPollClient;
use OCA\Momentum\Tests\Support\FakeSyncWorkLedgerRepository;
use OCP\AppFramework\Utility\ITimeFactory;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;
use ReflectionMethod;

final class CleanupSweepJobTest extends TestCase
{
    private function invokeRun(CleanupSweepJob $job): void
    {
        $method = new ReflectionMethod($job, 'run');
        $method->setAccessible(true);
        $method->invoke($job, null);
    }

    public function testDeletesStaleSyncedRowsUsingTheConfiguredRetentionWindow(): void
    {
        $timeFactory = $this->createMock(ITimeFactory::class);
        $timeFactory->method('getTime')->willReturn(1784332800); // 2026-07-18T00:00:00Z

        $repo = new FakeSyncWorkLedgerRepository();
        $now = new \DateTimeImmutable('@1784332800');
        $staleId = $repo->seedSynced(1, $now->modify('-2 hours'));
        $freshId = $repo->seedSynced(2, $now->modify('-10 minutes'));

        $cleanupSweep = new CleanupSweep($repo, new FakeStatusPollClient());
        $config = new FakeConfig();

        $job = new CleanupSweepJob($timeFactory, $cleanupSweep, $config, $this->createMock(LoggerInterface::class));

        $this->invokeRun($job);

        self::assertFalse($repo->hasRow($staleId));
        self::assertTrue($repo->hasRow($freshId));
    }

    public function testUsesTheConfiguredLedgerRetentionMsAppValueInsteadOfTheDefault(): void
    {
        $timeFactory = $this->createMock(ITimeFactory::class);
        $timeFactory->method('getTime')->willReturn(1784332800);

        $repo = new FakeSyncWorkLedgerRepository();
        $now = new \DateTimeImmutable('@1784332800');
        // 20 minutes old: survives the default 1h window but not a 10-minute one.
        $id = $repo->seedSynced(1, $now->modify('-20 minutes'));

        $cleanupSweep = new CleanupSweep($repo, new FakeStatusPollClient());
        $config = new FakeConfig([], ['momentum' => ['ledger_retention_ms' => (string) (10 * 60 * 1000)]]);

        $job = new CleanupSweepJob($timeFactory, $cleanupSweep, $config, $this->createMock(LoggerInterface::class));

        $this->invokeRun($job);

        self::assertFalse($repo->hasRow($id));
    }

    public function testDeletesOrphanedAwaitingRowsOmittedFromTheStatusResponse(): void
    {
        $timeFactory = $this->createMock(ITimeFactory::class);
        $timeFactory->method('getTime')->willReturn(1784332800);

        $repo = new FakeSyncWorkLedgerRepository();
        $orphanId = $repo->seedAwaiting(42, 'processing');

        $cleanupSweep = new CleanupSweep($repo, new FakeStatusPollClient([]));
        $config = new FakeConfig();

        $job = new CleanupSweepJob($timeFactory, $cleanupSweep, $config, $this->createMock(LoggerInterface::class));

        $this->invokeRun($job);

        self::assertSame([$orphanId], $repo->orphanedAwaiting);
    }
}
