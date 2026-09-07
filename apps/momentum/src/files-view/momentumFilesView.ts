// Thin read-only "AI Filing" custom View for the Nextcloud Files app
// (frontend.md § File-Browser View Integration; M4.14). It surfaces Doc-Mgr
// classification labels inside NC Files via `@nextcloud/files`'s
// `Navigation`/`View`, the same mechanism the `systemtags` app uses for its
// "Tags" view. The View is deliberately minimal — no interactive widgets, no
// custom filters, no sort overrides; all editing/review happens in the
// Doc-Mgr app's own pages.
//
// frontend.md's own code sample (`Navigation.register(new View({...}))`,
// `getContents(path, options)` returning `{ contents, cursor,
// serviceUnavailable }`) is illustrative pseudocode, not the real
// `@nextcloud/files` contract — confirmed against the installed
// `@nextcloud/files@3.12.2` type declarations: `Navigation.register` is an
// instance method on the singleton `getNavigation()` returns (not a static),
// and `View.getContents` is `(path: string) => Promise<{ folder: Folder,
// contents: Node[] }>` with no pagination options at all — the real Files
// app fetches a view's contents in one call, it doesn't drive cursor-based
// paging through this interface. `Node`/`File`/`Folder` also require a real
// DAV `source` URL and an `owner` uid, not a bare app-relative path. This
// module targets the real contract; see `files-entry.ts` for how the real
// `@nextcloud/files` exports satisfy `MomentumViewDeps`.
//
// Like the M4.13 IonosGPT embed primitive, this is a pure/injectable module:
// `Navigation`/`View`/`File`/`Folder`, `@nextcloud/axios`, `@nextcloud/router`'s
// `generateUrl`, and `@nextcloud/l10n`'s `t` are all injected via
// `MomentumViewDeps` so the module is unit-testable without the Nextcloud
// runtime packages.

import type { components } from '../../../frontend/src/api/schema'
import type { EmbedContext } from '../embed/ionosGptEmbed'
import { mountIonosGptEmbed } from '../embed/ionosGptEmbed'
import { MOMENTUM_CHAT_ICON } from '../sidebar/momentumAskAiSidebar'

// Reuse the generated request/response shapes (frontend.md § API Bindings
// Summary) rather than hand-writing them.
type SearchItem = components['schemas']['api.searchItemDTO']
type SearchDocumentsResponse = components['schemas']['api.searchDocumentsResponse']
type DocumentTypeDTO = components['schemas']['api.documentTypeDTO']
type ListDocumentTypesResponse = components['schemas']['api.listDocumentTypesResponse']

export const MOMENTUM_APP_ID = 'momentum'
export const AI_FILING_VIEW_ID = 'momentum-ai-filing'
// The other two entries of the app's own navigation tree (frontend.md §
// Navigation Tree Additions), mirrored into the Files sidebar. They cannot be
// links to `/apps/momentum/recent` and `/apps/momentum/chat`: a Files nav item
// always routes to the Files app's own `filelist` route
// (apps/files/src/components/FilesNavigationListItem.vue's `navigationRoute`,
// which resolves to `{name: 'filelist', params: {view: id}}` and, for a view
// carrying `params`, still only to that same route), so each entry has to be a
// real View that renders its content inside the Files app.
export const RECENT_VIEW_ID = 'momentum-recent'
export const ASK_FILO_VIEW_ID = 'momentum-ask-filo'
// `GET /search/documents`' `sort` param (api.md), newest ingest first. This is
// the only thing separating the Recent Documents view from the AI Filing root
// view — both are the same unfiltered cross-type search.
export const RECENT_SORT = 'created_at:desc'
// The real `View.getContents(path)` contract has no pagination options
// (frontend.md's `options.limit`/`cursor` don't exist on it) — this is the
// fixed page size fetched per view/render instead.
export const DEFAULT_PAGE_SIZE = 25

// The Doc-Mgr API is reached through the app's own PHP-proxied routes
// (M4.1 note in backlog/v1.md), never a direct cross-origin call to the Go
// backend.
const API_BASE = '/apps/momentum/api'

