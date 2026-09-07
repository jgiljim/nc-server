<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Support;

use Doctrine\DBAL\ParameterType;
use OCP\DB\IResult;
use OCP\IDBConnection;

/**
 * In-memory stand-in for {@see IDBConnection}, understanding exactly the
 * handful of SQL shapes {@see \OCA\Momentum\Db\DbSyncWorkLedgerRepository}
 * issues against `oc_momentum_sync_work_ledger`. Not a generic SQL engine —
 * tightly coupled to that repository by design, the same way
 * `FakeSchemaWrapper` is tightly coupled to Doctrine's `Schema`, so
 * repository tests exercise real insert/filter/update/delete semantics
 * instead of asserting on SQL strings.
 */
final class FakeSyncLedgerDbConnection implements IDBConnection
{
    /** @var array<int, array<string, mixed>> */
    private array $rows = [];
    private int $nextId = 1;

    /**
     * Reproduce the ONE respect in which this in-memory fake must not be more
     * forgiving than the real driver: an undeclared PHP bool.
     *
     * Doctrine binds a parameter with no `$types` entry as a string, and PHP's
     * `(string) false` is `''` — which Postgres refuses for a boolean column.
     * Measured on the running VM (2026-08-18, e2e run 5510):
     *
     *   ERROR: invalid input syntax for type boolean: ""
     *   CONTEXT: unnamed portal parameter $2 = ''
     *   STATEMENT: UPDATE oc_momentum_sync_work_ledger
     *              SET last_status = $1, last_reviewed = $2 WHERE id = $3
     *
     * so every non-terminal status update the poll pass made threw, and
     * `last_status`/`last_reviewed` were never recorded on any run. This fake
     * stored PHP values verbatim, so `false` round-tripped as `false` and the
     * repository test asserting exactly that scenario passed throughout — the
     * defect lived in the gap between the fake and the driver, not in either
     * one's own logic. `true` is not exempt: it binds as `'1'`, which Postgres
     * happens to accept as boolean input, and depending on that is accidental
     * rather than correct.
     *
     * @param array<int, mixed> $params
     * @param array<int, mixed> $types
     */
    private static function assertBoolParamsAreDeclared(string $sql, array $params, array $types): void
    {
        foreach ($params as $i => $value) {
            if (!is_bool($value)) {
                continue;
            }
            if (($types[$i] ?? null) === ParameterType::BOOLEAN) {
                continue;
            }

            throw new \RuntimeException(sprintf(
                'FakeSyncLedgerDbConnection: parameter %d of [%s] is a PHP bool with no ParameterType::BOOLEAN in $types. '
                . 'Doctrine would bind it as a string, and Postgres refuses \'\' for a boolean column '
                . '("invalid input syntax for type boolean").',
                $i + 1,
                $sql,
            ));
        }
    }

