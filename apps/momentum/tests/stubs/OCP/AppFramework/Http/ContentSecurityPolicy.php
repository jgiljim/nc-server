<?php

declare(strict_types=1);

namespace OCP\AppFramework\Http;

/**
 * Test-only stub reproducing the slice of
 * \OCP\AppFramework\Http\ContentSecurityPolicy's public API this app's
 * page-mounting controller depends on. Never shipped to production — see
 * glue-app/composer.json "autoload-dev" (OCP\ is not in "autoload"). At
 * runtime inside Nextcloud, the real server-provided class is used instead.
 */
class ContentSecurityPolicy
{
    /** @var string[] */
    private array $allowedFrameDomains = [];

    public function addAllowedFrameDomain(string $domain): static
    {
        $this->allowedFrameDomains[] = $domain;

        return $this;
    }

    /** @return string[] */
    public function getAllowedFrameDomains(): array
    {
        return $this->allowedFrameDomains;
    }
}
