<?php

declare(strict_types=1);

// The filesystem-event listener, sync-work ledger drain, and tenant mapper
// (architecture.md § ⑨) are added by later milestones (M5.2-M5.4). The OCS
// file-serving endpoint (M5.8) resolves fileId -> byte stream via
// getUserFolder($uid)->getById($fileId), authenticated by AppAPI. The
// access-verify OCS endpoint (M6.6) is the batched getByIds thin-A
// delivery-time re-verify db.md § Layer 4 Thin-A requires, called by the
// Doc-Mgr Backend's backend/internal/thina.HTTPGetter.
//
// Page routes (M4.1, frontend.md § Page Routes) all map to the same
// `Page#index` action — Vue Router owns client-side routing from there, so
// every server route just needs to serve the same app-shell template
// regardless of which sub-path a deep link or page refresh hits.
//
// Each entry other than root needs a distinct `postfix`: Nextcloud's route
// name is derived from `name` (+ `postfix` when present), and a *duplicate*
// name silently overwrites the earlier registration rather than erroring —
// confirmed live, 2026-07-27, via `occ router:match`: without `postfix`
// here, only the last route in this array (`/chat`) ever resolved; `/`,
// `/recent`, `/type/{typeName}`, and `/document/{docId}` all 404'd. Mirrors
// the `photos` app's own multi-route-one-controller pattern
// (`apps/photos/appinfo/routes.php`'s `page#index` entries), the reference
// this was diagnosed against — including leaving the root `/` route's name
// as plain `momentum.page.index` (no postfix), since `appinfo/info.xml`'s
// `<navigations>` entry references that exact route name by default and a
// `postfix` here (tried first) silently breaks the "AI Filing" nav link,
// which falls back to the Dashboard app instead of erroring — confirmed
// live, 2026-07-27, via a real browser click.
return [
    'routes' => [
        [
            'name' => 'Page#index',
            'url' => '/',
            'verb' => 'GET',
        ],
        [
            // The AI Filing dashboard (M125.2): the root route now serves the
            // cross-type Documents table, so the dashboard needs its own path.
            'name' => 'Page#index',
            'url' => '/ai-filing',
            'verb' => 'GET',
            'postfix' => 'aiFiling',
        ],
        [
            'name' => 'Page#index',
            'url' => '/type/{typeName}',
            'verb' => 'GET',
            'postfix' => 'byType',
        ],
        [
            'name' => 'Page#index',
            'url' => '/recent',
            'verb' => 'GET',
            'postfix' => 'recent',
        ],
        [
            'name' => 'Page#index',
            'url' => '/document/{docId}',
            'verb' => 'GET',
            'postfix' => 'document',
        ],
        [
            // Files & Shares bridge (frontend.md § Navigation and routes,
            // M123.2). Same one-action-per-page-route pattern as the rest;
            // the `browse` postfix is mandatory for the reason documented in
            // this file's header — a duplicate route *name* silently
            // overwrites the earlier registration instead of erroring.
            'name' => 'Page#index',
            'url' => '/browse/{viewId}',
            'verb' => 'GET',
            'postfix' => 'browse',
        ],
        [
            'name' => 'Page#index',
            'url' => '/chat',
            'verb' => 'GET',
            'postfix' => 'chat',
        ],
        [
            'name' => 'ApiProxy#getDocument',
            'url' => '/api/documents/{id}',
            'verb' => 'GET',
        ],
        [
            // Listed BEFORE the {id} routes so `by-file` is matched as the
            // literal segment it is rather than as a document id (M127.2).
            'name' => 'ApiProxy#getDocumentByFile',
            'url' => '/api/documents/by-file/{fileId}',
            'verb' => 'GET',
        ],
        [
            'name' => 'ApiProxy#patchDocument',
            'url' => '/api/documents/{id}',
            'verb' => 'PATCH',
        ],
        [
            'name' => 'DocumentTypes#list',
            'url' => '/api/document-types',
            'verb' => 'GET',
        ],
        [
            'name' => 'ApiProxy#getDocumentTypeSchema',
            'url' => '/api/document-types/{typeName}/schema',
            'verb' => 'GET',
        ],
        [
            'name' => 'ApiProxy#searchDocuments',
            'url' => '/api/search/documents',
            'verb' => 'GET',
        ],
        [
            'name' => 'ApiProxy#getStatsOverview',
            'url' => '/api/stats/overview',
            'verb' => 'GET',
        ],
        [
            'name' => 'ApiProxy#patchDocumentFields',
            'url' => '/api/documents/{id}/fields',
            'verb' => 'PATCH',
        ],
        [
            'name' => 'ApiProxy#reprocessDocument',
            'url' => '/api/documents/{id}/reprocess',
            'verb' => 'POST',
        ],
    ],
    'ocs' => [
        [
            'name' => 'File#show',
            'url' => '/api/v1/files/{fileId}',
            'verb' => 'GET',
            'requirements' => ['fileId' => '\d+'],
        ],
        [
            'name' => 'Access#verify',
            'url' => '/api/v1/access/verify',
            'verb' => 'POST',
        ],
    ],
];