    public function executeStatement(string $sql, array $params = [], array $types = []): int
    {
        self::assertBoolParamsAreDeclared($sql, $params, $types);

        if (str_contains($sql, 'WHERE target = ? AND doc_id = ? AND phase IN')) {
            [$target, $docId, $p1, $p2, $p3] = $params;
            $before = count($this->rows);
            $this->rows = array_filter(
                $this->rows,
                fn (array $row) => !($row['target'] === $target && $row['doc_id'] === $docId && in_array($row['phase'], [$p1, $p2, $p3], true)),
            );

            return $before - count($this->rows);
        }

        if (str_contains($sql, 'SET phase = ?, payload = ?, last_status = NULL, last_reviewed = NULL,')) {
            [$phase, $payload, $sentAt, $docId, $target] = $params;

            $updated = 0;
            foreach ($this->rows as $id => $row) {
                if ($row['doc_id'] === $docId && $row['target'] === $target) {
                    $this->rows[$id]['phase'] = $phase;
                    $this->rows[$id]['payload'] = $payload;
                    $this->rows[$id]['last_status'] = null;
                    $this->rows[$id]['last_reviewed'] = null;
                    $this->rows[$id]['next_retry'] = null;
                    $this->rows[$id]['sent_at'] = $sentAt;
                    $this->rows[$id]['sent_etag'] = null;
                    $updated++;
                }
            }

            return $updated;
        }

        if (str_contains($sql, '(target, event_type, doc_id, phase, payload, attempts, created_at, sent_at)')) {
            [$target, $eventType, $docId, $phase, $payload, $attempts, $createdAt, $sentAt] = $params;
            $id = $this->nextId++;
            $this->rows[$id] = [
                'id' => $id,
                'target' => $target,
                'event_type' => $eventType,
                'doc_id' => $docId,
                'phase' => $phase,
                'last_status' => null,
                'last_reviewed' => null,
                'sent_etag' => null,
                'payload' => $payload,
                'attempts' => $attempts,
                'next_retry' => null,
                'created_at' => $createdAt,
                'sent_at' => $sentAt,
                'synced_at' => null,
                'dead_at' => null,
            ];

            return 1;
        }

        if (str_contains($sql, 'INSERT INTO')) {
            [$target, $eventType, $docId, $phase, $payload, $attempts, $createdAt] = $params;
            $id = $this->nextId++;
            $this->rows[$id] = [
                'id' => $id,
                'target' => $target,
                'event_type' => $eventType,
                'doc_id' => $docId,
                'phase' => $phase,
                'last_status' => null,
                'last_reviewed' => null,
                'sent_etag' => null,
                'payload' => $payload,
                'attempts' => $attempts,
                'next_retry' => null,
                'created_at' => $createdAt,
                'sent_at' => null,
                'synced_at' => null,
                'dead_at' => null,
            ];

            return 1;
        }

        if (str_contains($sql, 'SET phase = ?, attempts = ?, next_retry = NULL, dead_at = ? WHERE id = ?')) {
            [$phase, $attempts, $deadAt, $id] = $params;
            if (!isset($this->rows[$id])) {
                return 0;
            }
            $this->rows[$id]['phase'] = $phase;
            $this->rows[$id]['attempts'] = $attempts;
            $this->rows[$id]['next_retry'] = null;
            $this->rows[$id]['dead_at'] = $deadAt;

            return 1;
        }

        if (str_contains($sql, 'SET phase = ?, sent_etag = ?, sent_at = ? WHERE id = ?')) {
            [$phase, $sentEtag, $sentAt, $id] = $params;
            if (!isset($this->rows[$id])) {
                return 0;
            }
            $this->rows[$id]['phase'] = $phase;
            $this->rows[$id]['sent_etag'] = $sentEtag;
            $this->rows[$id]['sent_at'] = $sentAt;

            return 1;
        }

        if (str_contains($sql, 'SET next_retry = ? WHERE id IN')) {
            $nextRetry = array_shift($params);
            $updated = 0;
            foreach ($params as $id) {
                if (isset($this->rows[$id])) {
                    $this->rows[$id]['next_retry'] = $nextRetry;
                    $updated++;
                }
            }

            return $updated;
        }

        if (str_contains($sql, 'SET attempts = ?, next_retry = ? WHERE id = ?')) {
            [$attempts, $nextRetry, $id] = $params;
            if (!isset($this->rows[$id])) {
                return 0;
            }
            $this->rows[$id]['attempts'] = $attempts;
            $this->rows[$id]['next_retry'] = $nextRetry;

            return 1;
        }

        if (str_contains($sql, 'SET last_status = ?, last_reviewed = ? WHERE id = ?')) {
            [$status, $reviewed, $id] = $params;
            if (!isset($this->rows[$id])) {
                return 0;
            }
            $this->rows[$id]['last_status'] = $status;
            $this->rows[$id]['last_reviewed'] = $reviewed;

            return 1;
        }

        if (str_contains($sql, 'WHERE phase = ? AND synced_at < ?')) {
            [$phase, $cutoff] = $params;
            $before = count($this->rows);
            $this->rows = array_filter(
                $this->rows,
                fn (array $row) => !($row['phase'] === $phase && $row['synced_at'] !== null && $row['synced_at'] < $cutoff),
            );

            return $before - count($this->rows);
        }

        if (str_contains($sql, 'DELETE FROM') && str_contains($sql, 'WHERE id = ?')) {
            [$id] = $params;
            if (!isset($this->rows[$id])) {
                return 0;
            }
            unset($this->rows[$id]);

            return 1;
        }

        throw new \RuntimeException('FakeSyncLedgerDbConnection: unrecognized statement: ' . $sql);
    }

