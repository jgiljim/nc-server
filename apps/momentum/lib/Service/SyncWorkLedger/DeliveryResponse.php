<?php

declare(strict_types=1);

namespace OCA\Momentum\Service\SyncWorkLedger;

/**
 * Outcome of one delivery attempt (api.md § POST /internal/events, POST
 * /internal/access): any 2xx is a successful ack, everything else is a
 * failure to retry with backoff.
 */
final class DeliveryResponse
{
    public function __construct(public readonly int $statusCode)
    {
    }

    public function isSuccess(): bool
    {
        return $this->statusCode >= 200 && $this->statusCode < 300;
    }
}
