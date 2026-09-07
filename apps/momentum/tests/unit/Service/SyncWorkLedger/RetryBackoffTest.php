<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Service\SyncWorkLedger;

use OCA\Momentum\Service\SyncWorkLedger\RetryBackoff;
use PHPUnit\Framework\TestCase;

final class RetryBackoffTest extends TestCase
{
    public function testDoublesFromTheBaseDelay(): void
    {
        self::assertSame(5, RetryBackoff::secondsAfter(1));
        self::assertSame(10, RetryBackoff::secondsAfter(2));
        self::assertSame(20, RetryBackoff::secondsAfter(3));
        self::assertSame(40, RetryBackoff::secondsAfter(4));
    }

    public function testCapsAtTheMaximumDelay(): void
    {
        self::assertSame(300, RetryBackoff::secondsAfter(10));
        self::assertSame(300, RetryBackoff::secondsAfter(100));
    }

    public function testTreatsAnyNonPositiveAttemptCountAsTheFirstAttempt(): void
    {
        self::assertSame(5, RetryBackoff::secondsAfter(0));
        self::assertSame(5, RetryBackoff::secondsAfter(-1));
    }
}
