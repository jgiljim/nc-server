// The Files & Shares bridge (frontend.md § Files & Shares Bridge; M123.1).
//
// This is the ONLY module in this app allowed to touch Nextcloud's file
// registries (`@nextcloud/files`' `getNavigation()` / `getFileActions()`) or
// `window.OCA.Files.Sidebar`. Everything above it
// — pages, components, the nav — sees only the `Bridge*` shapes declared here.
// When a Nextcloud major moves that surface, this file is the diff.
//
// Why a bridge at all rather than porting the Files app's list: the Files app
// is an application over a private Pinia instance, not a library. Its *data*
// however is reachable — core's `files-init` / `files_sharing-init` /
// `files_trashbin-init` bundles register their views and actions into the
// shared, version-scoped registry (`window._nc_files_scope.v4_0`), and any
// bundle built against the same major reads the same registry. Measured on a
// running NC 34 install (2026-08-24): loading those three bundles on
// `/apps/momentum/*` yields 14 views, 18 file actions and 5 filters, and the
// views return real data. PageController::index() is what loads them.
//
// Deps are injected (same pattern as `files-view/momentumFilesView.ts`) so the
// whole module is unit-testable without the Nextcloud runtime;
// `ncFilesBridgeRuntime.ts` is the one place the real packages are wired in.

// --- The shapes callers above this module see -------------------------------

export interface BridgeColumn {
  id: string
  title: string
  // Core's own column contract: a DOM node per cell. We only ever read its
  // text (see `renderColumnText`) — VirtualTable renders typed values, not
  // arbitrary HTML, and a file browser has no need for markup in a cell.
  render: (node: unknown, view: unknown) => HTMLElement | null | undefined
}

export interface BridgeView {
  id: string
  name: string
  parent?: string
  order?: number
  sticky?: boolean
  icon?: string
  emptyTitle?: string
  columns: BridgeColumn[]
}

export type BridgeNodeType = 'file' | 'folder'

export interface BridgeNode {
  fileid?: number
  basename: string
  // Path within the view's own root, e.g. `/Invoices/2026.pdf`.
  path: string
  type: BridgeNodeType
  mime?: string
  size?: number
  mtime?: Date
  permissions?: number
  owner?: string
  // The raw `@nextcloud/files` node. Opaque above this module — it exists so
  // an action or a core column can be handed back the object it expects.
  raw: unknown
}

export interface BridgeListing {
  folderPath: string
  nodes: BridgeNode[]
  // The view's own folder object, opaque above this module. Kept because
  // new-menu handlers create INTO it and file-list actions take it as part of
  // their context — a path string is not enough (frontend.md § Files-app
  // parity).
  folderRaw: unknown
}

export interface BridgeAction {
  id: string
  label: string
  iconSvgInline?: string
  // True when Nextcloud marks this action for INLINE presentation — its
  // `displayName` deliberately returns "" because the row icon itself IS the
  // presentation (frontend.md § Files-app parity; M174.5). Callers must
  // render these as row controls, not as menu entries with a blank label.
  inline: boolean
}

// One entry of core's "New" menu (frontend.md § Files-app parity). `category`
// is core's own grouping: 0 = upload from device, 1 = create new, 2 = other.
export interface BridgeNewMenuEntry {
  id: string
  label: string
  iconSvgInline?: string
  category: number
  order: number
}

// One registered file-list action — an action on the whole view rather than on
// a node (core registers `empty-trash` this way).
export interface BridgeListAction {
  id: string
  label: string
  iconSvgInline?: string
  order: number
}

// One chip a filter renders to show its active state.
export interface BridgeFilterChip {
  text: string
  icon?: string
  user?: string
  onclick: () => void
}

// A registered file-list filter. `tagName`, when present, is a web component
// core has ALREADY defined on the page — mounting it is how this app gets the
// real Type/Modified/People UI instead of a second implementation of it.
export interface BridgeFilter {
  id: string
  order: number
  displayName?: string
  iconSvgInline?: string
  tagName?: string
  // Applies this filter to a listing. Called with the nodes core's own filter
  // implementations expect.
  apply: (nodes: BridgeNode[]) => BridgeNode[]
  chips: () => BridgeFilterChip[]
  // Subscribes to this filter's own change events; returns an unsubscribe.
  // `filter` = re-apply against the same listing, `chips` = re-render chips.
  subscribe: (onFilterChanged: () => void, onChipsChanged: () => void) => () => void
  // Hands the filter instance to its web component, the contract
  // IFileListFilterWithUi documents (`el.filter = filter`).
  attachTo: (element: { filter?: unknown }) => void
}

