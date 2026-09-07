<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\AppInfo;

use PHPUnit\Framework\TestCase;

final class RoutesTest extends TestCase
{
    public function testRoutesFileReturnsARoutesArray(): void
    {
        $routes = require __DIR__ . '/../../../appinfo/routes.php';

        self::assertIsArray($routes);
        self::assertArrayHasKey('routes', $routes);
        self::assertIsArray($routes['routes']);
    }

    /**
     * frontend.md § Page Routes: every page is a Vue-Router client route
     * mounted by the same `Page#index` server action, so refreshes and
     * deep links land on the app shell instead of a 404.
     *
     * @return list<array{0: string, 1: string}>
     */
    public static function pageRouteProvider(): array
    {
        return [
            ['Page#index', '/'],
            ['Page#index', '/type/{typeName}'],
            ['Page#index', '/recent'],
            ['Page#index', '/document/{docId}'],
            ['Page#index', '/chat'],
            ['Page#index', '/browse/{viewId}'],
            ['Page#index', '/ai-filing'],
        ];
    }

    /**
     * @dataProvider pageRouteProvider
     */
    public function testRegistersEveryVueRouterPageRoute(string $name, string $url): void
    {
        $routes = require __DIR__ . '/../../../appinfo/routes.php';

        $matches = array_values(array_filter(
            $routes['routes'],
            static fn (array $route): bool => $route['name'] === $name && $route['url'] === $url,
        ));

        self::assertCount(1, $matches, "expected exactly one route named '$name' at '$url'");
        self::assertSame('GET', $matches[0]['verb']);
    }

    public function testRegistersExactlySevenPageRoutesPlusTheProxyRoutes(): void
    {
        $routes = require __DIR__ . '/../../../appinfo/routes.php';

        $pageRoutes = array_values(array_filter(
            $routes['routes'],
            static fn (array $route): bool => $route['name'] === 'Page#index',
        ));

        // Seven since M125.2 gave the AI Filing dashboard its own path
        // (`/ai-filing`) so the root could serve the Documents table. Counted
        // rather than merely listed so an accidentally duplicated route — which
        // Nextcloud resolves by SILENTLY overwriting the earlier registration
        // of the same name, see appinfo/routes.php's header — is caught here.
        self::assertCount(7, $pageRoutes);
        // 16 total since M127.2 added the by-file document proxy route.
        self::assertCount(16, $routes['routes']);
    }

    /**
     * M20.4, `specs/api.md` § `GET /documents/{id}` — the first
     * `/apps/momentum/api/*` proxy route (backlog/v1.md M20.1-M20.9).
     */
    public function testRegistersTheGetDocumentProxyRoute(): void
    {
        $routes = require __DIR__ . '/../../../appinfo/routes.php';

        $matches = array_values(array_filter(
            $routes['routes'],
            static fn (array $route): bool => $route['name'] === 'ApiProxy#getDocument',
        ));

        self::assertCount(1, $matches);
        self::assertSame('/api/documents/{id}', $matches[0]['url']);
        self::assertSame('GET', $matches[0]['verb']);
    }

    /**
     * M20.5, `specs/api.md` § `PATCH /documents/{id}` — same URL as the
     * M20.4 GET route but a distinct action name, so (unlike the
     * `Page#index` entries) no `postfix` is needed to keep the derived
     * route names unique.
     */
    public function testRegistersThePatchDocumentProxyRoute(): void
    {
        $routes = require __DIR__ . '/../../../appinfo/routes.php';

        $matches = array_values(array_filter(
            $routes['routes'],
            static fn (array $route): bool => $route['name'] === 'ApiProxy#patchDocument',
        ));

        self::assertCount(1, $matches);
        self::assertSame('/api/documents/{id}', $matches[0]['url']);
        self::assertSame('PATCH', $matches[0]['verb']);
    }

    public function testRegistersTheDocumentTypesProxyRoute(): void
    {
        $routes = require __DIR__ . '/../../../appinfo/routes.php';

        $matches = array_values(array_filter(
            $routes['routes'],
            static fn (array $route): bool => $route['name'] === 'DocumentTypes#list',
        ));

        self::assertCount(1, $matches);
        self::assertSame('/api/document-types', $matches[0]['url']);
        self::assertSame('GET', $matches[0]['verb']);
    }

