<?php

declare(strict_types=1);

namespace OCP\AppFramework\Http;

/**
 * Test-only stub reproducing \OCP\AppFramework\Http\DataDownloadResponse's
 * public API. Never shipped to production — see glue-app/composer.json
 * "autoload-dev" (OCP\ is not in "autoload"). At runtime inside Nextcloud,
 * the real server-provided class is used instead.
 */
class DataDownloadResponse extends Response
{
    public function __construct(
        private readonly string $data,
        string $filename,
        string $contentType,
    ) {
        $this->addHeader('Content-Disposition', 'attachment; filename="' . $filename . '"');
        $this->addHeader('Content-Type', $contentType);
    }

    public function render(): string
    {
        return $this->data;
    }
}
