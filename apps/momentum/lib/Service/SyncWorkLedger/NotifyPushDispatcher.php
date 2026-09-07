<?php

declare(strict_types=1);

namespace OCA\Momentum\Service\SyncWorkLedger;

/**
 * Emits the `momentum_status` NC notify_push (architecture.md § ⑨ NC
 * notify_push; requirements.md KL-1) for a {@see StatusPollPass} item that
 * just crossed a push-worthy transition (a terminal status, or a `reviewed`
 * toggle). Resolving the recipient set and applying the recipient cap are
 * this interface's job, not the poll pass's — kept as an interface so
 * `StatusPollPass` can be unit-tested without a real Nextcloud instance,
 * mirroring `LabelWriter`.
 */
interface NotifyPushDispatcher
{
    public function push(StatusItem $item): void;
}
