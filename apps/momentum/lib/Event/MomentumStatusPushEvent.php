<?php

declare(strict_types=1);

namespace OCA\Momentum\Event;

use OCP\EventDispatcher\Event;

/**
 * The `momentum_status` NC notify_push event (architecture.md § ⑨ NC
 * notify_push; api.md § POST /internal/sync-metadata: "IEventDispatcher->
 * dispatchTyped(new MomentumStatusEvent(doc_id, status))"), dispatched once
 * per recipient uid — the PHP app owns this `IEventDispatcher` call, the
 * Go pipeline worker never publishes to notify_push directly. Carries only
 * `status`/`reviewed` (not `doc_type`/`direction` — see review.md G30, a
 * documented residual gap, not a bug to fix here).
 */
final class MomentumStatusPushEvent extends Event
{
    public function __construct(
        public readonly string $uid,
        public readonly int $docId,
        public readonly string $status,
        public readonly bool $reviewed,
    ) {
    }
}