    public function executeQuery(string $sql, array $params = [], array $types = []): IResult
    {
        if (str_contains($sql, 'SELECT id, doc_id, last_status, last_reviewed FROM')) {
            [$phase] = $params;

            $matches = array_values(array_filter(
                $this->rows,
                fn (array $row) => $row['phase'] === $phase,
            ));

            usort($matches, fn (array $a, array $b) => $a['id'] <=> $b['id']);

            if (preg_match('/LIMIT (\d+)/', $sql, $m) === 1) {
                $matches = array_slice($matches, 0, (int) $m[1]);
            }

            $projected = array_map(
                fn (array $row) => [
                    'id' => $row['id'],
                    'doc_id' => $row['doc_id'],
                    'last_status' => $row['last_status'],
                    'last_reviewed' => $row['last_reviewed'],
                ],
                $matches,
            );

            return new FakeResult($projected);
        }

        if (str_contains($sql, "WHERE phase = ? AND (next_retry IS NULL OR next_retry <= ?)")) {
            [$phase, $now] = $params;

            $matches = array_values(array_filter(
                $this->rows,
                fn (array $row) => $row['phase'] === $phase
                    && ($row['next_retry'] === null || $row['next_retry'] <= $now),
            ));

            // Sorts on whatever ORDER BY the SQL actually asked for, so this
            // fake exercises the real query text rather than a hardcoded
            // assumption about it. `COALESCE(next_retry, created_at)` treats a
            // fresh (NULL next_retry) row as due at its own created_at, so it
            // takes its real place in the queue instead of being pinned to
            // one end the way a bare `next_retry ASC` (Postgres's default
            // NULLS LAST) would.
            if (str_contains($sql, 'ORDER BY COALESCE(next_retry, created_at) ASC')) {
                usort(
                    $matches,
                    fn (array $a, array $b) => ($a['next_retry'] ?? $a['created_at']) <=> ($b['next_retry'] ?? $b['created_at']),
                );
            } else {
                usort(
                    $matches,
                    function (array $a, array $b) {
                        if ($a['next_retry'] === null && $b['next_retry'] === null) {
                            return 0;
                        }
                        if ($a['next_retry'] === null) {
                            return 1;
                        }
                        if ($b['next_retry'] === null) {
                            return -1;
                        }

                        return $a['next_retry'] <=> $b['next_retry'];
                    },
                );
            }

            if (preg_match('/LIMIT (\d+)/', $sql, $m) === 1) {
                $matches = array_slice($matches, 0, (int) $m[1]);
            }

            $projected = array_map(
                fn (array $row) => [
                    'id' => $row['id'],
                    'target' => $row['target'],
                    'event_type' => $row['event_type'],
                    'doc_id' => $row['doc_id'],
                    'payload' => $row['payload'],
                    'attempts' => $row['attempts'],
                ],
                $matches,
            );

            return new FakeResult($projected);
        }

        throw new \RuntimeException('FakeSyncLedgerDbConnection: unrecognized query: ' . $sql);
    }

    public function lastInsertId(?string $table = null): int
    {
        return $this->nextId - 1;
    }

    /**
     * No-op: this fake applies every statement immediately and single-
     * threaded, so it has no isolation to model — it exists purely so
     * {@see DbSyncWorkLedgerRepository::claimDue()} can call the real
     * `IDBConnection` transaction API under test.
     */
    public function beginTransaction(): bool
    {
        return true;
    }

    public function commit(): bool
    {
        return true;
    }

    public function rollBack(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function row(int $id): ?array
    {
        return $this->rows[$id] ?? null;
    }

    public function count(): int
    {
        return count($this->rows);
    }

    /**
     * Test-only seam: {@see DbSyncWorkLedgerRepository} never itself writes
     * `phase = 'synced'` (it deletes on the same tick that would set it), so
     * the sweep-backstop tests seed that state directly rather than via a
     * repository method that doesn't exist.
     */
    public function seedSynced(int $docId, string $syncedAt): int
    {
        $id = $this->nextId++;
        $this->rows[$id] = [
            'id' => $id,
            'target' => 'events',
            'event_type' => 'created',
            'doc_id' => $docId,
            'phase' => 'synced',
            'last_status' => 'done',
            'last_reviewed' => null,
            'sent_etag' => null,
            'payload' => '{}',
            'attempts' => 0,
            'next_retry' => null,
            'created_at' => $syncedAt,
            'sent_at' => $syncedAt,
            'synced_at' => $syncedAt,
            'dead_at' => null,
        ];

        return $id;
    }
}