// NC Files' `View.icon` contract is an inline SVG *string* (distinct from the
// `@nextcloud/vue` "icons are components" rule, which governs Vue pages, not
// the Files navigation chrome). One place owns the markup.
export const MOMENTUM_VIEW_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
  '<path fill="currentColor" d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m8 1.5V8h4.5z"/>' +
  '</svg>'

// Clock icon for Recent Documents, matching NC Files' own "Recent" entry
// semantics. Same inline-SVG-string contract as MOMENTUM_VIEW_ICON above.
export const RECENT_VIEW_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
  '<path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2m0 18a8 8 0 1 1 8-8' +
  'a8 8 0 0 1-8 8m.5-13h-1.5v6l5.2 3.1.8-1.3-4.5-2.7z"/>' +
  '</svg>'

// Ask Filo reuses the chat icon the Ask AI sidebar tab already owns rather
// than shipping a second copy of the same markup — one place owns each icon
// (CLAUDE.md § Frontend coding rules, "Icons are components, not string
// constants", whose centralization point applies to these inline-SVG chrome
// strings too).
export const ASK_FILO_VIEW_ICON = MOMENTUM_CHAT_ICON

// --- Injected Nextcloud-runtime surface -----------------------------------

// Minimal structural types for the NC constructors/functions we depend on;
// the real classes come from `@nextcloud/files` at runtime (`File`, `Folder`,
// `View`), both of which extend the same abstract `Node` and share its
// `NodeData` constructor shape (id, source, root, owner, mtime, attributes).
// These are deliberately narrower than the real `NodeData`/`IView` types (only
// the fields this module actually sets) so the module stays dependency-free —
// `@nextcloud/files`'s concrete `File`/`Folder`/`View` classes are structurally
// assignable to them (see files-entry.ts).
export interface MomentumFileNode {
  attributes: Record<string, unknown>
}

export interface MomentumNodeData {
  id?: number | string
  source: string
  root: string
  owner: string
  mtime?: Date
  permissions?: number
  attributes?: Record<string, unknown>
}

export type MomentumFileCtor = new (data: MomentumNodeData) => MomentumFileNode

export interface MomentumColumn {
  id: string
  title: string
  render: (node: MomentumFileNode, view?: unknown) => HTMLElement
}

export interface MomentumContentsResult {
  folder: MomentumFileNode
  contents: MomentumFileNode[]
}

export interface MomentumViewData {
  id: string
  name: string
  icon: string
  getContents: (path: string, options?: { signal?: AbortSignal }) => Promise<MomentumContentsResult>
  order?: number
  parent?: string
  columns?: MomentumColumn[]
  // Real `IView.emptyView` contract (`@nextcloud/files@4.0.0`): called with
  // the container element when a view has no contents, for rendering a custom
  // empty state. Core's own `apps/files/src/views/search.ts` uses it; the Ask
  // Filo view uses it as its *only* surface, since a chat panel has no file
  // list to show.
  emptyView?: (div: HTMLDivElement) => void
}

// The slice of the M4.13 embed primitive's handle this module needs.
export interface MomentumEmbedHandle {
  destroy(): void
}

export type MomentumViewCtor = new (config: MomentumViewData) => unknown

export interface MomentumViewDeps {
  // Method-shorthand signature (not an arrow-typed property) so the real
  // `Navigation`'s variadic `register(...views: IView[]): void` — bivariant
  // as a method — is assignable here without a `...views` rest param leaking
  // into every call site.
  Navigation: { register(view: unknown): void }
  View: MomentumViewCtor
  File: MomentumFileCtor
  Folder: MomentumFileCtor
  axios: { get: <T>(url: string, config?: { signal?: AbortSignal }) => Promise<{ data: T }> }
  generateUrl: (path: string) => string
  t: (app: string, text: string) => string
  // The acting NC user's uid and the DAV base URL for their home
  // (`generateRemoteUrl('dav/files/' + uid)`) — every `Node` the real
  // `@nextcloud/files` classes construct needs a real DAV `source` URL and an
  // `owner`, not a bare app-relative path.
  uid: string
  davRootUrl: string
  // Overridable for tests; defaults to the real M4.13 embed primitive — the
  // same optional-dep-with-default shape `momentumAskAiSidebar.ts` uses for
  // it, and for the same reason: `mountIonosGptEmbed` is framework-free, so
  // depending on it directly costs this module nothing.
  mountEmbed?: (container: HTMLElement, context?: EmbedContext) => MomentumEmbedHandle
}

