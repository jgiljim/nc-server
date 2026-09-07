<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\AppInfo;

use OCA\Momentum\AppInfo\Application;
use PHPUnit\Framework\TestCase;

final class InfoXmlTest extends TestCase
{
    public function testInfoXmlDeclaresTheMomentumAppId(): void
    {
        $info = simplexml_load_file(__DIR__ . '/../../../appinfo/info.xml');

        self::assertNotFalse($info, 'appinfo/info.xml must be well-formed XML');
        self::assertSame(Application::APP_ID, (string) $info->id);
        self::assertSame('Momentum', (string) $info->namespace);
    }

    public function testInfoXmlDeclaresPhpAndNextcloudDependencies(): void
    {
        $info = simplexml_load_file(__DIR__ . '/../../../appinfo/info.xml');

        self::assertNotFalse($info);
        self::assertNotNull($info->dependencies->php['min-version']);
        self::assertNotNull($info->dependencies->nextcloud['min-version']);
    }
}
