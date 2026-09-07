<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Support;

use OCP\AppFramework\Utility\ITimeFactory;

final class FakeTimeFactory implements ITimeFactory
{
    public function __construct(private readonly int $time)
    {
    }

    public function getTime(): int
    {
        return $this->time;
    }
}
