// Stands in for the pieces of the Nextcloud host page the app's real entry
// (`../src/main.ts`, unmodified — imported by `./main.ts` right after this
// module) reads at import time: `@nextcloud/router`'s `generateUrl` reads
// `window._oc_webroot`/`window.OC.config.modRewriteWorking`, `@nextcloud/auth`'s
// `getCurrentUser`/`getRequestToken` read `<head data-user>`/
// `<head data-requesttoken>` (see index.html), and `@nextcloud/vue` reads the
// `appName`/`appVersion` globals `vite.mock.config.ts` supplies via `define` —
// the same one production's own `vite.config.ts` sets. See README.md for the
// full inventory this was built against.
//
// Must run (and this module must finish evaluating) before `../src/main` is
// imported — `mock/main.ts` enforces the order; do not import this lazily.

import { File, Folder, View, getNavigation } from '@nextcloud/files'
import { DOCUMENTS, type MockDocument } from './fixtures'

export {}

declare global {
  interface Window {
    OC?: { config?: { modRewriteWorking?: boolean } }
    _oc_webroot?: string
    OCA?: { Viewer?: MockViewer }
  }
}

window._oc_webroot = ''
window.OC = { config: { modRewriteWorking: true } }

// `getCurrentUser()`/`getRequestToken()` (@nextcloud/auth) read these two
// head attributes directly — no fetch, no OC.* global (see node_modules'
// dist/index.mjs, checked live: both are synchronous DOM reads).
document.head.dataset.user = 'mock-user'
document.head.dataset.userDisplayname = 'Mock User'
document.head.dataset.requesttoken = 'mock-request-token'

// --- Mock native "files" (All files) View ----------------------------------
//
// `FileBrowserPage.vue`'s `/apps/momentum/browse/files` route (the app's own
// window onto Nextcloud's native file views) reads this exact view through
// `ncFilesBridge()` -> `getNavigation()` (`services/ncFilesBridge.ts`'s own
// header comment: "core's `files-init`... bundles register their views...
// into the shared, version-scoped registry"). On a real instance core
// registers it; this harness has no core bundle to load, so nothing ever
// would without this — the page would only ever show its "This location is
// not available" empty state (`ncFilesBridge.ts`'s `UnknownViewError`).
//
// Registered with the REAL `File`/`Folder`/`View` classes from
// `@nextcloud/files` — the same ones `files-entry.ts` builds
// `momentumFilesView.ts`'s nodes with — so `ncFilesBridge.ts`'s real
// `toBridgeNode()`/`sortNodes()`/`Node.path`/`Node.basename` getters all run
// unmodified against it, not a shape hand-typed to satisfy this mock. Flat on
// purpose: all six seeded `DOCUMENTS` sit directly at the view's root, so
// opening `/apps/momentum/browse/files` shows them with no folder to click
// through first — this harness has no directory tree worth modeling, only
// documents to open. Each node's `fileid` is its `MockDocument.file_id`,
// which `server.ts`'s `GET /documents/by-file/:id` resolves back to a
// document, exactly the lookup a row click does for real.
const MOCK_UID = 'mock-user'
const DAV_ROOT_URL = `${window.location.protocol}//${window.location.host}/remote.php/dav/files/${MOCK_UID}`
const DAV_ROOT = `/files/${MOCK_UID}`

// Raw path segments, NOT pre-percent-encoded: `Node.basename`
// (`@nextcloud/paths`' `basename()`) is a plain string split on `source` with
// no decoding step, so a pre-encoded source here would display as literal
// "%20"s in the file list. `Node.path`'s own getter handles the encode/decode
// round-trip itself when it needs a real `URL` — this mirrors
// `momentumFilesView.ts`'s `toFileNode`, which passes raw paths for the same
// reason (confirmed live there, 2026-07-28, per that file's own comment on
// `toHomeRelativePath`). The browser still percent-encodes the request line
// when a fetch actually goes out, so `server.ts`'s DAV handler is unaffected.
function mockFileNode(doc: MockDocument): InstanceType<typeof File> {
  const filename = doc.path.split('/').pop() ?? doc.path
  return new File({
    id: doc.file_id,
    source: `${DAV_ROOT_URL}/Momentum Demo/${filename}`,
    root: DAV_ROOT,
    owner: MOCK_UID,
    mtime: new Date(doc.updated_at),
    mime: doc.mime_type,
    permissions: 1,
  })
}

