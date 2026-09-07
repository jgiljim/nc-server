<?php

declare(strict_types=1);

namespace OCA\Momentum\Service\SyncWorkLedger;

/**
 * Delivers one drained ledger row's payload to the Doc-Mgr Backend
 * (`POST /internal/events` or `POST /internal/access`, api.md). The concrete
 * HTTP-backed implementation is {@see HttpEventDeliveryClient} (NC
 * `IClientService` + the EdDSA identity token from the tenant mapper/token
 * minter, M5.4); `DrainPass` only depends on this interface.
 */
interface EventDeliveryClient
{
    /**
     * @param array<string, mixed> $payload
     */
    public function post(string $path, array $payload): DeliveryResponse;
}
