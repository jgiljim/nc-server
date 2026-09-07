<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Support;

use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventDispatcher;

final class FakeEventDispatcher implements IEventDispatcher
{
    /** @var list<Event> */
    public array $dispatched = [];

    public function dispatchTyped(Event $event): void
    {
        $this->dispatched[] = $event;
    }
}