// --- Node + column mapping -------------------------------------------------

const DASH = '—'

// M21.15 investigation finding: `@nextcloud/files`' `Node.permissions` getter
// returns `Permission.NONE` (`0`) whenever `NodeData.permissions` is left
// unset and the node has a real DAV `source`/`owner` (both true here) — see
// `node/node.ts`'s getter, which only special-cases the *ownerless*,
// non-DAV-resource case (returning `Permission.READ` there instead).
// `apps/files/src/actions/sidebarAction.ts`'s `enabled()` check (the
// built-in "Sharing" details action, nextcloud/server) then treats
// `permissions === Permission.NONE` as sidebar-ineligible and refuses to
// register/open the sidebar at all for the node — which is why *no* tab,
// ours (`momentum-ask-ai-tab`) or NC's own built-in "Sharing" tab, ever
// mounts for rows from this View: the sidebar itself never opens. Setting
// `Permission.READ` (`1`) — the minimum bit `sidebarAction.ts` requires —
// makes these read-only Nodes sidebar-openable without granting write
// access this View was never meant to support. Inlined as a numeric
// constant (rather than importing `@nextcloud/files`' `Permission` enum)
// to keep this module dependency-free, per its header comment.
const PERMISSION_READ = 1

// The API's `path` field is Nextcloud's own internal storage path —
// `Node::getPath()`'s `/<uid>/files/<relative-path>` — not a path relative to
// the user's home. Confirmed live, 2026-07-28: a real `GET /documents/{id}`
// returned `path: "/momentum-demo-user/files/Momentum Demo/acme-q1.pdf"`; a
// DAV source built by naively appending that to `davRootUrl` (already
// `.../dav/files/momentum-demo-user`) doubled the uid segment. The leading
// uid segment is always the acting user's own — this is a per-user-filtered
// result — so a generic `/<segment>/files` strip works without needing the
// uid threaded in separately.
function toHomeRelativePath(path: string): string {
  return path.replace(/^\/[^/]+\/files(?=\/|$)/, '') || '/'
}

// Maps one `GET /search/documents` item onto an NC `File` node enriched with
// Doc-Mgr metadata attributes (frontend.md § Columns). The API already applies
// the per-user access filter (ADR-001), so no label reaches a user the backend
// would not return (REQ-NC-LABEL-1).
export function toFileNode(
  deps: Pick<MomentumViewDeps, 'File' | 'uid' | 'davRootUrl'>,
  doc: SearchItem,
): MomentumFileNode {
  return new deps.File({
    id: doc.public_id,
    source: `${deps.davRootUrl}${toHomeRelativePath(doc.path ?? '')}`,
    root: `/files/${deps.uid}`,
    owner: deps.uid,
    mtime: doc.created_at ? new Date(doc.created_at) : undefined,
    permissions: PERMISSION_READ,
    attributes: {
      'momentum-doc-id': doc.public_id ?? '',
      'momentum-type': doc.doc_type ?? '',
      'momentum-direction': doc.direction ?? '',
      'momentum-status': doc.status ?? '',
      'momentum-reviewed': Boolean(doc.reviewed),
    },
  })
}

// The synthetic root `Folder` every `getContents(path)` call must return
// alongside its `contents` (real `ContentsWithRoot` contract) — this View has
// no real directory tree, so one fixed root stands in for "/".
function buildRootFolder(deps: Pick<MomentumViewDeps, 'Folder' | 'uid' | 'davRootUrl'>): MomentumFileNode {
  return new deps.Folder({
    id: 0,
    source: deps.davRootUrl,
    root: `/files/${deps.uid}`,
    owner: deps.uid,
    permissions: PERMISSION_READ,
  })
}

function textCell(value: string): HTMLElement {
  const span = document.createElement('span')
  span.textContent = value
  return span
}

function attr(node: MomentumFileNode, key: string): string {
  const value = node.attributes?.[key]
  return typeof value === 'string' ? value : ''
}