export type BridgeSortColumn = 'basename' | 'size' | 'mtime'

export interface BridgeSortOptions {
  column: BridgeSortColumn
  direction: 'asc' | 'desc'
  foldersFirst?: boolean
  favoritesFirst?: boolean
}

// One node of the rendered navigation tree: a top-level view plus the views
// that declare it as their `parent` (frontend.md § Navigation and routes).
export interface BridgeNavNode {
  view: BridgeView
  children: BridgeView[]
}

// --- Injected Nextcloud-runtime surface -------------------------------------

// Deliberately narrower than the real `IView`/`INode`/`IFileAction`: only the
// fields this module reads. The real classes are structurally assignable (see
// ncFilesBridgeRuntime.ts).
export interface RawView {
  id: string
  name: string
  parent?: string
  order?: number
  sticky?: boolean
  icon?: string
  emptyTitle?: string
  columns?: BridgeColumn[]
  getContents: (path: string, options: { signal: AbortSignal }) => Promise<{
    folder?: { path?: string }
    contents: RawNode[]
  }>
}

export interface RawNode {
  fileid?: number
  basename?: string
  path?: string
  type?: string
  mime?: string
  size?: number
  mtime?: Date
  permissions?: number
  owner?: string | null
}

export interface RawAction {
  id: string
  displayName: (context: unknown) => string
  iconSvgInline?: (context: unknown) => string
  enabled?: (context: unknown) => boolean
  exec: (context: unknown) => Promise<boolean | null>
  execBatch?: (context: unknown) => Promise<(boolean | null)[]>
  // TWO distinct properties, not one (M174.5's own trap): Nextcloud marks an
  // action for inline row presentation with EITHER `inline` (comments-unread,
  // reminder-status, accept-share, reject-share, restore-share,
  // sharing-status, restore, lock_inline) OR `renderInline` (system-tags —
  // carries no `inline` at all). Both read as functions on a live NC 34
  // registry. Declaring only one leaves the other's actions rendered as
  // blank, unnamed overflow-menu rows.
  inline?: (context: unknown) => boolean
  renderInline?: (context: unknown) => boolean
}

export interface RawNewMenuEntry {
  id: string
  displayName: string
  iconSvgInline?: string
  category?: number
  order?: number
  enabled?: (folder: unknown) => boolean
  handler: (folder: unknown, contents: unknown[]) => void
}

export interface RawListAction {
  id: string
  displayName: (context: unknown) => string
  iconSvgInline?: (context: unknown) => string
  order: number
  enabled?: (context: unknown) => boolean
  exec: (context: unknown) => Promise<boolean | null>
}

export interface RawFilter {
  id: string
  order: number
  displayName?: string
  iconSvgInline?: string
  tagName?: string
  filter: (nodes: unknown[]) => unknown[]
  addEventListener: (type: string, listener: (event: { detail?: unknown }) => void) => void
  removeEventListener: (type: string, listener: (event: { detail?: unknown }) => void) => void
}

