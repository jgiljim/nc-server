<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Service;

use OCA\Momentum\Service\FileAllowlist;
use OCA\Momentum\Tests\Support\FakeNode;
use OCP\IConfig;
use PHPUnit\Framework\TestCase;

final class FileAllowlistTest extends TestCase
{
    public function testAllowsAV1SupportedFormatWithinTheDefaultSizeCap(): void
    {
        $config = $this->createMock(IConfig::class);
        $config->method('getAppValue')->willReturnArgument(2);
        $allowlist = new FileAllowlist($config);

        $node = new FakeNode(1, '/Invoices/2026/acme-q1.pdf', 'application/pdf', 1024);

        self::assertTrue($allowlist->isAllowed($node));
    }

    public function testRejectsAnUnsupportedMimetype(): void
    {
        $config = $this->createMock(IConfig::class);
        $config->method('getAppValue')->willReturnArgument(2);
        $allowlist = new FileAllowlist($config);

        $node = new FakeNode(1, '/Photos/holiday.jpg', 'image/jpeg', 1024);

        self::assertFalse($allowlist->isAllowed($node));
    }

    public function testRejectsAFileOverTheConfiguredMaxSize(): void
    {
        $config = $this->createMock(IConfig::class);
        $config->method('getAppValue')->willReturnCallback(
            fn (string $app, string $key, string $default) => $key === 'max_file_size_bytes' ? '100' : $default
        );
        $allowlist = new FileAllowlist($config);

        $node = new FakeNode(1, '/Invoices/2026/acme-q1.pdf', 'application/pdf', 101);

        self::assertFalse($allowlist->isAllowed($node));
    }

    public function testAllowsAFileAtExactlyTheMaxSize(): void
    {
        $config = $this->createMock(IConfig::class);
        $config->method('getAppValue')->willReturnCallback(
            fn (string $app, string $key, string $default) => $key === 'max_file_size_bytes' ? '100' : $default
        );
        $allowlist = new FileAllowlist($config);

        $node = new FakeNode(1, '/Invoices/2026/acme-q1.pdf', 'application/pdf', 100);

        self::assertTrue($allowlist->isAllowed($node));
    }

    public function testRejectsAHiddenDotfile(): void
    {
        $config = $this->createMock(IConfig::class);
        $config->method('getAppValue')->willReturnArgument(2);
        $allowlist = new FileAllowlist($config);

        $node = new FakeNode(1, '/Invoices/.acme-q1.pdf', 'application/pdf', 1024);

        self::assertFalse($allowlist->isAllowed($node));
    }

    public function testRejectsAnInProgressChunkedUploadPartFile(): void
    {
        $config = $this->createMock(IConfig::class);
        $config->method('getAppValue')->willReturnArgument(2);
        $allowlist = new FileAllowlist($config);

        $node = new FakeNode(1, '/Invoices/acme-q1.pdf.part', 'application/pdf', 1024);

        self::assertFalse($allowlist->isAllowed($node));
    }

    public function testHonoursAnAdminConfiguredMimetypeAllowlist(): void
    {
        $config = $this->createMock(IConfig::class);
        $config->method('getAppValue')->willReturnCallback(
            fn (string $app, string $key, string $default) => $key === 'mime_allowlist' ? 'image/jpeg' : $default
        );
        $allowlist = new FileAllowlist($config);

        $jpeg = new FakeNode(1, '/Photos/holiday.jpg', 'image/jpeg', 1024);
        $pdf = new FakeNode(2, '/Invoices/2026/acme-q1.pdf', 'application/pdf', 1024);

        self::assertTrue($allowlist->isAllowed($jpeg));
        self::assertFalse($allowlist->isAllowed($pdf));
    }

    public function testIsAllowedMimetypeAcceptsADefaultAllowlistedMimetype(): void
    {
        $config = $this->createMock(IConfig::class);
        $config->method('getAppValue')->willReturnArgument(2);
        $allowlist = new FileAllowlist($config);

        self::assertTrue($allowlist->isAllowedMimetype('application/pdf'));
    }

    public function testIsAllowedMimetypeRejectsAnUnsupportedMimetype(): void
    {
        $config = $this->createMock(IConfig::class);
        $config->method('getAppValue')->willReturnArgument(2);
        $allowlist = new FileAllowlist($config);

        self::assertFalse($allowlist->isAllowedMimetype('image/jpeg'));
    }

    public function testIsAllowedMimetypeHonoursAnAdminConfiguredMimetypeAllowlist(): void
    {
        $config = $this->createMock(IConfig::class);
        $config->method('getAppValue')->willReturnCallback(
            fn (string $app, string $key, string $default) => $key === 'mime_allowlist' ? 'image/jpeg' : $default
        );
        $allowlist = new FileAllowlist($config);

        self::assertTrue($allowlist->isAllowedMimetype('image/jpeg'));
        self::assertFalse($allowlist->isAllowedMimetype('application/pdf'));
    }
}