// Display-only columns (frontend.md § Columns). None are editable.
export function createMomentumColumns(deps: Pick<MomentumViewDeps, 't'>): MomentumColumn[] {
  const { t } = deps
  return [
    {
      id: 'momentum-type',
      title: t(MOMENTUM_APP_ID, 'Type'),
      render: (node) => textCell(attr(node, 'momentum-type') || DASH),
    },
    {
      id: 'momentum-direction',
      title: t(MOMENTUM_APP_ID, 'Direction'),
      render: (node) => textCell(attr(node, 'momentum-direction') || DASH),
    },
    {
      id: 'momentum-status',
      title: t(MOMENTUM_APP_ID, 'Status'),
      render: (node) => textCell(attr(node, 'momentum-status') || DASH),
    },
    {
      id: 'momentum-reviewed',
      title: t(MOMENTUM_APP_ID, 'Reviewed'),
      render: (node) => textCell(node.attributes?.['momentum-reviewed'] === true ? '✓' : DASH),
    },
  ]
}

// --- getContents -----------------------------------------------------------

function buildSearchUrl(
  deps: Pick<MomentumViewDeps, 'generateUrl'>,
  typeName: string | undefined,
  sort?: string,
): string {
  const params = new URLSearchParams()
  // Per-type sub-views pass `type_name` verbatim (review.md G26; matches
  // api.md's `GET /search/documents` param). The root view passes none.
  if (typeName) params.set('type_name', typeName)
  // Only the Recent Documents view sorts explicitly; every other view leaves
  // the param off entirely so the API's own default ordering applies rather
  // than this module second-guessing it.
  if (sort) params.set('sort', sort)
  params.set('limit', String(DEFAULT_PAGE_SIZE))
  return deps.generateUrl(`${API_BASE}/search/documents?${params.toString()}`)
}

// Builds a `getContents(path, options)` bound to an optional `type_name`
// filter. Reads `GET /search/documents` (never a FilesMetadata scan) so the
// View reflects Doc-Mgr's ground truth. `options.signal` (real
// `IGetContentsOptions` contract, `@nextcloud/files@4.0.0`) is forwarded to
// axios so the Files app can cancel an in-flight fetch on directory change.
// On API failure this returns the root folder with no contents — the real
// `View.getContents` contract has no per-call error slot, so a failed fetch
// reads to the Files app as an empty view rather than a distinct
// "unavailable" state.
export function createMomentumGetContents(
  deps: MomentumViewDeps,
  typeName?: string,
  sort?: string,
): (path: string, options?: { signal?: AbortSignal }) => Promise<MomentumContentsResult> {
  return async (_path, options) => {
    const folder = buildRootFolder(deps)
    const url = buildSearchUrl(deps, typeName, sort)
    try {
      const { data } = await deps.axios.get<SearchDocumentsResponse>(url, { signal: options?.signal })
      const contents = (data.items ?? []).map((doc) => toFileNode(deps, doc))
      return { folder, contents }
    } catch {
      return { folder, contents: [] }
    }
  }
}

// --- Ask Filo ---------------------------------------------------------------

// The Ask Filo view has no documents to list — it exists to host the chat —
// so its `getContents` resolves with the synthetic root folder and zero
// contents, which is precisely the condition that makes the Files app call
// `emptyView` (apps/files/src/views/FilesList.vue's `showCustomEmptyView`:
// `!loading && isEmptyDir && emptyView !== undefined`). It deliberately makes
// no API call: there is nothing to fetch, and a failing search must not blank
// the chat.
export function createAskFiloGetContents(
  deps: MomentumViewDeps,
): (path: string, options?: { signal?: AbortSignal }) => Promise<MomentumContentsResult> {
  return async () => ({ folder: buildRootFolder(deps), contents: [] })
}