export interface BridgeDeps {
  // `getNavigation()`'s return value — the registry, not a snapshot of it.
  navigation: {
    views: RawView[]
    addEventListener: (type: 'update', listener: () => void) => void
    removeEventListener: (type: 'update', listener: () => void) => void
    // Sets the shared `Navigation` singleton's active view (M174.7). This is
    // the SAME version-scoped registry (`window._nc_files_scope.v4_0`, see
    // this module's top comment) the real Files app's own Pinia `active`
    // store watches, so calling this from our page is how `activeView`
    // becomes set outside the Files app's own router — the one piece of
    // context `getSidebar().open()` requires and that nothing else in this
    // app was setting.
    setActive: (id: string | null) => void
  }
  getFileActions: () => RawAction[]
  // Uploads one file into `directory` (a path inside the user's files root).
  // Injected as a plain function rather than a WebDAV client: pulling
  // `@nextcloud/files/dav` in for this would drag the whole `webdav` package
  // and its XML parser into the bundle (measured: +~350 kB before minify) for
  // a single PUT, and it is unloadable in the jsdom test run. Must reject with
  // UploadConflictError when the name is taken — never overwrite.
  putFile: (directory: string, file: UploadableFile, signal?: AbortSignal) => Promise<void>
  // Core's own registries for the toolbar surfaces (frontend.md § Files-app
  // parity). Functions rather than snapshots: entries and filters can be
  // registered after this page mounts.
  getNewMenuEntries: (folder: unknown) => RawNewMenuEntry[]
  getListActions: () => RawListAction[]
  getFilters: () => RawFilter[]
  // `sortNodes` from `@nextcloud/files` — core's own comparator, so this app
  // does not grow a second opinion about how files are ordered.
  sortNodes: (
    nodes: unknown[],
    options: {
      sortingMode: string
      sortingOrder: 'asc' | 'desc'
      sortFoldersFirst?: boolean
      sortFavoritesFirst?: boolean
    },
  ) => unknown[]
  // `@nextcloud/files`' `getSidebar()` (M174.7) — a stateless proxy over the
  // Pinia `sidebar` store the `files` app installs at `window.OCA.Files._sidebar`
  // (present only once core's `LoadSidebar` event has been dispatched,
  // `PageController::index()`). NOT `window.OCA.Files.Sidebar`: that legacy
  // global is gone on NC 34 (measured backlog/v1.md Phase 174/M174.7), which is
  // why `sidebarAvailable()` used to report false while the real sidebar was
  // actually present.
  getSidebar?: () => RawSidebar
  // Defaults to the real global registry in `ncFilesBridgeRuntime.ts`;
  // overridable so `prepareSidebarTabs` above stays testable without a real
  // DOM, the same seam `momentumAskAiSidebar.ts`'s `MomentumSidebarDeps` uses.
  customElements?: CustomElementRegistryLike
  t: (app: string, text: string) => string
}

// The subset of `@nextcloud/files@4.0.0`'s real `ISidebarTab` this bridge
// reads (confirmed against the installed type declarations, same source the
// M4.16 Ask AI tab (`sidebar/momentumAskAiSidebar.ts`) targets): a Web
// Components registration, not a `mount(el, fileInfo)` callback pair. The real
// sidebar creates a `<tagName>` custom element per tab and sets its `node`
// property directly — there is no render callback to call ourselves.
export interface RawSidebarTab {
  id: string
  displayName: string
  iconSvgInline: string
  order: number
  tagName: string
  enabled?: (context: { node: unknown }) => boolean
  onInit?: () => void | Promise<void>
}

// The subset of `@nextcloud/files`' `ISidebar` this bridge reads.
export interface RawSidebar {
  readonly available: boolean
  // `node` is the raw `INode` `@nextcloud/files` expects — opaque here, same
  // as `BridgeNode.raw` everywhere else in this module.
  open: (node: unknown, tab?: string) => void
  close?: () => void
  // Returns the tabs registered against the shared, version-scoped registry
  // (this app's own `momentum-nl` among them, `sidebar/momentumAskAiSidebar.ts`)
  // — already filtered to the ones enabled for `context.node` by the real
  // implementation.
  getTabs?: (context?: { node: unknown }) => RawSidebarTab[]
}

// A sidebar tab ready to render: enabled for the open node, its custom
// element defined, sorted the way the real sidebar orders tabs.
export interface BridgeSidebarTab {
  id: string
  displayName: string
  iconSvgInline: string
  order: number
  tagName: string
}

// The slice of `CustomElementRegistry` this module needs — same shape
// `sidebar/momentumAskAiSidebar.ts`'s `CustomElementRegistryLike` declares, so
// a test can fake it without a real DOM.
export interface CustomElementRegistryLike {
  get(name: string): CustomElementConstructor | undefined
}