    /**
     * M20.3, `specs/api.md` § `GET /document-types/{type_name}/schema`.
     */
    public function testRegistersTheGetDocumentTypeSchemaProxyRoute(): void
    {
        $routes = require __DIR__ . '/../../../appinfo/routes.php';

        $matches = array_values(array_filter(
            $routes['routes'],
            static fn (array $route): bool => $route['name'] === 'ApiProxy#getDocumentTypeSchema',
        ));

        self::assertCount(1, $matches);
        self::assertSame('/api/document-types/{typeName}/schema', $matches[0]['url']);
        self::assertSame('GET', $matches[0]['verb']);
    }

    /**
     * M20.8, `specs/api.md` § `GET /search/documents`.
     */
    public function testRegistersTheSearchDocumentsProxyRoute(): void
    {
        $routes = require __DIR__ . '/../../../appinfo/routes.php';

        $matches = array_values(array_filter(
            $routes['routes'],
            static fn (array $route): bool => $route['name'] === 'ApiProxy#searchDocuments',
        ));

        self::assertCount(1, $matches);
        self::assertSame('/api/search/documents', $matches[0]['url']);
        self::assertSame('GET', $matches[0]['verb']);
    }

    /**
     * M20.9, `specs/api.md` § `GET /stats/overview`.
     */
    public function testRegistersTheGetStatsOverviewProxyRoute(): void
    {
        $routes = require __DIR__ . '/../../../appinfo/routes.php';

        $matches = array_values(array_filter(
            $routes['routes'],
            static fn (array $route): bool => $route['name'] === 'ApiProxy#getStatsOverview',
        ));

        self::assertCount(1, $matches);
        self::assertSame('/api/stats/overview', $matches[0]['url']);
        self::assertSame('GET', $matches[0]['verb']);
    }

    /**
     * M20.6, `specs/api.md` § `PATCH /documents/{id}/fields`.
     */
    public function testRegistersThePatchDocumentFieldsProxyRoute(): void
    {
        $routes = require __DIR__ . '/../../../appinfo/routes.php';

        $matches = array_values(array_filter(
            $routes['routes'],
            static fn (array $route): bool => $route['name'] === 'ApiProxy#patchDocumentFields',
        ));

        self::assertCount(1, $matches);
        self::assertSame('/api/documents/{id}/fields', $matches[0]['url']);
        self::assertSame('PATCH', $matches[0]['verb']);
    }

    /**
     * M20.7, `specs/api.md` § `POST /documents/{id}/reprocess`.
     */
    public function testRegistersTheReprocessDocumentProxyRoute(): void
    {
        $routes = require __DIR__ . '/../../../appinfo/routes.php';

        $matches = array_values(array_filter(
            $routes['routes'],
            static fn (array $route): bool => $route['name'] === 'ApiProxy#reprocessDocument',
        ));

        self::assertCount(1, $matches);
        self::assertSame('/api/documents/{id}/reprocess', $matches[0]['url']);
        self::assertSame('POST', $matches[0]['verb']);
    }

    public function testRegistersTheFileServingOcsRoute(): void
    {
        $routes = require __DIR__ . '/../../../appinfo/routes.php';

        self::assertArrayHasKey('ocs', $routes);
        self::assertIsArray($routes['ocs']);
        self::assertCount(2, $routes['ocs']);

        $route = $routes['ocs'][0];

        self::assertSame('File#show', $route['name']);
        self::assertSame('/api/v1/files/{fileId}', $route['url']);
        self::assertSame('GET', $route['verb']);
        self::assertSame(['fileId' => '\d+'], $route['requirements']);
    }

    public function testRegistersTheAccessVerifyOcsRoute(): void
    {
        $routes = require __DIR__ . '/../../../appinfo/routes.php';

        $route = $routes['ocs'][1];

        self::assertSame('Access#verify', $route['name']);
        self::assertSame('/api/v1/access/verify', $route['url']);
        self::assertSame('POST', $route['verb']);
    }
}
