// DEV-ONLY, NOT FOR PRODUCTION. Registers the same 'files' View that
// mock/host.ts registers for the standalone `npm run mock` harness, but
// against the REAL Nextcloud page (real chrome, real login, real
// src/main.ts production bundle) instead of the mock's own index.html.
//
// Requested 2026-09-03 (jgil@arsys.es): see the real NC page's
// /apps/momentum/browse/files route show the mock's fixture documents,
// with /apps/momentum/api/* proxied to the `npm run mock` Vite server
// (see /etc/apache2/conf-available/momentum-mock-proxy.conf in the
// devcontainer). @nextcloud/files' getNavigation() is backed by a
// window._nc_files_scope.v4_0 global shared across separately-bundled
// scripts on the same page (see that package's dist/chunks/folder-*.mjs),
// so this can be a wholly separate IIFE from momentum-main.js and still
// register into the same registry FileBrowserPage.vue reads from.
//
// WebDAV is NOT mocked here (only the mock Vite server's own DAV_PREFIX,
// scoped to a fake 'mock-user', handles that) — so a row's actual file
// bytes won't resolve; DocumentViewerPage's preview pane will show its
// normal "Preview unavailable" fallback. Listing/click-through to the
// Document Viewer (via GET /api/documents/by-file/{fileId}, which IS
// proxied) works.
import { File, Folder, View, getNavigation } from '@nextcloud/files'
import { getCurrentUser } from '@nextcloud/auth'
import { DOCUMENTS, type MockDocument } from './fixtures'

// Contrary to mock/host.ts's assumption (core's files-init bundle only
// loads on the Files app's own page), this real nc-server instance loads
// dist/files-init.js — and therefore registers a real 'files' View — on
// EVERY authenticated page, Momentum's included (confirmed live,
// 2026-09-03, via the browser network log and a duplicate-id
// "IView id files is already registered" thrown from register()). Evict
// the real view first so ours can take its place.
getNavigation().remove('files')

const uid = getCurrentUser()?.uid ?? 'admin'
const DAV_ROOT_URL = `${window.location.protocol}//${window.location.host}/remote.php/dav/files/${uid}`
const DAV_ROOT = `/files/${uid}`

function mockFileNode(doc: MockDocument): InstanceType<typeof File> {
  const filename = doc.path.split('/').pop() ?? doc.path
  return new File({
    id: doc.file_id,
    source: `${DAV_ROOT_URL}/Momentum Demo/${filename}`,
    root: DAV_ROOT,
    owner: uid,
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
      const folder = new Folder({ id: 0, source: DAV_ROOT_URL, root: DAV_ROOT, owner: uid, permissions: 1 })
      return { folder, contents: (path || '/') === '/' ? DOCUMENTS.map(mockFileNode) : [] }
    },
  }),
)
