<?php

declare(strict_types=1);

namespace OCA\Momentum\Listener;

use OCA\Momentum\Service\FileAllowlist;
use OCA\Momentum\Service\FilesystemEventSink;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Files\Events\Node\BeforeNodeDeletedEvent;
use OCP\Files\Events\Node\NodeCreatedEvent;
use OCP\Files\Events\Node\NodeRenamedEvent;
use OCP\Files\Events\Node\NodeWrittenEvent;
use OCP\Files\Node;

/**
 * Registers for NodeCreatedEvent/NodeWrittenEvent/BeforeNodeDeletedEvent/
 * NodeRenamedEvent (architecture.md § ⑨ Filesystem-event listener). These
 * synchronous, in-transaction Nextcloud events are the authoritative,
 * lossless intake, replacing the standalone WebSocket. Allowlisted events
 * are handed to a {@see FilesystemEventSink}; rejected ones are dropped
 * here so they never reach the sync-work ledger.
 */
class FilesystemEventListener implements IEventListener
{
    public function __construct(
        private FileAllowlist $allowlist,
        private FilesystemEventSink $sink,
    ) {
    }

    public function handle(Event $event): void
    {
        if ($event instanceof NodeCreatedEvent) {
            $this->dispatch($event->getNode(), 'created');
            return;
        }

        if ($event instanceof NodeWrittenEvent) {
            $this->dispatch($event->getNode(), 'updated');
            return;
        }

        if ($event instanceof NodeRenamedEvent) {
            // Same fileId, new path/etag — an ordinary update, not a distinct
            // event_type (api.md POST /internal/events only knows
            // created|updated|deleted).
            $this->dispatch($event->getTarget(), 'updated');
            return;
        }

        if ($event instanceof BeforeNodeDeletedEvent) {
            $this->dispatch($event->getNode(), 'deleted');
        }
    }

    private function dispatch(Node $node, string $eventType): void
    {
        if (!$this->allowlist->isAllowed($node)) {
            return;
        }

        $this->sink->handle($node, $eventType);
    }
}