const ROOT_FOLDER_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
  '<path fill="currentColor" d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8Z"/></svg>'

getNavigation().register(
  new View({
    id: 'files',
    name: 'All files',
    icon: ROOT_FOLDER_ICON,
    order: 0,
    getContents: async (path: string) => {
      const folder = new Folder({ id: 0, source: DAV_ROOT_URL, root: DAV_ROOT, owner: MOCK_UID, permissions: 1 })
      // No subdirectories in this mock (see comment above) — any path other
      // than root reads as empty rather than 404ing, matching a real view's
      // "this folder is empty" state for a directory that doesn't exist.
      return { folder, contents: (path || '/') === '/' ? DOCUMENTS.map(mockFileNode) : [] }
    },
  }),
)

// --- Minimal `window.OCA.Viewer` stub --------------------------------------
//
// DocumentViewerPage.vue's `getNcViewer()` reads this exact surface
// (`NcViewerService`); with it absent the page already degrades gracefully to
// its "Preview unavailable" state (M33.12) — which is a legitimate way to run
// this harness. This stub exists only so the split view shows an actual
// rendered file by default: it renders images/PDF/text directly via
// `<img>`/`<iframe>`/`<pre>` rather than reimplementing the real `viewer`
// app's zoom/paging chrome, which is out of scope for a frontend-fixture
// harness (see README.md's "Not covered" section).
interface MockViewer {
  setRootElement(selector: string): void
  open(options: { path: string } | { fileInfo: { filename: string } & Record<string, unknown> }): void
  close(): void
}

function buildViewer(): MockViewer {
  let rootSelector: string | undefined
  let mounted: HTMLElement | undefined

  function render(path: string): void {
    const root = rootSelector ? document.querySelector<HTMLElement>(rootSelector) : undefined
    if (!root) return
    root.replaceChildren()
    // `davRootUrl` in DocumentViewerPage.vue is
    // `generateRemoteUrl('dav/files/<uid>')`, i.e. `/remote.php/dav/files/mock-user`
    // (see host.ts's `data-user`) — reconstructed the same way here since this
    // stub only receives the home-relative `path`.
    const url = `/remote.php/dav/files/mock-user${path}`
    const ext = path.split('.').pop()?.toLowerCase()
    let el: HTMLElement
    if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'svg') {
      const img = document.createElement('img')
      img.src = url
      img.style.maxWidth = '100%'
      img.style.maxHeight = '100%'
      img.style.objectFit = 'contain'
      el = img
    } else if (ext === 'txt' || ext === 'md' || ext === 'csv') {
      el = document.createElement('pre')
      el.style.whiteSpace = 'pre-wrap'
      el.style.padding = 'var(--default-grid-baseline, 16px)'
      fetch(url)
        .then((response) => response.text())
        .then((text) => {
          el.textContent = text
        })
    } else {
      const iframe = document.createElement('iframe')
      iframe.src = url
      iframe.style.width = '100%'
      iframe.style.height = '100%'
      iframe.style.border = 'none'
      el = iframe
    }
    el.style.width = '100%'
    el.style.height = '100%'
    root.appendChild(el)
    mounted = el
  }

  return {
    setRootElement(selector) {
      rootSelector = selector
    },
    open(options) {
      const path = 'path' in options ? options.path : options.fileInfo.filename
      render(path)
    },
    close() {
      mounted?.remove()
      mounted = undefined
    },
  }
}

window.OCA = { ...window.OCA, Viewer: buildViewer() }
