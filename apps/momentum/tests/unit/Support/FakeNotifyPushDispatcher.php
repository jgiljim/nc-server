<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Support;

use OCA\Momentum\Service\SyncWorkLedger\NotifyPushDispatcher;
use OCA\Momentum\Service\SyncWorkLedger\StatusItem;

final class FakeNotifyPushDispatcher implements NotifyPushDispatcher
{
    /** @var list<StatusItem> */
    public array $pushed = [];

    public function push(StatusItem $item): void
    {
        $this->pushed[] = $item;
    }
}
