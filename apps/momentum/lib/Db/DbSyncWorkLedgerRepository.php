<?php

declare(strict_types=1);

namespace OCA\Momentum\Db;

use DateTimeImmutable;
use Doctrine\DBAL\ParameterType;
use OCP\IDBConnection;

/**
 * `IDBConnection`-backed implementation of {@see SyncWorkLedgerRepository}.
 * Raw parameterized SQL rather than a query builder — the table is simple
 * enough that the builder buys nothing, and `*PREFIX*` is Nextcloud's
 * documented placeholder for the configured table prefix in raw SQL.
 *
 * Covers both the outbound drain-pass operations (M5.3): claim due
 * `enqueued` rows, advance them on delivery, or reschedule them on failure;
 * and the inbound status-poll pass (M7.2): claim `awaiting` rows and either
 * update `last_status` or drop the row once its result is terminal. The
 * filesystem-event listener that writes the initial `enqueued` row (M5.2) is
 * a separate milestone.
 */
final class DbSyncWorkLedgerRepository implements SyncWorkLedgerRepository
{
    private const TABLE = '*PREFIX*momentum_sync_work_ledger';

    // How long a claimed row is protected from being re-claimed by a
    // concurrent drain pass before it's treated as abandoned (e.g. the
    // worker that claimed it died before calling markSent()/scheduleRetry()).
    // Comfortably longer than one Doc-Mgr Backend delivery POST; short enough
    // that an abandoned row isn't stuck for long.
    private const CLAIM_LEASE_SECONDS = 30;

    public function __construct(private IDBConnection $db)
    {
    }

    public function enqueue(
        string $target,
        ?string $eventType,
        ?int $docId,
        array $payload,
        DateTimeImmutable $now,
    ): int {
        // target = ? is required here: a genuinely new file's WebDAV PUT fires
        // *both* the post_create and post_write legacy hooks in the same
        // request (View::emit_file_hooks_post() always fires signal_post_write
        // unconditionally, in addition to signal_post_create when the file
        // didn't previously exist — lib/private/Files/Node/HookConnector.php),
        // so LedgerFilesystemEventSink::handle() runs twice: once with
        // event_type='created' (which also enqueues a target='access' row),
        // then again moments later with event_type='updated'. Without this
        // filter, the second call's dedup delete matched by doc_id alone and
        // silently deleted the just-inserted target='access' row too, since
        // it shares the same doc_id and 'enqueued' phase — access_projection
        // was therefore never actually seeded for any real upload, confirmed
        // live, 2026-07-27, by tracing a brand-new file through both hooks.
        if ($docId !== null && $eventType !== null && in_array($eventType, ['created', 'updated'], true)) {
            $this->db->executeStatement(
                'DELETE FROM ' . self::TABLE . ' WHERE target = ? AND doc_id = ? AND phase IN (?, ?, ?)',
                [$target, $docId, 'enqueued', 'sent', 'awaiting'],
            );
        }

        $this->db->executeStatement(
            'INSERT INTO ' . self::TABLE
                . ' (target, event_type, doc_id, phase, payload, attempts, created_at)'
                . ' VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                $target,
                $eventType,
                $docId,
                'enqueued',
                json_encode($payload, JSON_THROW_ON_ERROR),
                0,
                $now->format('Y-m-d H:i:s'),
            ],
        );

