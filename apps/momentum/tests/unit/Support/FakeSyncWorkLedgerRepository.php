<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Support;

use DateTimeImmutable;
use OCA\Momentum\Db\AwaitingLedgerRow;
use OCA\Momentum\Db\StuckSentLedgerRow;
use OCA\Momentum\Db\SyncWorkLedgerRepository;
use OCA\Momentum\Db\SyncWorkLedgerRow;

/**
 * Hand-written in-memory {@see SyncWorkLedgerRepository}, for testing
 * `DrainPass` and `StatusPollPass` without a database of any kind.
 */
final class FakeSyncWorkLedgerRepository implements SyncWorkLedgerRepository
{
    /** @var array<int, array{target: string, eventType: ?string, docId: ?int, payload: array<string, mixed>, attempts: int, phase: string, lastStatus: ?string, lastReviewed: ?bool, syncedAt: ?DateTimeImmutable, sentEtag: ?string, sentAt: ?DateTimeImmutable}> */
    private array $rows = [];
    private int $nextId = 1;

    /** @var list<array{id: int, sentEtag: ?string, sentAt: DateTimeImmutable}> */
    public array $sentMarked = [];

    /** @var list<array{id: int, sentEtag: ?string, sentAt: DateTimeImmutable}> */
    public array $deliveredAwaiting = [];

    /** @var list<int> */
    public array $deliveredTerminal = [];

    /** @var list<array{id: int, attempts: int, nextRetry: DateTimeImmutable}> */
    public array $retried = [];

    /** @var list<array{id: int, attempts: int, deadAt: DateTimeImmutable}> */
    public array $deadLettered = [];

    /** @var list<array{id: int, status: string, reviewed: bool}> */
    public array $statusUpdated = [];

    /** @var list<int> */
    public array $synced = [];

    /** @var list<int> */
    public array $orphanedAwaiting = [];

    /**
     * @param array<string, mixed> $payload
     */
    public function seed(string $target, ?string $eventType, ?int $docId, array $payload, int $attempts = 0): int
    {
        $id = $this->nextId++;
        $this->rows[$id] = [
            'target' => $target,
            'eventType' => $eventType,
            'docId' => $docId,
            'payload' => $payload,
            'attempts' => $attempts,
            'phase' => 'enqueued',
            'lastStatus' => null,
            'lastReviewed' => null,
            'syncedAt' => null,
            'sentEtag' => null,
            'sentAt' => null,
        ];

        return $id;
    }

    public function seedSent(
        string $target,
        ?string $eventType,
        ?string $sentEtag,
        DateTimeImmutable $sentAt,
    ): int {
        $id = $this->nextId++;
        $this->rows[$id] = [
            'target' => $target,
            'eventType' => $eventType,
            'docId' => null,
            'payload' => [],
            'attempts' => 0,
            'phase' => 'sent',
            'lastStatus' => null,
            'lastReviewed' => null,
            'syncedAt' => null,
            'sentEtag' => $sentEtag,
            'sentAt' => $sentAt,
        ];

        return $id;
    }

    public function seedAwaiting(int $docId, ?string $lastStatus = null, ?bool $lastReviewed = null): int
    {
        $id = $this->nextId++;
        $this->rows[$id] = [
            'target' => 'events',
            'eventType' => 'created',
            'docId' => $docId,
            'payload' => [],
            'attempts' => 0,
            'phase' => 'awaiting',
            'lastStatus' => $lastStatus,
            'lastReviewed' => $lastReviewed,
            'syncedAt' => null,
            'sentEtag' => null,
            'sentAt' => null,
        ];

        return $id;
    }

    public function seedSynced(int $docId, DateTimeImmutable $syncedAt): int
    {
        $id = $this->nextId++;
        $this->rows[$id] = [
            'target' => 'events',
            'eventType' => 'created',
            'docId' => $docId,
            'payload' => [],
            'attempts' => 0,
            'phase' => 'synced',
            'lastStatus' => 'done',
            'lastReviewed' => false,
            'syncedAt' => $syncedAt,
            'sentEtag' => null,
            'sentAt' => null,
        ];

        return $id;
    }

    public function enqueue(
        string $target,
        ?string $eventType,
        ?int $docId,
        array $payload,
        DateTimeImmutable $now,
    ): int {
        return $this->seed($target, $eventType, $docId, $payload);
    }

    public function claimDue(DateTimeImmutable $now, int $limit): array
    {
        $due = [];
        foreach ($this->rows as $id => $row) {
            if ($row['phase'] !== 'enqueued') {
                continue;
            }
            $due[] = new SyncWorkLedgerRow(
                $id,
                $row['target'],
                $row['eventType'],
                $row['docId'],
                $row['payload'],
                $row['attempts'],
            );
        }

        return array_slice($due, 0, $limit);
    }

