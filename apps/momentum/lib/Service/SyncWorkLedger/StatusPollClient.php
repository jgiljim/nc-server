<?php

declare(strict_types=1);

namespace OCA\Momentum\Service\SyncWorkLedger;

/**
 * Reads `GET /internal/status` on the Doc-Mgr Backend (api.md § GET
 * /internal/status) — the batch label/status read the inbound status-poll
 * pass uses to pull classification results back into Nextcloud. The
 * concrete HTTP-backed implementation (NC `IClientService` + the EdDSA
 * identity token from the tenant mapper/token minter, M5.4) is wired up
 * separately; `StatusPollPass` only depends on this interface — mirroring
 * `EventDeliveryClient`.
 */
interface StatusPollClient
{
    /**
     * A `doc_id` not present for the caller's tenant (never ingested, or
     * deleted) is omitted from the result rather than erroring.
     *
     * @param list<int> $docIds max 200 per call — the caller batches
     * @return list<StatusItem>
     */
    public function getStatuses(array $docIds): array;
}