        // Confirmed via a live install, 2026-07-25: IDBConnection::lastInsertId()
        // requires the table name argument (no default) — Postgres has no
        // implicit last-insert-id the way MySQL/SQLite do, so Nextcloud's own
        // DB abstraction needs the table to resolve the right sequence.
        // Calling it with zero arguments threw ArgumentCountError on every
        // real Postgres-backed install, silently discarding every file
        // upload that reached this point (Sabre surfaces the uncaught error
        // as a generic 500 TypeError with no further detail).
        return $this->db->lastInsertId(self::TABLE);
    }

    public function claimDue(DateTimeImmutable $now, int $limit): array
    {
        $limit = max(0, $limit);
        if ($limit === 0) {
            return [];
        }

        $this->db->beginTransaction();

        try {
            // FOR UPDATE SKIP LOCKED: a concurrent drain pass racing this
            // same query gets the *next* due rows instead of blocking on (or
            // duplicating) the ones this transaction is about to claim.
            $result = $this->db->executeQuery(
                'SELECT id, target, event_type, doc_id, payload, attempts FROM ' . self::TABLE
                    . ' WHERE phase = ? AND (next_retry IS NULL OR next_retry <= ?)'
                    // Postgres's default is NULLS LAST on ASC, MySQL's is NULLS
                    // FIRST — an explicit COALESCE is required for both to agree,
                    // and it also keeps fresh rows (next_retry IS NULL) in FIFO
                    // order by created_at rather than all tying at one NULL rank.
                    . ' ORDER BY COALESCE(next_retry, created_at) ASC'
                    . ' LIMIT ' . $limit
                    . ' FOR UPDATE SKIP LOCKED',
                ['enqueued', $now->format('Y-m-d H:i:s')],
            );

            $rows = [];
            $ids = [];
            foreach ($result->fetchAll() as $row) {
                $ids[] = (int) $row['id'];
                $rows[] = new SyncWorkLedgerRow(
                    (int) $row['id'],
                    (string) $row['target'],
                    $row['event_type'] !== null ? (string) $row['event_type'] : null,
                    $row['doc_id'] !== null ? (int) $row['doc_id'] : null,
                    json_decode((string) $row['payload'], true, 512, JSON_THROW_ON_ERROR),
                    (int) $row['attempts'],
                );
            }
            $result->closeCursor();

            if ($ids !== []) {
                // The actual claim: push next_retry out past the lease
                // window so the WHERE clause above excludes these rows from
                // every other claimDue() call — concurrent or this same
                // caller's next tick — until either markSent()/scheduleRetry()
                // supersedes it with the real outcome, or the lease expires
                // and the row becomes claimable again (an abandoned-worker
                // row is simply retried, never stuck).
                $lease = $now->modify('+' . self::CLAIM_LEASE_SECONDS . ' seconds');
                $placeholders = implode(',', array_fill(0, count($ids), '?'));
                $this->db->executeStatement(
                    'UPDATE ' . self::TABLE . ' SET next_retry = ? WHERE id IN (' . $placeholders . ')',
                    [$lease->format('Y-m-d H:i:s'), ...$ids],
                );
            }

            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }

        return $rows;
    }

    public function markSent(int $id, ?string $sentEtag, DateTimeImmutable $sentAt): void
    {
        $this->db->executeStatement(
            'UPDATE ' . self::TABLE . ' SET phase = ?, sent_etag = ?, sent_at = ? WHERE id = ?',
            ['sent', $sentEtag, $sentAt->format('Y-m-d H:i:s'), $id],
        );
    }

    public function markDeliveredTerminal(int $id): void
    {
        $this->db->executeStatement('DELETE FROM ' . self::TABLE . ' WHERE id = ?', [$id]);
    }

    public function markDeliveredAwaiting(int $id, ?string $sentEtag, DateTimeImmutable $sentAt): void
    {
        $this->db->executeStatement(
            'UPDATE ' . self::TABLE . ' SET phase = ?, sent_etag = ?, sent_at = ? WHERE id = ?',
            ['awaiting', $sentEtag, $sentAt->format('Y-m-d H:i:s'), $id],
        );
    }

    public function scheduleRetry(int $id, int $attempts, DateTimeImmutable $nextRetry): void
    {
        $this->db->executeStatement(
            'UPDATE ' . self::TABLE . ' SET attempts = ?, next_retry = ? WHERE id = ?',
            [$attempts, $nextRetry->format('Y-m-d H:i:s'), $id],
        );
    }

    public function markDeadLettered(int $id, int $attempts, DateTimeImmutable $deadAt): void
    {
        // next_retry = NULL both because nothing reschedules a dead row and
        // so the claim lease this row still carries from claimDue() doesn't
        // linger as a misleading future timestamp; `phase = 'dead'` is what
        // actually keeps it out of every claim.
        $this->db->executeStatement(
            'UPDATE ' . self::TABLE
                . ' SET phase = ?, attempts = ?, next_retry = NULL, dead_at = ? WHERE id = ?',
            ['dead', $attempts, $deadAt->format('Y-m-d H:i:s'), $id],
        );
    }

    public function claimAwaiting(int $limit): array
    {
        $result = $this->db->executeQuery(
            'SELECT id, doc_id, last_status, last_reviewed FROM ' . self::TABLE
                . ' WHERE phase = ?'
                . ' ORDER BY id ASC'
                . ' LIMIT ' . max(0, $limit),
            ['awaiting'],
        );

        $rows = [];
        foreach ($result->fetchAll() as $row) {
            $rows[] = new AwaitingLedgerRow(
                (int) $row['id'],
                (int) $row['doc_id'],
                $row['last_status'] !== null ? (string) $row['last_status'] : null,
                $row['last_reviewed'] !== null ? (bool) $row['last_reviewed'] : null,
            );
        }
        $result->closeCursor();

        return $rows;
    }

    public function markStatusUpdated(int $id, string $status, bool $reviewed): void
    {
        // The `$types` array is load-bearing, not decoration. Without it
        // Doctrine binds `$reviewed` as a string, and `(string) false` is `''`,
        // which Postgres refuses for a boolean column — so on the running VM
        // (2026-08-18) every call threw
        //
        //   ERROR: invalid input syntax for type boolean: ""
        //   CONTEXT: unnamed portal parameter $2 = ''
        //
        // and no run ever recorded `last_status`/`last_reviewed`. `true` is not
        // exempt: it binds as `'1'`, which Postgres happens to accept, and
        // relying on that is accidental. This is the only boolean column in the
        // app's schema, so this is the only site that needs it — the guard in
        // FakeSyncLedgerDbConnection keeps the next one from being missed.
        $this->db->executeStatement(
            'UPDATE ' . self::TABLE . ' SET last_status = ?, last_reviewed = ? WHERE id = ?',
            [$status, $reviewed, $id],
            [ParameterType::STRING, ParameterType::BOOLEAN, ParameterType::INTEGER],
        );
    }

    public function markSynced(int $id): void
    {
        $this->db->executeStatement('DELETE FROM ' . self::TABLE . ' WHERE id = ?', [$id]);
    }

    public function deleteSyncedOlderThan(DateTimeImmutable $cutoff): int
    {
        return $this->db->executeStatement(
            'DELETE FROM ' . self::TABLE . ' WHERE phase = ? AND synced_at < ?',
            ['synced', $cutoff->format('Y-m-d H:i:s')],
        );
    }

    public function deleteOrphanedAwaiting(int $id): void
    {
        $this->db->executeStatement('DELETE FROM ' . self::TABLE . ' WHERE id = ?', [$id]);
    }

    public function rearmAwaiting(int $docId, array $payload, DateTimeImmutable $now): void
    {
        // target = 'events' only: doc_id is also used by target = 'access'
        // rows (the per-file uid-projection tracking row), which this
        // method must never touch.
        $updated = $this->db->executeStatement(
            'UPDATE ' . self::TABLE
                . ' SET phase = ?, payload = ?, last_status = NULL, last_reviewed = NULL,'
                . ' next_retry = NULL, sent_at = ?, sent_etag = NULL'
                . ' WHERE doc_id = ? AND target = ?',
            [
                'awaiting',
                json_encode($payload, JSON_THROW_ON_ERROR),
                $now->format('Y-m-d H:i:s'),
                $docId,
                'events',
            ],
        );

        if ($updated > 0) {
            return;
        }

        $this->db->executeStatement(
            'INSERT INTO ' . self::TABLE
                . ' (target, event_type, doc_id, phase, payload, attempts, created_at, sent_at)'
                . ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
                'events',
                'updated',
                $docId,
                'awaiting',
                json_encode($payload, JSON_THROW_ON_ERROR),
                0,
                $now->format('Y-m-d H:i:s'),
                $now->format('Y-m-d H:i:s'),
            ],
        );
    }

    public function claimStuckSent(DateTimeImmutable $cutoff, int $limit): array
    {
        $result = $this->db->executeQuery(
            'SELECT id, target, event_type, sent_etag, sent_at FROM ' . self::TABLE
                . ' WHERE phase = ? AND sent_at < ?'
                . ' ORDER BY sent_at ASC'
                . ' LIMIT ' . max(0, $limit),
            ['sent', $cutoff->format('Y-m-d H:i:s')],
        );

        $rows = [];
        foreach ($result->fetchAll() as $row) {
            $rows[] = new StuckSentLedgerRow(
                (int) $row['id'],
                (string) $row['target'],
                $row['event_type'] !== null ? (string) $row['event_type'] : null,
                $row['sent_etag'] !== null ? (string) $row['sent_etag'] : null,
                new DateTimeImmutable((string) $row['sent_at']),
            );
        }
        $result->closeCursor();

        return $rows;
    }
}