    public function markSent(int $id, ?string $sentEtag, DateTimeImmutable $sentAt): void
    {
        $this->sentMarked[] = ['id' => $id, 'sentEtag' => $sentEtag, 'sentAt' => $sentAt];
        $this->rows[$id]['phase'] = 'sent';
        $this->rows[$id]['sentEtag'] = $sentEtag;
        $this->rows[$id]['sentAt'] = $sentAt;
    }

    public function markDeliveredTerminal(int $id): void
    {
        $this->deliveredTerminal[] = $id;
        unset($this->rows[$id]);
    }

    public function markDeliveredAwaiting(int $id, ?string $sentEtag, DateTimeImmutable $sentAt): void
    {
        $this->deliveredAwaiting[] = ['id' => $id, 'sentEtag' => $sentEtag, 'sentAt' => $sentAt];
        unset($this->rows[$id]);
    }

    public function scheduleRetry(int $id, int $attempts, DateTimeImmutable $nextRetry): void
    {
        $this->retried[] = ['id' => $id, 'attempts' => $attempts, 'nextRetry' => $nextRetry];
        $this->rows[$id]['attempts'] = $attempts;
    }

    public function markDeadLettered(int $id, int $attempts, DateTimeImmutable $deadAt): void
    {
        $this->deadLettered[] = ['id' => $id, 'attempts' => $attempts, 'deadAt' => $deadAt];
        $this->rows[$id]['attempts'] = $attempts;
        // 'dead' is terminal: claimDue() only ever returns 'enqueued' rows,
        // so the row stays inspectable here without being re-delivered.
        $this->rows[$id]['phase'] = 'dead';
    }

    public function claimAwaiting(int $limit): array
    {
        $rows = [];
        foreach ($this->rows as $id => $row) {
            if ($row['phase'] !== 'awaiting') {
                continue;
            }
            $rows[] = new AwaitingLedgerRow($id, $row['docId'], $row['lastStatus'], $row['lastReviewed']);
        }

        return array_slice($rows, 0, $limit);
    }

    public function markStatusUpdated(int $id, string $status, bool $reviewed): void
    {
        $this->statusUpdated[] = ['id' => $id, 'status' => $status, 'reviewed' => $reviewed];
        $this->rows[$id]['lastStatus'] = $status;
        $this->rows[$id]['lastReviewed'] = $reviewed;
    }

    public function markSynced(int $id): void
    {
        $this->synced[] = $id;
        unset($this->rows[$id]);
    }

    public function deleteSyncedOlderThan(DateTimeImmutable $cutoff): int
    {
        $before = count($this->rows);
        $this->rows = array_filter(
            $this->rows,
            fn (array $row) => !($row['phase'] === 'synced' && $row['syncedAt'] !== null && $row['syncedAt'] < $cutoff),
        );

        return $before - count($this->rows);
    }

    public function deleteOrphanedAwaiting(int $id): void
    {
        $this->orphanedAwaiting[] = $id;
        unset($this->rows[$id]);
    }

    public function claimStuckSent(DateTimeImmutable $cutoff, int $limit): array
    {
        $rows = [];
        foreach ($this->rows as $id => $row) {
            if ($row['phase'] !== 'sent' || $row['sentAt'] === null || $row['sentAt'] >= $cutoff) {
                continue;
            }
            $rows[] = new StuckSentLedgerRow($id, $row['target'], $row['eventType'], $row['sentEtag'], $row['sentAt']);
        }

        return array_slice($rows, 0, $limit);
    }

    public function hasRow(int $id): bool
    {
        return isset($this->rows[$id]);
    }

    /** @var list<array{docId: int, payload: array<string, mixed>}> */
    public array $rearmed = [];

    /**
     * @param array<string, mixed> $payload
     */
    public function rearmAwaiting(int $docId, array $payload, DateTimeImmutable $now): void
    {
        $this->rearmed[] = ['docId' => $docId, 'payload' => $payload];

        foreach ($this->rows as $id => $row) {
            if ($row['docId'] === $docId && $row['target'] === 'events') {
                $this->rows[$id]['phase'] = 'awaiting';
                $this->rows[$id]['payload'] = $payload;
                $this->rows[$id]['lastStatus'] = null;
                $this->rows[$id]['lastReviewed'] = null;
                $this->rows[$id]['sentAt'] = $now;

                return;
            }
        }

        $id = $this->nextId++;
        $this->rows[$id] = [
            'target' => 'events',
            'eventType' => 'updated',
            'docId' => $docId,
            'payload' => $payload,
            'attempts' => 0,
            'phase' => 'awaiting',
            'lastStatus' => null,
            'lastReviewed' => null,
            'syncedAt' => null,
            'sentEtag' => null,
            'sentAt' => $now,
        ];
    }

    public function phaseOf(int $id): ?string
    {
        return $this->rows[$id]['phase'] ?? null;
    }
}
