<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Support;

use OCA\Momentum\Service\SyncWorkLedger\DeliveryResponse;
use OCA\Momentum\Service\SyncWorkLedger\EventDeliveryClient;

final class FakeEventDeliveryClient implements EventDeliveryClient
{
    /** @var list<array{path: string, payload: array<string, mixed>}> */
    public array $calls = [];

    /** @var list<int> */
    private array $statusQueue;

    public function __construct(private int $defaultStatus = 202, array $statusQueue = [])
    {
        $this->statusQueue = $statusQueue;
    }

    public function post(string $path, array $payload): DeliveryResponse
    {
        $this->calls[] = ['path' => $path, 'payload' => $payload];

        $status = count($this->statusQueue) > 0 ? array_shift($this->statusQueue) : $this->defaultStatus;

        return new DeliveryResponse($status);
    }
}
