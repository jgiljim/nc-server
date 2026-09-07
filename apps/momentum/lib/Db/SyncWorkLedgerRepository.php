<?php

declare(strict_types=1);

namespace OCA\Momentum\Db;

use DateTimeImmutable;

/**
 * Access to oc_momentum_sync_work_ledger (db.md § Nextcloud-DB Glue-App
 * Tables) needed by the outbound drain pass (M5.3, {@see
 * \OCA\Momentum\Service\SyncWorkLedger\DrainPass}) and the inbound
 * status-poll pass (M7.2, {@see
 * \OCA\Momentum\Service\SyncWorkLedger\StatusPollPass}). Kept as an
 * interface so both passes can be unit-tested against a hand-written
 * in-memory fake rather than a real Nextcloud DB connection — mirroring
 * `EventDeliveryClient`.
 */
interface SyncWorkLedgerRepository
{
    /**
     * Writes the initial `enqueued` row for a lifecycle event, inside the
     * caller's transaction (the upload txn, per db.md — this method itself
     * does not open one). A `created`/`updated` row for a `doc_id` that
     * already has an open row (`enqueued`/`sent`/`awaiting`) supersedes it:
     * the older row is dropped so only the newest tracking row survives
     * (db.md § Supersession).
     *
     * @param array<string, mixed> $payload
     */
    public function enqueue(
        string $target,
        ?string $eventType,
        ?int $docId,
        array $payload,
        DateTimeImmutable $now,
    ): int;

    /**
     * Rows due for outbound delivery: `enqueued` and either never retried or
     * past their `next_retry` (idx_sync_ledger_enqueued).
     *
     * @return list<SyncWorkLedgerRow>
     */
    public function claimDue(DateTimeImmutable $now, int $limit): array;

    /**
     * Local bookkeeping committed immediately on a 2xx delivery ack, before
     * the follow-up write that advances the row to `awaiting` or deletes it
     * (db.md § Phases). A process that dies between this write and that
     * follow-up leaves the row observable at `phase = 'sent'`, recoverable
     * by {@see claimStuckSent()}.
     */
    public function markSent(int $id, ?string $sentEtag, DateTimeImmutable $sentAt): void;

    /**
     * A 2xx ack for `target = 'access'` or `event_type = 'deleted'` has
     * nothing left to sync back — the row is dropped outright (db.md §
     * Phases).
     */
    public function markDeliveredTerminal(int $id): void;

    /**
     * A 2xx ack for a `created`/`updated` row advances it to `awaiting` the
     * status-poll pass, stamping `sent_at`/`sent_etag`.
     */
    public function markDeliveredAwaiting(int $id, ?string $sentEtag, DateTimeImmutable $sentAt): void;

    /**
     * Delivery failed (non-2xx or transport error): bump the attempt count
     * and push `next_retry` out per the caller's backoff policy.
     */
    public function scheduleRetry(int $id, int $attempts, DateTimeImmutable $nextRetry): void;

    /**
     * Delivery failed for the `ledger_max_attempts`-th time: the row moves
     * to the terminal `dead` phase and is never claimed again (db.md §
     * Attempts cap and dead-letter tier, backlog/to_change.md § G62 item 2).
     * The payload is retained — a dead row *is* the dead-letter store, so an
     * operator can inspect it and, once the cause is fixed, requeue it by
     * putting it back to `phase = 'enqueued'`.
     */
    public function markDeadLettered(int $id, int $attempts, DateTimeImmutable $deadAt): void;

    /**
     * Rows delivered and awaiting a terminal result from the Doc-Mgr Backend
     * (idx_sync_ledger_awaiting), for the inbound status-poll pass (M7.2).
     *
     * @return list<AwaitingLedgerRow>
     */
    public function claimAwaiting(int $limit): array;

    /**
     * A polled status and/or `reviewed` value that changed but is not yet a
     * terminal status: records both as the new `last_status`/`last_reviewed`
     * so the next tick only re-syncs on a further change (M7.3 — this is
     * also how a `reviewed` toggle with no status change is tracked).
     * `phase` stays `awaiting`.
     */
    public function markStatusUpdated(int $id, string $status, bool $reviewed): void;

    /**
     * A polled status that changed and is terminal (`done` | `needs_ocr` |
     * `failed`): the label has just been written, so the row's job is done
     * and it is dropped outright (db.md § Cleanup / retention — "synced rows
     * are deleted on the poll tick that sets them").
     */
    public function markSynced(int $id): void;

    /**
     * Terminal-row sweep backstop (db.md § Cleanup / retention, M7.4):
     * deletes any `phase = 'synced'` row whose `synced_at` is older than
     * `$cutoff`. In normal operation {@see markSynced()} already deletes the
     * row on the same tick that sets it, so this only catches a row that
     * somehow survived that delete (idx_sync_ledger_synced).
     *
     * @return int number of rows deleted
     */
    public function deleteSyncedOlderThan(DateTimeImmutable $cutoff): int;

    /**
     * Drops an `awaiting` row outright because its `doc_id` was omitted from
     * `/internal/status` (api.md): never ingested, or the file was deleted
     * from Nextcloud before a terminal result was ever produced, so the row
     * would otherwise poll forever.
     */
    public function deleteOrphanedAwaiting(int $id): void;

    /**
     * Rows stuck at `phase = 'sent'` whose `sent_at` is older than $cutoff
     * (idx_sync_ledger_sent) — the interrupted-local-write recovery sweep
     * (db.md § Stuck-`sent`-row recovery sweep, review.md G30/G34).
     *
     * @return list<StuckSentLedgerRow>
     */
    public function claimStuckSent(DateTimeImmutable $cutoff, int $limit): array;

    /**
     * Puts the `target = 'events'` tracking row for `$docId` back to
     * `phase = 'awaiting'` (clearing `last_status`/`last_reviewed` so the
     * next status-poll tick treats it as unsynced), or inserts a fresh one
     * directly at `awaiting` if the row was already pruned — db.md §
     * Cleanup/retention deletes a row the same tick it reaches a terminal
     * status, so by the time a `doc_type` correction or `POST .../reprocess`
     * needs to re-arm it, the original row is normally long gone (M68.6,
     * api.md § PATCH /documents/{public_id} "Nextcloud mode"). Inserting
     * straight at `awaiting` (skipping `enqueued`/`sent`) is deliberate: the
     * caller already delivered this change to the Doc-Mgr Backend via the
     * synchronous PATCH/POST call itself, so there is nothing left to drain
     * outbound — only the inbound status-poll pass has work to do.
     *
     * @param array<string, mixed> $payload
     */
    public function rearmAwaiting(int $docId, array $payload, DateTimeImmutable $now): void;
}
