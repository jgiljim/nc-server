<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Service\SyncWorkLedger;

use OCA\Momentum\Service\SyncWorkLedger\StatusItem;
use OCA\Momentum\Service\SyncWorkLedger\StatusPollPass;
use OCA\Momentum\Tests\Support\FakeLabelWriter;
use OCA\Momentum\Tests\Support\FakeNotifyPushDispatcher;
use OCA\Momentum\Tests\Support\FakeStatusPollClient;
use OCA\Momentum\Tests\Support\FakeSyncWorkLedgerRepository;
use PHPUnit\Framework\TestCase;

final class StatusPollPassTest extends TestCase
{
    public function testNonTerminalStatusChangeWritesLabelAndUpdatesLastStatusButDoesNotPush(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        $id = $repo->seedAwaiting(42, 'pending', false);

        $client = new FakeStatusPollClient([
            42 => new StatusItem(42, 'processing', null, null, false, 1),
        ]);
        $labelWriter = new FakeLabelWriter();
        $notifyPush = new FakeNotifyPushDispatcher();

        $result = (new StatusPollPass($repo, $client, $labelWriter, $notifyPush))->run();

        self::assertSame(1, $result->polled);
        self::assertSame(1, $result->updated);
        self::assertSame(0, $result->synced);
        self::assertSame(0, $result->pushed);
        self::assertCount(1, $labelWriter->written);
        self::assertSame([['id' => $id, 'status' => 'processing', 'reviewed' => false]], $repo->statusUpdated);
        self::assertSame([], $repo->synced);
        self::assertSame([], $notifyPush->pushed);
    }

    public function testTerminalStatusChangeWritesLabelDropsTheRowAndPushes(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        $id = $repo->seedAwaiting(42, 'processing', false);

        $client = new FakeStatusPollClient([
            42 => new StatusItem(42, 'done', 'sales_invoice', 'inbound', false, 1),
        ]);
        $labelWriter = new FakeLabelWriter();
        $notifyPush = new FakeNotifyPushDispatcher();

        $result = (new StatusPollPass($repo, $client, $labelWriter, $notifyPush))->run();

        self::assertSame(1, $result->synced);
        self::assertSame(0, $result->updated);
        self::assertSame(1, $result->pushed);
        self::assertCount(1, $labelWriter->written);
        self::assertSame('done', $labelWriter->written[0]->status);
        self::assertSame([$id], $repo->synced);
        self::assertSame([], $repo->statusUpdated);
        self::assertCount(1, $notifyPush->pushed);
        self::assertSame('done', $notifyPush->pushed[0]->status);
    }

    public function testReviewedToggleWithNoStatusChangeWritesLabelAndPushes(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        $id = $repo->seedAwaiting(42, 'processing', false);

        $client = new FakeStatusPollClient([
            42 => new StatusItem(42, 'processing', null, null, true, 1),
        ]);
        $labelWriter = new FakeLabelWriter();
        $notifyPush = new FakeNotifyPushDispatcher();

        $result = (new StatusPollPass($repo, $client, $labelWriter, $notifyPush))->run();

        self::assertSame(1, $result->updated);
        self::assertSame(0, $result->synced);
        self::assertSame(1, $result->pushed);
        self::assertCount(1, $labelWriter->written);
        self::assertSame([['id' => $id, 'status' => 'processing', 'reviewed' => true]], $repo->statusUpdated);
        self::assertCount(1, $notifyPush->pushed);
        self::assertTrue($notifyPush->pushed[0]->reviewed);
    }

    public function testUnchangedStatusAndReviewedIsANoOp(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        $repo->seedAwaiting(42, 'processing', false);

        $client = new FakeStatusPollClient([
            42 => new StatusItem(42, 'processing', null, null, false, 1),
        ]);
        $labelWriter = new FakeLabelWriter();
        $notifyPush = new FakeNotifyPushDispatcher();

        $result = (new StatusPollPass($repo, $client, $labelWriter, $notifyPush))->run();

        self::assertSame(0, $result->updated);
        self::assertSame(0, $result->synced);
        self::assertSame(0, $result->pushed);
        self::assertSame([], $labelWriter->written);
        self::assertSame([], $repo->statusUpdated);
        self::assertSame([], $repo->synced);
        self::assertSame([], $notifyPush->pushed);
    }

    public function testDocIdOmittedFromTheResponseIsLeftUntouched(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        $id = $repo->seedAwaiting(42, 'processing');

        $client = new FakeStatusPollClient([]);
        $labelWriter = new FakeLabelWriter();
        $notifyPush = new FakeNotifyPushDispatcher();

        $result = (new StatusPollPass($repo, $client, $labelWriter, $notifyPush))->run();

        self::assertSame(1, $result->polled);
        self::assertSame(0, $result->updated);
        self::assertSame(0, $result->synced);
        self::assertSame(0, $result->pushed);
        self::assertSame([], $labelWriter->written);
        self::assertSame([$id], array_map(static fn ($row) => $row->id, $repo->claimAwaiting(10)));
    }

    public function testEmptyAwaitingSetDoesNotCallTheStatusClient(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        $client = new FakeStatusPollClient([]);
        $labelWriter = new FakeLabelWriter();
        $notifyPush = new FakeNotifyPushDispatcher();

        $result = (new StatusPollPass($repo, $client, $labelWriter, $notifyPush))->run();

        self::assertSame(0, $result->polled);
        self::assertSame([], $client->calls);
    }

    public function testBatchesDocIdsAtTwoHundredPerCall(): void
    {
        $repo = new FakeSyncWorkLedgerRepository();
        for ($docId = 1; $docId <= 250; $docId++) {
            $repo->seedAwaiting($docId, 'pending');
        }

        $client = new FakeStatusPollClient([]);
        $labelWriter = new FakeLabelWriter();
        $notifyPush = new FakeNotifyPushDispatcher();

        (new StatusPollPass($repo, $client, $labelWriter, $notifyPush))->run(300);

        self::assertCount(2, $client->calls);
        self::assertCount(200, $client->calls[0]);
        self::assertCount(50, $client->calls[1]);
    }
}
