<?php

declare(strict_types=1);

namespace OCP\AppFramework\Http;

/**
 * Test-only stub reproducing the slice of \OCP\AppFramework\Http\Response's
 * public API this app's responses depend on. Never shipped to production —
 * see glue-app/composer.json "autoload-dev" (OCP\ is not in "autoload"). At
 * runtime inside Nextcloud, the real server-provided class is used instead.
 */
abstract class Response
{
    /** @var array<string, string> */
    private array $headers = [];

    private int $status = 200;

    private ?ContentSecurityPolicy $contentSecurityPolicy = null;

    public function setContentSecurityPolicy(ContentSecurityPolicy $csp): static
    {
        $this->contentSecurityPolicy = $csp;

        return $this;
    }

    public function getContentSecurityPolicy(): ?ContentSecurityPolicy
    {
        return $this->contentSecurityPolicy;
    }

    public function addHeader(string $name, string $value): static
    {
        $this->headers[$name] = $value;

        return $this;
    }

    /** @return array<string, string> */
    public function getHeaders(): array
    {
        return $this->headers;
    }

    public function setStatus(int $status): static
    {
        $this->status = $status;

        return $this;
    }

    public function getStatus(): int
    {
        return $this->status;
    }
}