// A registered tab's `onInit()` defines its custom element (M4.16's own
// `createMomentumAskAiTabElement`/`registerAskAiSidebarTab` is one example) —
// calling it twice for the same tag name throws in a real
// `CustomElementRegistry`, and nothing here can assume every third-party tab
// guards that itself. Filters to the tabs enabled for `node` first (`enabled`
// is tolerant, like `isInlineAction` above: a predicate that throws drops the
// tab rather than taking the whole sidebar down), then ensures each survivor's
// element is defined, dropping any whose `onInit()` failed rather than
// rendering a tag the DOM cannot construct. Sorted by `order`, matching the
// real sidebar's own tab ordering.
export async function prepareSidebarTabs(
  tabs: RawSidebarTab[],
  node: unknown,
  customElementRegistry: CustomElementRegistryLike,
): Promise<BridgeSidebarTab[]> {
  const enabled = tabs.filter((tab) => {
    try {
      return tab.enabled ? tab.enabled({ node }) : true
    } catch {
      return false
    }
  })
  for (const tab of enabled) {
    if (customElementRegistry.get(tab.tagName)) continue
    try {
      await tab.onInit?.()
    } catch {
      // Dropped below (still undefined in the registry) rather than crashing
      // the whole sidebar over one tab that cannot register itself.
    }
  }
  return enabled
    .filter((tab) => !!customElementRegistry.get(tab.tagName))
    .map(({ id, displayName, iconSvgInline, order, tagName }) => ({
      id,
      displayName,
      iconSvgInline,
      order,
      tagName,
    }))
    .sort((a, b) => a.order - b.order)
}

// --- Which views we surface, and how each one is read ----------------------

// `search` is the Files app's own search store rendered as a view; `folders`
// is its folder-tree UI mode. Neither is a listing this app can render, and
// neither is a place a user would navigate to from here (frontend.md § The
// split).
export const NON_BROWSABLE_VIEW_IDS: readonly string[] = ['search', 'folders']

// This app's OWN Files-app views (files-view/momentumFilesView.ts: AI Filing,
// Recent Documents, Ask Filo) register into the SAME shared registry, and they
// now reach our own pages too: `PageController::index()` dispatches
// `LoadAdditionalScriptsEvent`, which this app's own
// LoadAdditionalScriptsListener answers by injecting `momentum-files.js`. Left
// unfiltered, the bridge mirrors them straight back into the nav beside the
// real entries they duplicate — measured on the running instance, 2026-08-25,
// where the nav showed "Recent Documents", "AI Filing" and "Ask Filo" twice.
// Matched by id prefix rather than by a hardcoded list of three, so a fourth
// view added there never reappears here.
export const OWN_VIEW_ID_PREFIX = 'momentum-'

export function isOwnView(viewId: string): boolean {
  return viewId.startsWith(OWN_VIEW_ID_PREFIX)
}

// The views that map to a real, writable directory — the only places an upload
// affordance makes sense. The share and trash views are projections: "upload
// into Shared with you" has no meaning.
export const WRITABLE_VIEW_IDS: readonly string[] = ['files', 'personal']

// Phase 145 — All files / Recent / Favorites are the same table under a
// different filter (frontend.md's own words for the Documents/type nav entry
// this pattern already retired once, Phase 125/126). Rather than three (or,
// counting `personal`, four) separate rail entries, they collapse into ONE nav
// entry ("Files", § AppNavigation) and become tabs INSIDE the Files view (§
// FileBrowserPage) — matching `specs/mockup-ai-document-manager.html`'s
// `files-chip` row. `personal` folds into this group too (it is the same kind
// of "which subset of the same table" distinction) but gets no tab of its own,
// since the mockup has exactly three chips — its route still resolves via the
// generic `/browse/:viewId` route, it is simply not offered from the nav or
// the tab strip.
export const CONSOLIDATED_FILE_VIEW_IDS: readonly string[] = [
  'files',
  'personal',
  'recent',
  'favorites',
]

// The three tabs the Files view renders when the current view is one of them.
// Deliberately NOT sourced from the registry's own view names (§ mockup) —
// hardcoding the label means the tab strip reads "All files / Recent /
// Favorites" regardless of what a given Nextcloud version happens to call the
// underlying view (e.g. `personal` vs `recent` across versions), which is
// exactly the ambiguity this phase's notes flag.
export const FILE_BROWSER_TAB_VIEW_IDS: readonly string[] = ['files', 'recent', 'favorites']

