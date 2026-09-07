<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Listener;

use OCA\Momentum\Listener\FilesystemEventListener;
use OCA\Momentum\Service\FileAllowlist;
use OCA\Momentum\Service\FilesystemEventSink;
use OCA\Momentum\Tests\Support\FakeNode;
use OCP\Files\Events\Node\BeforeNodeDeletedEvent;
use OCP\Files\Events\Node\NodeCreatedEvent;
use OCP\Files\Events\Node\NodeRenamedEvent;
use OCP\Files\Events\Node\NodeWrittenEvent;
use PHPUnit\Framework\TestCase;

final class FilesystemEventListenerTest extends TestCase
{
    public function testDispatchesANodeCreatedEventAsCreated(): void
    {
        $node = new FakeNode(1, '/Invoices/2026/acme-q1.pdf', 'application/pdf', 1024);
        $allowlist = $this->createMock(FileAllowlist::class);
        $allowlist->method('isAllowed')->with($node)->willReturn(true);
        $sink = $this->createMock(FilesystemEventSink::class);
        $sink->expects(self::once())->method('handle')->with($node, 'created');

        $listener = new FilesystemEventListener($allowlist, $sink);
        $listener->handle(new NodeCreatedEvent($node));
    }

    public function testDispatchesANodeWrittenEventAsUpdated(): void
    {
        $node = new FakeNode(1, '/Invoices/2026/acme-q1.pdf', 'application/pdf', 1024);
        $allowlist = $this->createMock(FileAllowlist::class);
        $allowlist->method('isAllowed')->with($node)->willReturn(true);
        $sink = $this->createMock(FilesystemEventSink::class);
        $sink->expects(self::once())->method('handle')->with($node, 'updated');

        $listener = new FilesystemEventListener($allowlist, $sink);
        $listener->handle(new NodeWrittenEvent($node));
    }

    public function testDispatchesANodeRenamedEventAsUpdatedUsingTheTargetNode(): void
    {
        $source = new FakeNode(1, '/Invoices/2026/old-name.pdf', 'application/pdf', 1024);
        $target = new FakeNode(1, '/Invoices/2026/new-name.pdf', 'application/pdf', 1024);
        $allowlist = $this->createMock(FileAllowlist::class);
        $allowlist->method('isAllowed')->with($target)->willReturn(true);
        $sink = $this->createMock(FilesystemEventSink::class);
        $sink->expects(self::once())->method('handle')->with($target, 'updated');

        $listener = new FilesystemEventListener($allowlist, $sink);
        $listener->handle(new NodeRenamedEvent($source, $target));
    }

    public function testDispatchesABeforeNodeDeletedEventAsDeleted(): void
    {
        $node = new FakeNode(1, '/Invoices/2026/acme-q1.pdf', 'application/pdf', 1024);
        $allowlist = $this->createMock(FileAllowlist::class);
        $allowlist->method('isAllowed')->with($node)->willReturn(true);
        $sink = $this->createMock(FilesystemEventSink::class);
        $sink->expects(self::once())->method('handle')->with($node, 'deleted');

        $listener = new FilesystemEventListener($allowlist, $sink);
        $listener->handle(new BeforeNodeDeletedEvent($node));
    }

    public function testDropsAnEventForANodeTheAllowlistRejects(): void
    {
        $node = new FakeNode(1, '/Photos/holiday.jpg', 'image/jpeg', 1024);
        $allowlist = $this->createMock(FileAllowlist::class);
        $allowlist->method('isAllowed')->with($node)->willReturn(false);
        $sink = $this->createMock(FilesystemEventSink::class);
        $sink->expects(self::never())->method('handle');

        $listener = new FilesystemEventListener($allowlist, $sink);
        $listener->handle(new NodeCreatedEvent($node));
    }

    public function testIgnoresAnUnrelatedEventType(): void
    {
        $allowlist = $this->createMock(FileAllowlist::class);
        $allowlist->expects(self::never())->method('isAllowed');
        $sink = $this->createMock(FilesystemEventSink::class);
        $sink->expects(self::never())->method('handle');

        $listener = new FilesystemEventListener($allowlist, $sink);
        $listener->handle(new \OCP\EventDispatcher\Event());
    }
}
