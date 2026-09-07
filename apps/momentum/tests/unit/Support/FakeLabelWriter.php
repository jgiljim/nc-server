<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Support;

use OCA\Momentum\Service\SyncWorkLedger\LabelWriter;
use OCA\Momentum\Service\SyncWorkLedger\StatusItem;

final class FakeLabelWriter implements LabelWriter
{
    /** @var list<StatusItem> */
    public array $written = [];

    public function write(StatusItem $item): void
    {
        $this->written[] = $item;
    }
}
