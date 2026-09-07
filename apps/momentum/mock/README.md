# Mock frontend harness

Lets you run the Momentum Vue app shell — the Documents table and the
Document Viewer with its extracted-fields panel — with **no Nextcloud
instance, no Doc-Mgr backend, and no `helm install`**. Useful for
frontend-only work (HiDrive Next / UI fixes) where a real deployed stack
isn't available or isn't worth spinning up.

## Run it

```sh
cd glue-app
npm ci    # if you haven't already
npm run mock
```

Open the URL Vite prints (`http://localhost:5173/` by default, or the next
free port if that one's taken). You'll land on the Documents
table with six seeded documents across three document types
(`commercial_invoice`, `finance_bank_statement`, `finance_expense`) and every
pipeline status (`done`, `processing`, `needs_ocr`, `failed`) — click a row to
open the Document Viewer, with its split preview pane and the extracted
fields on the right.

That page (`index.html`) is the app's own shell. Its nav has a "Documents"
entry (the app's own cross-type table above) — **for the app's own
`/apps/momentum/browse/files` "All Files" page** (`FileBrowserPage.vue`,
mirroring Nextcloud's native file views inside this app), see `host.ts`'s
"Mock native `files` View" below; it lists the same six seeded documents
directly (no folder to click through), and clicking a row opens the Document
Viewer exactly as it does from the Documents table.

There's a SECOND, unrelated "All Files" surface: the "AI Filing"/"Recent
Documents"/"Ask Filo" entries the app adds to Nextcloud's own Files-app
sidebar (a different bundle, `files-entry.ts`) — open `/files.html` for that
one (linked from the banner at the bottom of either mock page). See
"Files-app view" below for why it's a separate mock page.

## What this is

`../src/main.ts` — the real, unmodified app entry point production builds —
is loaded as-is. Nothing in `../src/**` is mocked or forked; if a page here
looks different from what it'll look like in the real app, that's either a
real bug or a gap in this harness (see "Not covered" below), never a
mock-only code path diverging from production.

Four pieces make that possible without a real Nextcloud host:

* **`host.ts`** — sets the handful of `window`/`document` globals
  `@nextcloud/auth` and `@nextcloud/router` read synchronously at import time
  (`data-user`/`data-requesttoken` on `<head>`, `window._oc_webroot`,
  `window.OC.config.modRewriteWorking`), plus a minimal `window.OCA.Viewer`
  stub so the preview pane renders *something* (a plain `<img>`/`<iframe>`/
  `<pre>`, not the real `viewer` app's zoom/paging chrome).
* **`nc-theme.css`** — the Nextcloud CSS custom properties (`--color-*`,
  `--border-radius*`, etc.) `@nextcloud/vue` components style themselves
  from. Linked from both `index.html` and `files.html`. Without it the app is
  not "slightly off," it's totally white and unstyled: almost none of
  `@nextcloud/vue`'s bundled CSS has a fallback value for the tokens it uses,
  and a real instance's server generates them at runtime — there is no
  npm-installable copy anywhere. See the file's own header comment for
  exactly which tokens are covered, which two categories were deliberately
  left out (and why), and the caveat that these are a best-effort
  approximation of Nextcloud's real defaults, not a pixel-exact match to any
  specific deployment's theme.
* **`server.ts`** — a Vite dev-server middleware (wired up by
  `../vite.mock.config.ts`) standing in for the Glue App's PHP-proxied
  `/apps/momentum/api/*` routes and Nextcloud's WebDAV endpoint. Holds
  mutable in-memory state, so editing a field, marking a document reviewed,
  or clicking Reprocess persists for the rest of the `npm run mock` session
  (reset on restart).
* **`fixtures.ts` / `files.ts`** — the seeded documents/types/schemas and the
  tiny PDF/text/PNG byte payloads `server.ts` serves back over the mocked
  WebDAV endpoint for preview/download.

## Mock native `files` View (`/apps/momentum/browse/files`)

`FileBrowserPage.vue` never talks to `@nextcloud/files` directly — it goes
through `ncFilesBridge()` (`services/ncFilesBridgeRuntime.ts`), which reads
`getNavigation().views` for a view whose `id` matches the route's `:viewId`
(`services/ncFilesBridge.ts`'s own header comment explains why: core's
`files-init`/`files_sharing-init`/etc. bundles are what normally register
`'files'`/`'personal-files'`/the six sharing views/etc. into that registry on
a real instance — this app just reads it). None of those core bundles exist
in this harness, so without help the page only ever shows its "This location
is not available" empty state.

`host.ts` registers a `'files'` View itself — using the same real
`File`/`Folder`/`View` classes from `@nextcloud/files` that `files-entry.ts`
builds `momentumFilesView.ts`'s nodes with — with all six seeded `DOCUMENTS`
listed flat at the view's root (no folder to click through: this harness has
no directory tree worth modeling, only documents to open). `ncFilesBridge.ts`'s
real `toBridgeNode()`/`sortNodes()` logic all run unmodified against those
real nodes, not a shape hand-typed to satisfy this mock. Each `File` node's
`fileid` is its `MockDocument.file_id`, and `server.ts`'s
`GET /documents/by-file/:fileId` resolves it back to a document exactly the
way the real Go backend would — so opening a row here goes through the same
`fetchDocumentByFileId` -> Document Viewer path production does, not a
shortcut.

Node sources are built from RAW (not percent-encoded) path segments — same
convention `momentumFilesView.ts`'s `toFileNode` uses — because
`Node.basename` (`@nextcloud/paths`' `basename()`) does a plain string split
on `source` with no decode step; a pre-encoded source there displays as a
literal `%20` instead of a space. `Node.path`'s own getter does its own
encode/decode round-trip when it needs a real `URL`, and the browser
percent-encodes the request line regardless when a fetch actually goes out,
so `server.ts`'s DAV handler sees the same thing either way.

## Files-app view (`files.html` / `files-main.ts`)

`../src/files-entry.ts` — again the real, unmodified bundle
(`vite.config.ts`'s `VITE_BUILD_TARGET=files` build target) — only ever runs
on a real Nextcloud Files page (`LoadAdditionalScriptsListener.php` injects
it there); `index.html`'s app shell never loads it. `files.html` is a second
mock page standing in for that Files page: `files-main.ts` imports
`files-entry.ts` as-is (registering the real "Recent Documents"/"AI
Filing"/per-type/"Ask Filo" views into `@nextcloud/files`' navigation
registry, exactly like production), then renders a plain sidebar + table from
that registry — a deliberately minimal stand-in for the real Files app's own
UI (breadcrumbs, drag-drop, its own file actions), which is Nextcloud core
and out of scope here. Clicking a row navigates to that document's real
`/apps/momentum/document/:docId` route, landing back on `index.html`'s app
shell (Vite's dev-server SPA fallback serves it for any path that isn't a
static file, the same mechanism `createWebHistory` needs in production).

"Ask Filo" renders its real `emptyView`, which mounts a live iframe pointed
at `https://gpt.ionos.com` (`../src/embed/ionosGptEmbed.ts`) — that's the
genuine external IonosGPT embed, not a fixture, so expect it to refuse to
embed or 404 outside a real IonosGPT-connected deployment.

## Not covered

* **Only the `'files'` native view is mocked**, not the others core normally
  registers (`'personal-files'`, `'sharingin'`/`'sharingout'`/etc., trash,
  favorites) — `/apps/momentum/browse/<anything else>` still shows "This
  location is not available". Add another `getNavigation().register(...)`
  call in `host.ts` if one of those is needed.
* **Flat, no directories.** The mock `'files'` View has no folders at all —
  every seeded document sits at its root, and there's no create-folder/
  nested-directory support. Uploading via the page's "Upload files" button
  will also fail (`server.ts`'s mock WebDAV handler doesn't implement `PUT`).
* **Core's own file actions/list actions/filters/New-menu entries** (rename,
  delete, move, "Empty deleted files", the Type/Modified/People filter chips,
  etc.) — all come from registries (`getFileActions()` and friends) that only
  core's own bundles populate; `bridge.actionsFor()`/`listActionsFor()`/
  `filters()`/`newMenuEntries()` all read as empty here, so the row-actions
  menu, filters bar, and non-upload "New" entries are empty in this harness.
* **The real Files app's own UI.** `files.html`'s sidebar/table replaces it,
  not reimplements it — no breadcrumbs, drag-drop, uploads, or the file
  actions core/other NC apps contribute.
* **Real file rendering.** The mock `OCA.Viewer` in `host.ts` is a plain
  `<img>`/`<iframe>`/`<pre>`, not the real `viewer` app — no zoom, no paging,
  no Office/Collabora embedding. Good enough to confirm the split-view layout
  and that a file renders at all; not a preview-fidelity tool.
* **Exact visual theming.** `nc-theme.css` approximates Nextcloud's real
  default light theme closely enough to make the app look and lay out like
  Nextcloud — it is not a pixel-exact match to any specific real instance's
  admin-configured theme (custom primary color, dark mode, etc. aren't
  modeled), and it covers only the tokens this app's own components actually
  use, not the full `@nextcloud/vue` library's.
* **`@nextcloud/notify_push`** — never wired up (correctly: it reads
  `getCapabilities()`, finds none, and no-ops without a network call, the
  same as a real NC instance without the `notify_push` app enabled). Terminal
  status transitions still show up because `DocumentViewerPage`'s own
  poll (`MOMENTUM_CONFIG.DOCUMENT_POLL_INTERVAL_MS`) is the required
  fallback anyway.
* **Search relevance.** `q=` full-text search is a case-insensitive substring
  match over path/type/field values, not `websearch_to_tsquery` ranking.

## Editing the seed data

Add/edit documents in `fixtures.ts` (`DOCUMENTS`) or document types/fields in
`fixtures.ts` (`DOCUMENT_TYPES`) — both are plain data, no schema migration or
seed script involved. `files.ts` holds the byte payloads `server.ts` serves
per `MockDocument.file_key`; add a new key there if a fixture needs a
different file to preview.