// Renders the corpus-scoped IonosGPT chat into the container the Files app
// hands us — the same `{ mode: 'corpus' }` embed the app's own NL Query page
// mounts (frontend.md § NL Query Page), so the two surfaces are one
// implementation rather than two.
//
// Framework-free on purpose: `mountIonosGptEmbed` builds a plain iframe, so
// this bundle needs no Vue runtime (vite.config.ts loads @vitejs/plugin-vue
// only for the app-shell build, and the Files bundle must stay small — it
// loads on *every* Files page).
export function createAskFiloEmptyView(
  deps: Pick<MomentumViewDeps, 'mountEmbed'>,
): (div: HTMLDivElement) => void {
  const mountEmbed = deps.mountEmbed ?? mountIonosGptEmbed
  let handle: MomentumEmbedHandle | null = null

  return (div) => {
    // FilesList.vue re-invokes emptyView on every re-entry into the view, so
    // this has to be idempotent or each visit stacks another live iframe.
    handle?.destroy()
    handle = null
    div.replaceChildren()

    // `.files-list__empty-view-wrapper` is `display: flex; height: 100%`, and
    // the div we get is an unstyled child of it — an iframe inside collapses
    // to zero height without a flex box to fill. Styled inline rather than via
    // a stylesheet because this bundle emits no CSS of its own.
    div.style.display = 'flex'
    div.style.flex = '1 1 auto'
    div.style.minHeight = '0'

    handle = mountEmbed(div, { mode: 'corpus' })
    const iframe = div.querySelector('iframe')
    if (iframe) {
      iframe.style.width = '100%'
      iframe.style.height = '100%'
      iframe.style.border = 'none'
    }
  }
}

// --- Registration ----------------------------------------------------------

async function fetchDocumentTypes(deps: MomentumViewDeps): Promise<DocumentTypeDTO[]> {
  const { data } = await deps.axios.get<ListDocumentTypesResponse>(
    deps.generateUrl(`${API_BASE}/document-types`),
  )
  return data.types ?? []
}

// Registers the three top-level Files entries mirroring the app's own
// navigation tree (frontend.md § Files-App Navigation Entries) — Recent
// Documents, AI Filing, Ask Filo, in that order — plus one per-type sub-view
// under AI Filing for every type from `GET /document-types` (§ View
// Registration + § Per-Type Sub-Views). Generated at app boot — no type names
// hardcoded (requirements.md F5).
//
// All three top-level views are registered *before* the type list is fetched,
// so a failing `GET /document-types` costs only the per-type children (a
// best-effort enhancement) and never one of the entries a user navigates by.
export async function registerMomentumView(deps: MomentumViewDeps): Promise<void> {
  const columns = createMomentumColumns(deps)

  deps.Navigation.register(
    new deps.View({
      id: RECENT_VIEW_ID,
      name: deps.t(MOMENTUM_APP_ID, 'Recent Documents'),
      icon: RECENT_VIEW_ICON,
      order: 24,
      getContents: createMomentumGetContents(deps, undefined, RECENT_SORT),
      columns,
    }),
  )

  deps.Navigation.register(
    new deps.View({
      id: AI_FILING_VIEW_ID,
      name: deps.t(MOMENTUM_APP_ID, 'AI Filing'),
      icon: MOMENTUM_VIEW_ICON,
      order: 25,
      getContents: createMomentumGetContents(deps),
      columns,
    }),
  )

  deps.Navigation.register(
    new deps.View({
      id: ASK_FILO_VIEW_ID,
      name: deps.t(MOMENTUM_APP_ID, 'Chat'),
      icon: ASK_FILO_VIEW_ICON,
      order: 26,
      getContents: createAskFiloGetContents(deps),
      emptyView: createAskFiloEmptyView(deps),
    }),
  )

  let types: DocumentTypeDTO[]
  try {
    types = await fetchDocumentTypes(deps)
  } catch {
    // The root view is registered; per-type sub-views are a best-effort
    // enhancement, so a failed type list must not abort View registration.
    return
  }

  for (const type of types) {
    if (!type.type_name) continue
    deps.Navigation.register(
      new deps.View({
        id: `${AI_FILING_VIEW_ID}-${type.type_name}`,
        name: type.display_name || type.type_name,
        parent: AI_FILING_VIEW_ID,
        order: 1,
        icon: MOMENTUM_VIEW_ICON,
        getContents: createMomentumGetContents(deps, type.type_name),
        columns,
      }),
    )
  }
}