// A core column hands back a DOM node; we show its text. Kept tolerant: a
// column that returns nothing (or throws on a node it does not understand)
// must not take the whole row down — a missing "Deleted by" cell is a far
// smaller defect than an unrenderable trash listing.
export function renderColumnText(
  column: BridgeColumn,
  node: BridgeNode,
  view: BridgeView,
): string {
  try {
    const el = column.render(node.raw, view)
    return el?.textContent?.trim() ?? ''
  } catch {
    return ''
  }
}

export function toBridgeView(raw: RawView): BridgeView {
  return {
    id: raw.id,
    name: raw.name,
    parent: raw.parent,
    order: raw.order,
    sticky: raw.sticky,
    icon: raw.icon,
    emptyTitle: raw.emptyTitle,
    columns: raw.columns ?? [],
  }
}

export function toBridgeNode(raw: RawNode): BridgeNode {
  const path = raw.path ?? '/'
  return {
    fileid: raw.fileid,
    basename: raw.basename ?? path.split('/').filter(Boolean).pop() ?? '',
    path,
    type: raw.type === 'folder' ? 'folder' : 'file',
    mime: raw.mime,
    size: raw.size,
    mtime: raw.mtime,
    permissions: raw.permissions,
    owner: raw.owner ?? undefined,
    raw,
  }
}

// Views the app offers, ordered the way the Files app orders them: by `order`
// when set, then by name. Pure — exported for unit tests and reused by
// `buildNavTree`.
export function browsableViews(views: RawView[]): BridgeView[] {
  return views
    .filter((view) => !NON_BROWSABLE_VIEW_IDS.includes(view.id) && !isOwnView(view.id))
    .map(toBridgeView)
    .sort((a, b) => {
      const left = a.order ?? Number.MAX_SAFE_INTEGER
      const right = b.order ?? Number.MAX_SAFE_INTEGER
      return left === right ? a.name.localeCompare(b.name) : left - right
    })
}

// Groups the flat view list into the two-level tree the nav renders. The
// hierarchy is the registry's own: `shareoverview` is the declared `parent` of
// the six sharing views (measured, NC 34). A child whose parent is not itself
// browsable (or does not exist) is promoted to top level rather than dropped —
// losing a nav entry silently is worse than showing it one level up.
export function buildNavTree(views: RawView[]): BridgeNavNode[] {
  const browsable = browsableViews(views)
  const byId = new Map(browsable.map((view) => [view.id, view]))
  const tree: BridgeNavNode[] = []
  const nodeFor = new Map<string, BridgeNavNode>()

  for (const view of browsable) {
    if (view.parent && byId.has(view.parent)) continue
    const node: BridgeNavNode = { view, children: [] }
    nodeFor.set(view.id, node)
    tree.push(node)
  }
  for (const view of browsable) {
    if (!view.parent) continue
    const parent = nodeFor.get(view.parent)
    if (parent) parent.children.push(view)
  }
  return tree
}

export interface Bridge {
  views: () => BridgeView[]
  canUpload: (viewId: string) => boolean
  uploadFile: (viewId: string, path: string, file: UploadableFile, signal?: AbortSignal) => Promise<void>
  navTree: () => BridgeNavNode[]
  view: (viewId: string) => BridgeView | undefined
  listContents: (viewId: string, path: string, signal: AbortSignal) => Promise<BridgeListing>
  actionsFor: (node: BridgeNode, viewId: string, contents: BridgeNode[]) => BridgeAction[]
  runAction: (
    actionId: string,
    node: BridgeNode,
    viewId: string,
    contents: BridgeNode[],
  ) => Promise<boolean | null>
  sidebarAvailable: () => boolean
  // `tab`, when given, opens the sidebar directly on that tab — how our own
  // `momentum-nl` tab becomes reachable from the row menu, rather than merely
  // reachable-in-principle from whichever tab NC's own `Details` action opens.
  openSidebar: (node: BridgeNode, tab?: string) => void
  // The tabs to actually RENDER for `node` (M177.3) — `openSidebar` above only
  // sets the shared store's state; the real Files app's own sidebar UI never
  // mounts on this page (nothing here is the Files app), so this page renders
  // its own, and needs the tab list to do it.
  sidebarTabsFor: (node: BridgeNode) => Promise<BridgeSidebarTab[]>
  closeSidebar: () => void
  // --- Files-app parity surfaces (frontend.md § Files-app parity) ----------
  newMenuEntries: (listing: BridgeListing) => BridgeNewMenuEntry[]
  runNewMenuEntry: (entryId: string, listing: BridgeListing) => void
  listActionsFor: (viewId: string, listing: BridgeListing) => BridgeListAction[]
  runListAction: (actionId: string, viewId: string, listing: BridgeListing) => Promise<boolean | null>
  filters: () => BridgeFilter[]
  batchActionsFor: (nodes: BridgeNode[], viewId: string, contents: BridgeNode[]) => BridgeAction[]
  runBatchAction: (
    actionId: string,
    nodes: BridgeNode[],
    viewId: string,
    contents: BridgeNode[],
  ) => Promise<(boolean | null)[]>
  sortNodes: (nodes: BridgeNode[], options: BridgeSortOptions) => BridgeNode[]
  onViewsChanged: (listener: () => void) => () => void
}

