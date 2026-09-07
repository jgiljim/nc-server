<?php

declare(strict_types=1);

namespace OCA\Momentum\Service\SyncWorkLedger;

use OCA\Momentum\Db\SyncWorkLedgerRepository;

/**
 * Inbound half of the sync-work ledger's two-pass drain/poll (db.md §
 * Nextcloud-DB Glue-App Tables): claims `awaiting` rows, batches their
 * `doc_id`s into `GET /internal/status` (api.md), and for each row whose
 * returned status or `reviewed` value differs from what was last synced
 * writes the FilesMetadata + SystemTags labels via {@see LabelWriter}. A
 * non-terminal change updates `last_status`/`last_reviewed` and leaves the
 * row `awaiting`; a terminal change (`done` | `needs_ocr` | `failed`) drops
 * the row outright — its job is done. A `doc_id` omitted from the response
 * (never ingested, or deleted) is left untouched; that persistent-omission
 * cleanup is the terminal-row sweep's job (M7.4), not this pass's.
 *
 * Emits the `momentum_status` NC notify_push (architecture.md § ⑨ NC
 * notify_push; requirements.md KL-1) via {@see NotifyPushDispatcher} — but
 * only on the two push-worthy transitions the spec calls out: a terminal
 * status transition, or a `reviewed` toggle with no accompanying terminal
 * status (M7.3). Non-terminal progress (`pending` → `processing`) never
 * pushes; those viewers rely on the frontend poll. `NotifyPushDispatcher`
 * itself owns recipient resolution and the recipient cap — this pass only
 * decides *when* to call it.
 *
 * Intended to run once per NC `ITimedJob` tick alongside the drain pass.
 */
final class StatusPollPass
{
    private const DEFAULT_LIMIT = 50;

    /** api.md § GET /internal/status: "Max 200 per call; the poller batches." */
    private const MAX_BATCH = 200;

    public function __construct(
        private readonly SyncWorkLedgerRepository $repository,
        private readonly StatusPollClient $client,
        private readonly LabelWriter $labelWriter,
        private readonly NotifyPushDispatcher $notifyPushDispatcher,
    ) {
    }

    public function run(int $limit = self::DEFAULT_LIMIT): StatusPollPassResult
    {
        $rows = $this->repository->claimAwaiting($limit);
        if ($rows === []) {
            return new StatusPollPassResult(0, 0, 0, 0);
        }

        $rowsByDocId = [];
        foreach ($rows as $row) {
            $rowsByDocId[$row->docId] = $row;
        }

        $updated = 0;
        $synced = 0;
        $pushed = 0;

        foreach (array_chunk(array_keys($rowsByDocId), self::MAX_BATCH) as $docIdBatch) {
            foreach ($this->client->getStatuses($docIdBatch) as $item) {
                $row = $rowsByDocId[$item->docId] ?? null;
                if ($row === null) {
                    continue;
                }

                $statusChanged = $item->status !== $row->lastStatus;
                $reviewedChanged = $item->reviewed !== ($row->lastReviewed ?? false);

                if (!$statusChanged && !$reviewedChanged) {
                    continue;
                }

                $this->labelWriter->write($item);

                if ($item->isTerminal()) {
                    $this->repository->markSynced($row->id);
                    $synced++;
                    $this->notifyPushDispatcher->push($item);
                    $pushed++;
                } else {
                    $this->repository->markStatusUpdated($row->id, $item->status, $item->reviewed);
                    $updated++;

                    if ($reviewedChanged) {
                        $this->notifyPushDispatcher->push($item);
                        $pushed++;
                    }
                }
            }
        }

        return new StatusPollPassResult(count($rows), $updated, $synced, $pushed);
    }
}
