// The one place the Files & Shares bridge (frontend.md § Files & Shares
// Bridge; M123.1) is wired to the real Nextcloud packages — the counterpart of
// `files-entry.ts` for `momentumFilesView.ts`. Kept this thin on purpose:
// `ncFilesBridge.ts` stays unit-testable with fakes because every real import
// lives here.
import { getCurrentUser } from '@nextcloud/auth'
import axios from '@nextcloud/axios'
import {
  getFileActions,
  getFileListActions,
  getFileListFilters,
  getNavigation,
  getNewFileMenuEntries,
  getSidebar,
  sortNodes,
} from '@nextcloud/files'
import { t } from '@nextcloud/l10n'
import { generateRemoteUrl } from '@nextcloud/router'
import { createBridge } from './ncFilesBridge'
import { UploadConflictError } from './ncFilesBridge'
import type {
  Bridge,
  BridgeDeps,
  RawAction,
  RawFilter,
  RawListAction,
  RawNewMenuEntry,
  RawSidebar,
  RawView,
  UploadableFile,
} from './ncFilesBridge'

let bridge: Bridge | undefined

// Uploads via a single authenticated PUT against the user's DAV root. axios
// here is `@nextcloud/axios`, which attaches Nextcloud's request token — a
// plain `fetch` would be rejected. `If-None-Match: *` is the WebDAV way to say
// "only if it does not exist yet": the server answers 412 instead of replacing
// the file, which becomes UploadConflictError rather than a silent overwrite.
async function putFile(directory: string, file: UploadableFile, signal?: AbortSignal): Promise<void> {
  const uid = getCurrentUser()?.uid ?? ''
  const root = generateRemoteUrl(`dav/files/${encodeURIComponent(uid)}`)
  // Per-segment encoding: encoding the whole path would escape the separators
  // (the same trap `services/viewerFileInfo.ts` documents for PROPFIND paths).
  const segments = [...directory.split('/').filter(Boolean), file.name].map((segment) =>
    encodeURIComponent(segment),
  )
  try {
    await axios.put(`${root}/${segments.join('/')}`, await file.arrayBuffer(), {
      headers: { 'Content-Type': 'application/octet-stream', 'If-None-Match': '*' },
      signal,
    })
  } catch (error) {
    const status = (error as { response?: { status?: number } })?.response?.status
    if (status === 412 || status === 405) throw new UploadConflictError(`${directory}/${file.name}`)
    throw error
  }
}

// The narrower `Raw*` shapes declare only the fields the bridge reads; the real
// `IView`/`IFileAction` carry ~20 more, and TS cannot verify structural
// assignability through them in both directions — hence the casts at this one
// boundary, exactly as files-entry.ts does for `MomentumViewDeps`.
function deps(): BridgeDeps {
  const navigation = getNavigation()
  return {
    // `views`/`addEventListener`/`removeEventListener` live on `Navigation`'s
    // prototype, so a spread copy would silently drop them — bind explicitly.
    navigation: {
      get views() {
        return navigation.views as unknown as BridgeDeps['navigation']['views']
      },
      addEventListener: (type, listener) => navigation.addEventListener(type, listener),
      removeEventListener: (type, listener) => navigation.removeEventListener(type, listener),
      setActive: (id) => navigation.setActive(id),
    },
    getFileActions: () => getFileActions() as unknown as RawAction[],
    putFile,
    // Core's toolbar registries (frontend.md § Files-app parity). Same
    // narrower-Raw-shape casts as `getFileActions` above, at this one boundary.
    getNewMenuEntries: (folder) =>
      getNewFileMenuEntries(folder as Parameters<typeof getNewFileMenuEntries>[0]) as unknown as RawNewMenuEntry[],
    getListActions: () => getFileListActions() as unknown as RawListAction[],
    getFilters: () => getFileListFilters() as unknown as RawFilter[],
    sortNodes: (nodes, options) =>
      sortNodes(
        nodes as Parameters<typeof sortNodes>[0],
        options as Parameters<typeof sortNodes>[1],
      ) as unknown[],
    getSidebar: () => getSidebar() as unknown as RawSidebar,
    t,
  }
}

/**
 * The process-wide bridge instance. Created on first use rather than at module
 * load: the registry it reads is populated by scripts the SERVER adds
 * (`Util::addInitScript('files', 'init')` and the apps responding to
 * `LoadAdditionalScriptsEvent`), and their load order relative to this bundle
 * is not guaranteed. `createBridge` holds the live `Navigation` object, not a
 * snapshot of `views`, so a later registration is picked up — and callers can
 * subscribe via `onViewsChanged`.
 */
export function ncFilesBridge(): Bridge {
  bridge ??= createBridge(deps())
  return bridge
}

// Test seam: lets a unit test install a fake bridge for components that reach
// for the real one, and reset between cases.
export function setNcFilesBridgeForTesting(replacement: Bridge | undefined): void {
  bridge = replacement
}

export type { Bridge, RawView }