// The subset of the DOM `File` interface uploads need — declared structurally
// so this module stays free of DOM globals and testable in a plain-Node run.
export interface UploadableFile {
  name: string
  size: number
  arrayBuffer: () => Promise<ArrayBuffer>
}

// Thrown when an upload would replace an existing file. Never silently
// overwritten: this app has no conflict-resolution UI (core's uploader owns
// that in the Files app), and quietly replacing a user's file is the worst
// possible default.
export class UploadConflictError extends Error {
  constructor(readonly path: string) {
    super(`'${path}' already exists`)
    this.name = 'UploadConflictError'
  }
}

// Thrown when a caller asks for a view the registry does not have. A stale
// bookmark or a disabled app is a legitimate way to get here, so pages render
// an empty state from this rather than treating it as a crash (frontend.md §
// Navigation and routes).
export class UnknownViewError extends Error {
  constructor(readonly viewId: string) {
    super(`unknown files view '${viewId}'`)
    this.name = 'UnknownViewError'
  }
}

// True when the action declares EITHER `inline` or `renderInline` and it
// evaluates true for this context — see RawAction's comment for why both
// must be checked. Tolerant like `enabled`: a predicate that throws leaves
// the action out of the inline set (and it still falls back to the overflow
// menu via `enabled`, rather than vanishing).
export function isInlineAction(action: RawAction, context: unknown): boolean {
  try {
    if (action.inline?.(context)) return true
  } catch {
    // fall through to renderInline
  }
  try {
    return !!action.renderInline?.(context)
  } catch {
    return false
  }
}

