<?php

declare(strict_types=1);

namespace OCP;

/**
 * Test-only stub reproducing the slice of \OCP\IRequest this app's
 * controllers depend on. Route/query parameters are bound to controller
 * method arguments by AppFramework before the controller runs, so the only
 * things read from the request directly are the raw query string and the raw
 * body — the API proxy (M20.5+) forwards write-endpoint bodies byte-for-byte
 * rather than re-encoding the parsed parameters. Never shipped to
 * production — see glue-app/composer.json "autoload-dev" (OCP\ is not in
 * "autoload"). At runtime inside Nextcloud, the real server-provided request
 * is used.
 *
 * `getServerParams()` is read directly by
 * `ApiProxyController::searchDocuments()` (M20.8): AppFramework's route/query
 * parameter binding parses the query string into `$_GET`, which silently
 * collapses repeated keys (e.g. `f=a&f=b`) to the last value, so the only
 * way to forward api.md's `GET /search/documents` query string (repeated `f`
 * filter params) to the backend byte-for-byte unchanged is to read the raw
 * `QUERY_STRING` off the server params instead of any parsed representation.
 */
interface IRequest
{
    /**
     * @return array<string, mixed>
     */
    public function getServerParams(): array;

    /**
     * Mirrors the real method's signature: a string for
     * `application/json` / form-encoded bodies, a stream resource
     * otherwise.
     *
     * @return string|resource
     */
    public function getContent();

    /**
     * Returns '' when the header is absent — used by {@see
     * \OCA\Momentum\Controller\FileController::show()} (backlog/to_change.md
     * § G55 item 3) to assert ExApp identity in-controller rather than
     * relying solely on `AppAPIAuthMiddleware` having run.
     */
    public function getHeader(string $name): string;
}
