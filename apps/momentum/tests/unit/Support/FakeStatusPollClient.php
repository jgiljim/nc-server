<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Support;

use OCA\Momentum\Service\SyncWorkLedger\StatusItem;
use OCA\Momentum\Service\SyncWorkLedger\StatusPollClient;

final class FakeStatusPollClient implements StatusPollClient
{
    /** @var list<list<int>> */
    public array $calls = [];

    /**
     * @param array<int, StatusItem> $itemsByDocId
     */
    public function __construct(private array $itemsByDocId = [])
    {
    }

    public function getStatuses(array $docIds): array
    {
        $this->calls[] = $docIds;

        $items = [];
        foreach ($docIds as $docId) {
            if (isset($this->itemsByDocId[$docId])) {
                $items[] = $this->itemsByDocId[$docId];
            }
        }

        return $items;
    }
}
