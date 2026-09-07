<?php

declare(strict_types=1);

namespace OCP\AppFramework\Http;

/**
 * Test-only stub reproducing the slice of
 * \OCP\AppFramework\Http\DataDisplayResponse's public API this app depends
 * on. Never shipped to production — see glue-app/composer.json
 * "autoload-dev" (OCP\ is not in "autoload"). At runtime inside Nextcloud,
 * the real server-provided class is used instead.
 */
class DataDisplayResponse extends Response
{
    public function __construct(
        private readonly string $data,
        int $statusCode = 200,
    ) {
        $this->setStatus($statusCode);
    }

    public function render(): string
    {
        return $this->data;
    }
}
