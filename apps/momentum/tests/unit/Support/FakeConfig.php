<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Support;

use OCP\IConfig;

final class FakeConfig implements IConfig
{
    /** @var array<string, string> */
    private array $systemValues;

    /** @var array<string, array<string, string>> */
    private array $appValues;

    /** @var array<string, array<string, array<string, string>>> */
    private array $userValues;

    /**
     * @param array<string, string> $systemValues
     * @param array<string, array<string, string>> $appValues
     * @param array<string, array<string, array<string, string>>> $userValues keyed appName -> userId -> key
     */
    public function __construct(array $systemValues = [], array $appValues = [], array $userValues = [])
    {
        $this->systemValues = $systemValues;
        $this->appValues = $appValues;
        $this->userValues = $userValues;
    }

    public function getSystemValueString(string $key, string $default = ''): string
    {
        return $this->systemValues[$key] ?? $default;
    }

    public function getAppValue(string $appName, string $key, string $default = ''): string
    {
        return $this->appValues[$appName][$key] ?? $default;
    }

    public function setAppValue(string $appName, string $key, string $value): void
    {
        $this->appValues[$appName][$key] = $value;
    }

    public function getUserValue(string $userId, string $appName, string $key, string $default = ''): string
    {
        return $this->userValues[$appName][$userId][$key] ?? $default;
    }
}