export function createBridge(deps: BridgeDeps): Bridge {
  const rawView = (viewId: string): RawView => {
    const found = deps.navigation.views.find((view) => view.id === viewId)
    if (!found || NON_BROWSABLE_VIEW_IDS.includes(viewId) || isOwnView(viewId)) {
      throw new UnknownViewError(viewId)
    }
    return found
  }

  // `update:chips` carries the chips in its event detail, and a filter has no
  // getter for them — so the last emitted set is remembered per filter id.
  const chipCache = new Map<string, BridgeFilterChip[]>()
  const chipsOf = (filter: RawFilter): BridgeFilterChip[] => chipCache.get(filter.id) ?? []

  // What `getFileListActions()`'s IFileListAction expects: the whole view, not
  // a node (frontend.md § Files-app parity).
  const viewActionContext = (view: RawView, listing: BridgeListing) => ({
    view,
    folder: listing.folderRaw,
    contents: listing.nodes.map((node) => node.raw),
  })

  const actionContext = (node: BridgeNode, view: RawView, contents: BridgeNode[]) => ({
    nodes: [node.raw],
    view,
    folder: node.raw,
    contents: contents.map((entry) => entry.raw),
  })

  return {
    views: () => browsableViews(deps.navigation.views),
    // Only the two directory-backed views are writable; see
    // WRITABLE_VIEW_IDS. The page hides the upload affordance elsewhere rather
    // than offering one that can only fail.
    canUpload: (viewId) => WRITABLE_VIEW_IDS.includes(viewId),
    uploadFile: async (viewId, path, file, signal) => {
      rawView(viewId)
      if (!WRITABLE_VIEW_IDS.includes(viewId)) {
        throw new Error(`view '${viewId}' is not a writable location`)
      }
      await deps.putFile(path, file, signal)
    },
    navTree: () => buildNavTree(deps.navigation.views),
    view: (viewId) => {
      const found = deps.navigation.views.find((view) => view.id === viewId)
      return found && !NON_BROWSABLE_VIEW_IDS.includes(viewId) && !isOwnView(viewId)
        ? toBridgeView(found)
        : undefined
    },
    // EVERY view is read through its own getContents, core's `files` view
    // included. That view additionally needs `window.OCP.Files.Router` (it
    // consults the Files app's search store) — supplied by
    // `ncFilesRouterShim.ts`, installed by ncFilesBridgeRuntime, which also
    // makes core's own "Open folder"/"View in folder" actions navigate inside
    // this app. Re-implementing its DAV PROPFIND here instead was the earlier
    // plan and was dropped: it duplicated core's semantics (hidden files,
    // sorting config) and cost the whole `webdav` + `sax` dependency chain.
    listContents: async (viewId, path, signal) => {
      const view = rawView(viewId)
      // M174.7: keeps the shared `Navigation` singleton's active view in sync
      // with what this page is actually showing, every time it lists a view —
      // the Files app's own router does the equivalent on every navigation.
      // Without this, `activeView` stays unset outside the Files app and
      // `getSidebar().open()` throws "the active folder or view is not set."
      deps.navigation.setActive(viewId)
      // The `options` argument is REQUIRED in @nextcloud/files v4 — omitting
      // it throws on `signal` inside core's own getContents implementations.
      const result = await view.getContents(path, { signal })
      return {
        folderPath: result.folder?.path ?? path,
        nodes: (result.contents ?? []).map(toBridgeNode),
        folderRaw: result.folder,
      }
    },
    actionsFor: (node, viewId, contents) => {
      const view = rawView(viewId)
      const context = actionContext(node, view, contents)
      return deps
        .getFileActions()
        .filter((action) => {
          try {
            return action.enabled ? action.enabled(context) : true
          } catch {
            // An action that cannot decide whether it applies is not offered,
            // rather than offered and failing when clicked.
            return false
          }
        })
        .map((action) => ({
          id: action.id,
          label: action.displayName(context),
          iconSvgInline: action.iconSvgInline?.(context),
          inline: isInlineAction(action, context),
        }))
    },
    runAction: async (actionId, node, viewId, contents) => {
      const view = rawView(viewId)
      const action = deps.getFileActions().find((candidate) => candidate.id === actionId)
      if (!action) throw new Error(`unknown file action '${actionId}'`)
      return action.exec(actionContext(node, view, contents))
    },
    sidebarAvailable: () => !!deps.getSidebar?.()?.available,
    openSidebar: (node, tab) => {
      const sidebar = deps.getSidebar?.()
      if (!sidebar?.available) throw new Error('the Files sidebar is not available on this page')
      sidebar.open(node.raw, tab)
    },
    sidebarTabsFor: async (node) => {
      const sidebar = deps.getSidebar?.()
      if (!sidebar?.available) return []
      const rawTabs = sidebar.getTabs?.({ node: node.raw }) ?? []
      return prepareSidebarTabs(rawTabs, node.raw, deps.customElements ?? globalThis.customElements)
    },
    closeSidebar: () => deps.getSidebar?.()?.close?.(),
    newMenuEntries: (listing) =>
      deps
        .getNewMenuEntries(listing.folderRaw)
        .filter((entry) => {
          try {
            return entry.enabled ? entry.enabled(listing.folderRaw) : true
          } catch {
            // An entry that cannot decide whether it applies is not offered,
            // rather than offered and throwing when clicked.
            return false
          }
        })
        .map((entry) => ({
          id: entry.id,
          label: entry.displayName,
          iconSvgInline: entry.iconSvgInline,
          // Core's default when an entry declares none is CreateNew (1).
          category: entry.category ?? 1,
          order: entry.order ?? 0,
        }))
        .sort((a, b) => (a.category === b.category ? a.order - b.order : a.category - b.category)),

    runNewMenuEntry: (entryId, listing) => {
      const entry = deps
        .getNewMenuEntries(listing.folderRaw)
        .find((candidate) => candidate.id === entryId)
      if (!entry) throw new Error(`unknown new-menu entry '${entryId}'`)
      // Core's handlers are fire-and-forget (they open their own dialogs); the
      // page re-reads the listing afterwards rather than expecting a result.
      entry.handler(listing.folderRaw, listing.nodes.map((node) => node.raw))
    },

    listActionsFor: (viewId, listing) => {
      const context = viewActionContext(rawView(viewId), listing)
      return deps
        .getListActions()
        .filter((action) => {
          try {
            return action.enabled ? action.enabled(context) : true
          } catch {
            return false
          }
        })
        .sort((a, b) => a.order - b.order)
        .map((action) => ({
          id: action.id,
          label: action.displayName(context),
          iconSvgInline: action.iconSvgInline?.(context),
          order: action.order,
        }))
    },

    runListAction: async (actionId, viewId, listing) => {
      const action = deps.getListActions().find((candidate) => candidate.id === actionId)
      if (!action) throw new Error(`unknown file-list action '${actionId}'`)
      return action.exec(viewActionContext(rawView(viewId), listing))
    },

    filters: () =>
      [...deps.getFilters()]
        .sort((a, b) => a.order - b.order)
        .map((filter) => ({
          id: filter.id,
          order: filter.order,
          displayName: filter.displayName,
          iconSvgInline: filter.iconSvgInline,
          tagName: filter.tagName,
          apply: (nodes) => {
            const kept = new Set(filter.filter(nodes.map((node) => node.raw)))
            return nodes.filter((node) => kept.has(node.raw))
          },
          chips: () => chipsOf(filter),
          subscribe: (onFilterChanged, onChipsChanged) => {
            const filterListener = () => onFilterChanged()
            const chipsListener = (event: { detail?: unknown }) => {
              chipCache.set(filter.id, (event.detail as BridgeFilterChip[] | undefined) ?? [])
              onChipsChanged()
            }
            filter.addEventListener('update:filter', filterListener)
            filter.addEventListener('update:chips', chipsListener)
            return () => {
              filter.removeEventListener('update:filter', filterListener)
              filter.removeEventListener('update:chips', chipsListener)
            }
          },
          attachTo: (element) => {
            element.filter = filter
          },
        })),

    batchActionsFor: (nodes, viewId, contents) => {
      if (nodes.length === 0) return []
      const context = {
        nodes: nodes.map((node) => node.raw),
        view: rawView(viewId),
        folder: nodes[0].raw,
        contents: contents.map((entry) => entry.raw),
      }
      return deps
        .getFileActions()
        // Only actions that can act on a SET. An action without execBatch
        // applied one-by-one would report success while half of a selection
        // silently failed.
        .filter((action) => typeof action.execBatch === 'function')
        .filter((action) => {
          try {
            return action.enabled ? action.enabled(context) : true
          } catch {
            return false
          }
        })
        .map((action) => ({
          id: action.id,
          label: action.displayName(context),
          iconSvgInline: action.iconSvgInline?.(context),
          inline: isInlineAction(action, context),
        }))
    },

    runBatchAction: async (actionId, nodes, viewId, contents) => {
      const action = deps.getFileActions().find((candidate) => candidate.id === actionId)
      if (!action?.execBatch) throw new Error(`file action '${actionId}' cannot act on a selection`)
      return action.execBatch({
        nodes: nodes.map((node) => node.raw),
        view: rawView(viewId),
        folder: nodes[0]?.raw,
        contents: contents.map((entry) => entry.raw),
      })
    },

    // Core's own comparator, so this app never grows a second opinion about
    // file ordering. Folders-first is core's own Files-app default.
    sortNodes: (nodes, options) => {
      const sorted = deps.sortNodes(
        nodes.map((node) => node.raw),
        {
          sortingMode: options.column,
          sortingOrder: options.direction,
          sortFoldersFirst: options.foldersFirst ?? true,
          sortFavoritesFirst: options.favoritesFirst ?? false,
        },
      )
      const byRaw = new Map(nodes.map((node) => [node.raw, node]))
      return sorted.map((raw) => byRaw.get(raw)).filter((node): node is BridgeNode => !!node)
    },

    // The registry is populated by scripts the server adds, whose load order
    // relative to this app's own bundle is not guaranteed — so callers
    // subscribe rather than reading `views` once at mount (frontend.md §
    // Server-side wiring).
    onViewsChanged: (listener) => {
      deps.navigation.addEventListener('update', listener)
      return () => deps.navigation.removeEventListener('update', listener)
    },
  }
}
