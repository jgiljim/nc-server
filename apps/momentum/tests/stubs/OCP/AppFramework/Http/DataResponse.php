<?php

declare(strict_types=1);

namespace OCP\AppFramework\Http;

/**
 * Test-only stub reproducing the slice of \OCP\AppFramework\Http\DataResponse's
 * public API this app's JSON-returning controllers depend on. Never shipped
 * to production — see glue-app/composer.json "autoload-dev" (OCP\ is not in
 * "autoload"). At runtime inside Nextcloud, the real server-provided class
 * (which wraps this payload in the OCS `{"ocs":{"data": ...}}` envelope) is
 * used instead.
 */
class DataResponse extends Response
{
    public function __construct(
        private readonly array $data = [],
        int $statusCode = 200,
    ) {
        $this->setStatus($statusCode);
    }

    public function getData(): array
    {
        return $this->data;
    }
}
