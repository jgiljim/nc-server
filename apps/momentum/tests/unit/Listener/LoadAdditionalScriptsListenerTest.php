<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Listener;

use OCA\Files\Event\LoadAdditionalScriptsEvent;
use OCA\Momentum\Listener\LoadAdditionalScriptsListener;
use OCP\EventDispatcher\Event;
use OCP\Util;
use PHPUnit\Framework\TestCase;

final class LoadAdditionalScriptsListenerTest extends TestCase
{
    protected function setUp(): void
    {
        Util::$addScriptCalls = [];
    }

    public function testInjectsTheFilesIntegrationBundleOnLoadAdditionalScripts(): void
    {
        (new LoadAdditionalScriptsListener())->handle(new LoadAdditionalScriptsEvent());

        self::assertSame([['momentum', 'momentum-files']], Util::$addScriptCalls);
    }

    public function testIgnoresUnrelatedEvents(): void
    {
        (new LoadAdditionalScriptsListener())->handle(new Event());

        self::assertSame([], Util::$addScriptCalls);
    }
}
