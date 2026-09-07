<?php

declare(strict_types=1);

namespace OCP\Http\Client;

/**
 * Dev-only stub of the exact OCP\Http\Client surface HttpEventDeliveryClient
 * uses (composer.json "autoload-dev") — the real Nextcloud-provided
 * implementation is used at runtime.
 */
interface IClient
{
    /**
     * @param array<string, mixed> $options
     *
     * @throws \Exception on a transport-level failure (DNS, connection refused, timeout)
     */
    public function post(string $uri, array $options = []): IResponse;

    /**
     * Generic verb dispatch — used by {@see \OCA\Momentum\Service\ApiProxy\ApiProxyService}
     * to forward an arbitrary HTTP method rather than a fixed one.
     *
     * @param array<string, mixed> $options
     *
     * @throws \Exception on a transport-level failure (DNS, connection refused, timeout)
     */
    public function request(string $method, string $uri, array $options = []): IResponse;
}
