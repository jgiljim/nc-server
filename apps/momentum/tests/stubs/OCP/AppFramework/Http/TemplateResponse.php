<?php

declare(strict_types=1);

namespace OCP\AppFramework\Http;

/**
 * Test-only stub reproducing the slice of
 * \OCP\AppFramework\Http\TemplateResponse's public API this app's
 * page-mounting controller depends on. Never shipped to production — see
 * glue-app/composer.json "autoload-dev" (OCP\ is not in "autoload"). At
 * runtime inside Nextcloud, the real server-provided class (which renders
 * the named PHP template from the app's templates/ directory) is used
 * instead.
 */
class TemplateResponse extends Response
{
    /** @param array<string, mixed> $params */
    public function __construct(
        private readonly string $appName,
        private readonly string $templateName,
        private readonly array $params = [],
        private readonly string $renderAs = 'user',
    ) {
    }

    public function getAppName(): string
    {
        return $this->appName;
    }

    public function getTemplateName(): string
    {
        return $this->templateName;
    }

    /** @return array<string, mixed> */
    public function getParams(): array
    {
        return $this->params;
    }

    public function getRenderAs(): string
    {
        return $this->renderAs;
    }
}
