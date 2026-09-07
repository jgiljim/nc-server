<?php

declare(strict_types=1);

namespace OCP\Http\Client;

/**
 * Dev-only stub of the exact OCP\Http\Client surface HttpEventDeliveryClient
 * uses (composer.json "autoload-dev") — the real Nextcloud-provided
 * implementation is used at runtime.
 */
interface IResponse
{
    public function getStatusCode(): int;

    /**
     * @return string|resource
     */
    public function getBody();
}
