<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\BackgroundJob;

use OCA\Momentum\BackgroundJob\StatusPollJob;
use OCA\Momentum\Service\SyncWorkLedger\StatusItem;
use OCA\Momentum\Service\SyncWorkLedger\StatusPollPass;
use OCA\Momentum\Tests\Support\FakeLabelWriter;
use OCA\Momentum\Tests\Support\FakeNotifyPushDispatcher;
use OCA\Momentum\Tests\Support\FakeStatusPollClient;
use OCA\Momentum\Tests\Support\FakeSyncWorkLedgerRepository;
use OCP\AppFramework\Utility\ITimeFactory;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;
use ReflectionMethod;

final class StatusPollJobTest extends TestCase
{
    private function invokeRun(StatusPollJob $job): void
    {
        $method = new ReflectionMethod($job, 'run');
        $method->setAccessible(true);
        $method->invoke($job, null);
    }

    public function testRunsTheStatusPollPassOnce(): void
    {
        $timeFactory = $this->createMock(ITimeFactory::class);
        $timeFactory->method('getTime')->willReturn(1784332800); // 2026-07-18T00:00:00Z

        $repo = new FakeSyncWorkLedgerRepository();
        $id = $repo->seedAwaiting(42, 'processing', false);

        $client = new FakeStatusPollClient([
            42 => new StatusItem(42, 'done', 'sales_invoice', 'inbound', false, 1),
        ]);
        $labelWriter = new FakeLabelWriter();
        $notifyPush = new FakeNotifyPushDispatcher();

        $pass = new StatusPollPass($repo, $client, $labelWriter, $notifyPush);

        $job = new StatusPollJob($timeFactory, $pass, $this->createMock(LoggerInterface::class));

        $this->invokeRun($job);

        self::assertSame([$id], $repo->synced);
        self::assertCount(1, $labelWriter->written);
        self::assertCount(1, $notifyPush->pushed);
    }

    public function testDoesNothingWhenNoRowsAreAwaiting(): void
    {
        $timeFactory = $this->createMock(ITimeFactory::class);
        $timeFactory->method('getTime')->willReturn(1784332800);

        $repo = new FakeSyncWorkLedgerRepository();
        $client = new FakeStatusPollClient();
        $labelWriter = new FakeLabelWriter();
        $notifyPush = new FakeNotifyPushDispatcher();

        $pass = new StatusPollPass($repo, $client, $labelWriter, $notifyPush);

        $job = new StatusPollJob($timeFactory, $pass, $this->createMock(LoggerInterface::class));

        $this->invokeRun($job);

        self::assertSame([], $repo->synced);
        self::assertCount(0, $labelWriter->written);
        self::assertCount(0, $notifyPush->pushed);
    }
}
