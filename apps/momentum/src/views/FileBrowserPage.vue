<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { n, t } from '@nextcloud/l10n'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcBreadcrumb from '@nextcloud/vue/components/NcBreadcrumb'
import NcBreadcrumbs from '@nextcloud/vue/components/NcBreadcrumbs'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import CloudUploadOutlineIcon from 'vue-material-design-icons/CloudUploadOutline.vue'
import DotsVerticalIcon from 'vue-material-design-icons/DotsVertical.vue'
import ViewGridIcon from 'vue-material-design-icons/ViewGrid.vue'
import ViewListIcon from 'vue-material-design-icons/ViewList.vue'
import AiStatusStrip from '../components/AiStatusStrip.vue'
import FilesSidebar from '../components/FilesSidebar.vue'
import FileTileGrid from '../components/FileTileGrid.vue'
import VirtualTable from '../components/VirtualTable.vue'
import { FolderIcon } from '../components/icons'
import { MOMENTUM_CONFIG } from '../config'
import { fetchDocumentByFileId, fetchStatsOverview } from '../services/documents'
import {
  FILE_BROWSER_TAB_VIEW_IDS,
  UnknownViewError,
  UploadConflictError,
  renderColumnText,
} from '../services/ncFilesBridge'
import { ncFilesBridge } from '../services/ncFilesBridgeRuntime'
import type {
  BridgeListing,
  BridgeNode,
  BridgeSidebarTab,
  BridgeSortColumn,
  BridgeView,
} from '../services/ncFilesBridge'
import type { ColumnDef, Page, SortState, TableRow } from '../types'

// frontend.md § Files & Shares Bridge — ONE page for every Nextcloud file
// view (All files, Personal, Recent, Favorites, the six sharing views, Trash).
// The view id comes from the route, the directory from `?dir=`, mirroring the
// Files app's own url shape so the two stay legible to each other.
//
// This page talks to `ncFilesBridge` only; it never touches
// `@nextcloud/files`, `OCA.Files.Sidebar` or `OCP.Files.*` itself.

const route = useRoute()
const router = useRouter()
const bridge = ncFilesBridge()

const viewId = computed(() => String(route.params.viewId ?? ''))
const dir = computed(() => {
  const raw = route.query.dir
  const value = Array.isArray(raw) ? raw[0] : raw
  return value && String(value).startsWith('/') ? String(value) : '/'
})

const view = ref<BridgeView | undefined>(bridge.view(viewId.value))
// The unfiltered, unsorted listing exactly as the view returned it, plus the
// raw folder object core's New menu and file-list actions need.
const listing = ref<BridgeListing | undefined>(undefined)
const nodes = ref<BridgeNode[]>([])
const selectedIds = ref<string[]>([])
// M147.1 (backlog/v1.md Phase 147): the table/grid toggle. Both views render
// off the SAME `nodes`/`selectedIds` state below (visibility only, via
// `v-show`) — never a second fetch or a second selection array, per the
// milestone's note.
const viewMode = ref<'table' | 'grid'>('table')
// Column sorting is LOCAL: a view returns the whole directory in one call, so a
// header click re-sorts what we already have rather than refetching. Core's own
// comparator does the ordering (bridge.sortNodes), folders first, matching the
// Files app's default rather than a fresh opinion.
const sort = ref<SortState>({ column: 'basename', direction: 'asc' })
const filters = ref(bridge.filters())
// M161.1 (backlog/v1.md Phase 161): subscribes every registered filter to a
// re-render, UI or not — moved here from FileListFilters.vue (removed along
// with the Type/Modified/People triggers it rendered). A filter WITHOUT UI
// (`files:hidden`) still needs this: its state can change from elsewhere
// (core's own "Show hidden files" setting, or the same filter registry's
// Files-app view, glue-app/src/files-view/momentumFilesView.ts) and this page
// must reflect that without a full refetch.
let filterUnsubscribes: Array<() => void> = []
function subscribeFilters(): void {
  filterUnsubscribes.forEach((unsubscribe) => unsubscribe())
  filterUnsubscribes = filters.value.map((filter) =>
    filter.subscribe(
      () => reflow(),
      () => {},
    ),
  )
}
onUnmounted(() => {
  filterUnsubscribes.forEach((unsubscribe) => unsubscribe())
  filterUnsubscribes = []
})
// M161.3 (backlog/v1.md Phase 161): a file-name search field beside the tab
// strip (mockup:2610-2614). This is a LOCAL filter over the listing this page
// already holds, NOT the app's document search (its own API, unrelated) — a
// view already returns its whole directory in one call (`fetchPage`, below),
// which is why column sorting is local too, so filtering here must issue no
// request. `searchQuery` is debounced input; `reflow()` (below) recomputes
// `nodes` from the held listing, which both the table and the grid render off
// of, so the two views can never disagree with each other or with the item
// count.
// `searchInput` is the field's own immediate value (so typing never appears
// to lag or reset); `searchQuery` is what `visibleNodes()` actually filters
// on, updated only after MOMENTUM_CONFIG.SEARCH_DEBOUNCE_MS of idle typing —
// the same query/debouncedQuery split as TypeaheadSearch.vue.
const searchInput = ref('')
const searchQuery = ref('')
let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined
function onSearchInput(value: string | number): void {
  searchInput.value = String(value)
  if (searchDebounceTimer !== undefined) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => {
    searchQuery.value = searchInput.value
    reflow()
  }, MOMENTUM_CONFIG.SEARCH_DEBOUNCE_MS)
}
onUnmounted(() => {
  if (searchDebounceTimer !== undefined) clearTimeout(searchDebounceTimer)
})

// Which view+directory the held listing belongs to, and whether the next
// VirtualTable mount must go back to the server. A local re-sort or filter
// change remounts the table (it owns its own row state) but must NOT refetch —
// core returned the whole directory in one call, and refetching on every
// column click would make sorting cost a network round trip per click.
const listingKey = ref('')
let forceRefetch = false
// TWO independent messages, deliberately. A failed *action* (delete refused,
// upload conflict) always triggers a re-read of the listing, and that re-read
// usually succeeds — so a single shared message would clear the action's error
// milliseconds after showing it, which is how "nothing happened, no reason
// given" reaches a user. The listing error clears on every fetch; the action
// error survives until the next action.
const listingError = ref('')
const actionError = ref('')
const uploading = ref(false)

// The registry is filled by scripts the SERVER adds, whose load order relative
// to this bundle is not guaranteed — so a view that is missing at mount is not
// necessarily missing at all. Re-resolve whenever the registry changes.
const stopWatchingRegistry = bridge.onViewsChanged(() => {
  view.value = bridge.view(viewId.value)
})
watch(viewId, (id) => {
  view.value = bridge.view(id)
})

// A "page" here is the whole listing: none of these views is cursor-paginated
// (core's own getContents returns a directory in one call), so VirtualTable
// gets one page and no `next_cursor` — its windowing still applies, which is
// what keeps a 5000-entry folder cheap to render.
async function fetchPage(): Promise<Page> {
  listingError.value = ''
  const key = `${viewId.value}::${dir.value}`
  // Serve the held listing when this mount is a re-render rather than a
  // navigation: same view, same directory, no explicit reload asked for.
  if (!forceRefetch && listing.value && listingKey.value === key) {
    return { items: nodes.value.map(toRow) }
  }
  const controller = new AbortController()
  try {
    const result = await bridge.listContents(viewId.value, dir.value, controller.signal)
    listing.value = result
    listingKey.value = key
    forceRefetch = false
    filters.value = bridge.filters()
    subscribeFilters()
    nodes.value = visibleNodes(result.nodes)
    return { items: nodes.value.map(toRow) }
  } catch (error) {
    nodes.value = []
    listing.value = undefined
    if (error instanceof UnknownViewError) throw error
    listingError.value =
      error instanceof Error ? error.message : t('momentum', 'Could not load this folder')
    return { items: [] }
  }
}

function toRow(node: BridgeNode): TableRow {
  const cells: Record<string, string | number | boolean | null | undefined> = {
    filename: node.basename,
    // VirtualTable renders the file-type icon from this cell (§ File-Type
    // Icons); a folder has no mime of its own, so it gets the directory mime
    // Nextcloud itself uses.
    mime_type: node.type === 'folder' ? 'httpd/unix-directory' : (node.mime ?? ''),
    size: node.type === 'folder' ? null : (node.size ?? null),
    mtime: node.mtime ? node.mtime.toISOString() : null,
  }
  for (const column of view.value?.columns ?? []) {
    cells[column.id] = renderColumnText(column, node, view.value as BridgeView)
  }
  return { id: node.path, cells }
}

// The filter chain, in the registry's own order, then core's comparator. Both
// operate on the nodes the view returned — identity is preserved, so a
// selection survives a re-sort or a filter change.
function visibleNodes(source: BridgeNode[]): BridgeNode[] {
  const filtered = filters.value.reduce((current, filter) => filter.apply(current), source)
  const query = searchQuery.value.trim().toLowerCase()
  const searched = query
    ? filtered.filter((node) => node.basename.toLowerCase().includes(query))
    : filtered
  return bridge.sortNodes(searched, {
    column: sort.value.column as BridgeSortColumn,
    direction: sort.value.direction,
  })
}

// Re-render from the listing we already hold: used by a filter change and by a
// column click, neither of which is a reason to hit the server again.
const reflowKey = ref(0)
function reflow(): void {
  if (!listing.value) return
  nodes.value = visibleNodes(listing.value.nodes)
  // Drop selected rows that the current filter hides: a bulk action must never
  // reach a row the user cannot see.
  const visible = new Set(nodes.value.map((node) => node.path))
  selectedIds.value = selectedIds.value.filter((id) => visible.has(id))
  reflowKey.value += 1
}

function onSortChange(key: string): void {
  const column = key === 'filename' ? 'basename' : key === 'mtime' ? 'mtime' : 'size'
  sort.value =
    sort.value.column === column
      ? { column, direction: sort.value.direction === 'asc' ? 'desc' : 'asc' }
      : { column, direction: 'asc' }
  reflow()
}

// M171.3 (backlog/v1.md Phase 171): the toolbar's narrow-viewport wrap,
// matching the mockup's `.content-toolbar .toolbar-top-row` breakpoint
// (`specs/mockup-ai-document-manager.html`, `max-width: 1023px`). Detected in
// JS rather than left to a CSS `@media` block: as AiStatusStrip.vue's M164.1
// note above documents, this component's test suite runs against jsdom,
// whose CSS engine never evaluates `@media` conditions, so only a JS-toggled
// class is something that suite can actually observe.
const toolbarNarrow = ref(false)
let toolbarNarrowQuery: MediaQueryList | undefined

function updateToolbarNarrow(): void {
  toolbarNarrow.value = toolbarNarrowQuery?.matches ?? false
}

onMounted(() => {
  if (typeof window.matchMedia !== 'function') return
  toolbarNarrowQuery = window.matchMedia('(max-width: 1023px)')
  updateToolbarNarrow()
  toolbarNarrowQuery.addEventListener('change', updateToolbarNarrow)
})

onUnmounted(() => {
  toolbarNarrowQuery?.removeEventListener('change', updateToolbarNarrow)
})

// --- New menu, view actions, selection (frontend.md § Files-app parity) -----
const newMenuEntries = computed(() =>
  listing.value ? bridge.newMenuEntries(listing.value) : [],
)
const selectedNodes = computed(() =>
  nodes.value.filter((node) => selectedIds.value.includes(node.path)),
)
const batchActions = computed(() =>
  selectedNodes.value.length
    ? bridge.batchActionsFor(selectedNodes.value, viewId.value, nodes.value)
    : [],
)

function runNewMenuEntry(entryId: string): void {
  if (!listing.value) return
  actionError.value = ''
  try {
    bridge.runNewMenuEntry(entryId, listing.value)
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : String(error)
  }
}

async function runBatchAction(actionId: string): Promise<void> {
  const selection = selectedNodes.value
  if (!selection.length) return
  actionError.value = ''
  try {
    const results = await bridge.runBatchAction(actionId, selection, viewId.value, nodes.value)
    const failed = results.filter((result) => result === false).length
    if (failed > 0) {
      // Never reported as a plain success: a batch that half-worked is the
      // case a user most needs told about.
      actionError.value = t('momentum', 'Some items could not be processed')
    }
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : String(error)
  } finally {
    selectedIds.value = []
    reloadListing()
  }
}

// An explicit re-read: Reload, or after an action whose effect on the listing
// only the server knows.
function reloadListing(): void {
  forceRefetch = true
  reloadKey.value += 1
}

const columns = computed<ColumnDef[]>(() => [
  { key: 'filename', label: t('momentum', 'Name'), dataType: 'string', sortable: true, defaultVisible: true },
  {
    key: 'size',
    label: t('momentum', 'Size'),
    dataType: 'int64',
    sortable: true,
    defaultVisible: true,
    // Phase 146: `54 KB` / `1 MB`, not the raw byte count `formatCellValue`
    // would locale-group.
    byteSize: true,
  },
  {
    key: 'mtime',
    label: t('momentum', 'Modified'),
    dataType: 'date',
    sortable: true,
    defaultVisible: true,
    // Phase 146: `3 hours ago` / `yesterday`, not the absolute date
    // `formatCellValue` would render.
    relativeDate: true,
  },
  // The view's OWN columns, verbatim from the registry — this is how Trash
  // shows Original location / Deleted by / Deleted without this app knowing
  // those columns exist.
  ...(view.value?.columns ?? []).map((column) => ({
    key: column.id,
    label: column.title,
    dataType: 'string' as const,
    defaultVisible: true,
  })),
])

// The grid's own rows: the exact same shape VirtualTable renders as a table
// (`toRow`, above), fed from the same `nodes` — the grid never fetches or
// filters/sorts on its own, so table and grid always agree on what's shown.
const gridRows = computed(() => nodes.value.map(toRow))

// Breadcrumb segments for the current directory, so a user can get back up.
// `/` renders as the view's own name.
const breadcrumbs = computed(() => {
  const segments = dir.value.split('/').filter(Boolean)
  return segments.map((segment, index) => ({
    name: segment,
    dir: `/${segments.slice(0, index + 1).join('/')}`,
  }))
})

function nodeFor(rowId: string): BridgeNode | undefined {
  return nodes.value.find((node) => node.path === rowId)
}

function goTo(newDir: string): void {
  void router.push({ name: 'file-browser', params: { viewId: viewId.value }, query: { dir: newDir } })
}

// Phase 145 — All files / Recent / Favorites are the same table under a
// different filter, so they render as tabs here rather than as separate nav
// entries (AppNavigation.vue); the ROUTE for each (`/browse/files`,
// `/browse/recent`, `/browse/favorites`) is unchanged, a tab is just a link to
// it. Labels are hardcoded (not read from the registry's own view names) so
// the strip always reads "All files / Recent / Favorites" regardless of what
// a given Nextcloud version happens to call the underlying view.
const TAB_LABELS: Record<string, () => string> = {
  files: () => t('momentum', 'All files'),
  recent: () => t('momentum', 'Recent'),
  favorites: () => t('momentum', 'Favorites'),
}
const showTabs = computed(() => FILE_BROWSER_TAB_VIEW_IDS.includes(viewId.value))
function tabLabel(id: string): string {
  return TAB_LABELS[id]?.() ?? id
}
function goToTab(id: string): void {
  if (id === viewId.value) return
  void router.push({ name: 'file-browser', params: { viewId: id } })
}

// frontend.md § Opening a file (M127.3). A file row opens the SAME split view
// the Documents table opens — preview left, extracted fields right — whenever
// that file has a document. All the bridge has is a Nextcloud fileId, so the
// click resolves it through GET /documents/by-file/{file_id}.
//
// No document (`undefined`, i.e. a 404) is the ordinary case, not a failure:
// most files in an account are not Doc-Mgr documents, and a just-ingested one
// is `pending` for a while. Those fall back to Nextcloud's own previewer —
// exactly what this page did before — silently. A failed REQUEST is the
// opposite: the user asked for something and we could not tell whether there
// was a document, so that surfaces on the action-error line.
async function onRowClick(rowId: string): Promise<void> {
  const node = nodeFor(rowId)
  if (!node) return
  if (node.type === 'folder') {
    goTo(node.path)
    return
  }
  if (node.fileid === undefined) {
    // A node with no fileid cannot be resolved (nothing in the registry's own
    // views lacks one today; a future view might).
    openInViewer(node)
    return
  }

  actionError.value = ''
  try {
    const document = await fetchDocumentByFileId(node.fileid)
    if (!document?.public_id) {
      openInViewer(node)
      return
    }
    void router.push({ name: 'document-viewer', params: { docId: document.public_id } })
  } catch (error) {
    actionError.value =
      error instanceof Error
        ? t('momentum', 'Could not check whether this file has a document: {reason}', {
            reason: error.message,
          })
        : String(error)
  }
}

interface NcViewerService {
  open: (options: { path: string }) => void
}

function getNcViewer(): NcViewerService | undefined {
  return (globalThis as { OCA?: { Viewer?: NcViewerService } }).OCA?.Viewer
}

function openInViewer(node: BridgeNode): void {
  const viewer = getNcViewer()
  if (!viewer) {
    actionError.value = t('momentum', 'Preview is unavailable on this page')
    return
  }
  viewer.open({ path: node.path })
}

function actionsFor(rowId: string) {
  const node = nodeFor(rowId)
  return node ? bridge.actionsFor(node, viewId.value, nodes.value) : []
}

// M174.5: Nextcloud marks some file actions for INLINE presentation — the row
// icon itself IS the action's presentation, which is why their `displayName`
// deliberately returns "" (bridge.actionsFor's `inline` flag, ncFilesBridge.ts
// § RawAction). Rendering them in the overflow menu produced two blank,
// unnamed clickable rows (measured live: sharing-status, system-tags); they
// belong beside the menu trigger as named icon buttons instead.
// M177.4: NC's `system-tags` action declares `inline: true` but its
// `iconSvgInline` is an EMPTY STRING — the row icon IS the action's whole
// presentation, so with no icon there is nothing to show and the control is
// just an invisible clickable box. An inline action only earns a row control
// when it actually has an icon to render; one that doesn't falls back to the
// overflow menu, mirroring how `isInlineAction` already falls an
// unevaluatable inline predicate back to the menu rather than dropping the
// action (ncFilesBridge.ts, `isInlineAction`).
function hasInlineIcon(action: { inline: boolean; iconSvgInline?: string }): boolean {
  return action.inline && !!action.iconSvgInline
}

// M183.1: `inline`/`renderInline` are predicates Nextcloud evaluates WITH A
// CONTEXT, and in core's Files app that context carries the view — its grid
// renderer presents no inline action on a tile, it demotes the whole inline
// set into the tile's overflow menu (measured on this instance: NC Files'
// "Opciones de compartir" is an inline row control in list view and a menu
// entry in grid view). The mockup's two templates say the same thing: only
// `td.col-actions` carries `person_add`, never `.grid-tile`. The split is
// therefore a property of the SURFACE rendering it, not of the action — so
// these take the surface rather than testing any action id, and an inline
// action Nextcloud adds later is demoted on the tile for free.
type ActionSurface = 'table' | 'tile'

function menuActionsFor(rowId: string, surface: ActionSurface) {
  const actions = actionsFor(rowId)
  // Demoted, never dropped: on a tile the whole set is reachable from the
  // overflow menu, labelled through `inlineActionLabel` so an inline action's
  // deliberately-empty `displayName` still renders a real name there.
  return surface === 'tile' ? actions : actions.filter((action) => !hasInlineIcon(action))
}

function inlineActionsFor(rowId: string, surface: ActionSurface) {
  return surface === 'tile' ? [] : actionsFor(rowId).filter((action) => hasInlineIcon(action))
}

// Nextcloud's inline actions supply no display name by design (see above), so
// this app owns a fallback label per known action id — otherwise the row icon
// would have no accessible name, the exact defect this milestone exists to
// fix. Falls back to the action's own id for an inline action Nextcloud adds
// later that this list has not been updated for yet: still non-empty, never
// blank.
const INLINE_ACTION_LABELS: Record<string, () => string> = {
  'comments-unread': () => t('momentum', 'Unread comments'),
  'reminder-status': () => t('momentum', 'Reminder'),
  'accept-share': () => t('momentum', 'Accept share'),
  'reject-share': () => t('momentum', 'Reject share'),
  'restore-share': () => t('momentum', 'Restore share'),
  'sharing-status': () => t('momentum', 'Sharing status'),
  restore: () => t('momentum', 'Restore'),
  lock_inline: () => t('momentum', 'Locked'),
  'system-tags': () => t('momentum', 'Tags'),
}

function inlineActionLabel(action: { id: string; label: string }): string {
  return action.label || INLINE_ACTION_LABELS[action.id]?.() || action.id
}

const reloadKey = ref(0)

async function runAction(actionId: string, rowId: string): Promise<void> {
  const node = nodeFor(rowId)
  if (!node) return
  actionError.value = ''
  try {
    await bridge.runAction(actionId, node, viewId.value, nodes.value)
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : String(error)
  } finally {
    // An action that deletes, restores or renames changes the listing; core
    // owns the operation, so re-reading is the only way to know the result.
    // MUST be reloadListing(), not a bare remount: a remount alone is served
    // from the held listing (see fetchPage's cache) and would show the file
    // still there after a successful delete.
    reloadListing()
  }
}

// M177.3 (backlog/v1.md Phase 177): the shared Files sidebar STORE
// (`bridge.openSidebar`) reaches `isOpen: true` with the right node and tab,
// but nothing on this page ever rendered it — the real sidebar UI lives in
// the Files app's own bundle, which never mounts here. This page owns its
// own rendering (`FilesSidebar.vue`) driven by the SAME tabs the shared
// registry returns (`bridge.sidebarTabsFor`), so `momentum-nl` becomes
// reachable rather than merely registered.
const sidebarNode = ref<BridgeNode | undefined>(undefined)
const sidebarTabs = ref<BridgeSidebarTab[]>([])
const sidebarActiveTab = ref('')

function closeSidebar(): void {
  sidebarNode.value = undefined
  sidebarTabs.value = []
  bridge.closeSidebar()
}

async function openSidebar(rowId: string): Promise<void> {
  const node = nodeFor(rowId)
  if (!node) return
  try {
    // Opens straight to our own tab (M174.7) — the affordance that makes
    // `momentum-nl` reachable, distinct from NC's own `Details` action, which
    // opens on its own default tab.
    bridge.openSidebar(node, 'momentum-nl')
    sidebarTabs.value = await bridge.sidebarTabsFor(node)
    sidebarActiveTab.value = 'momentum-nl'
    sidebarNode.value = node
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : String(error)
  }
}

const canUpload = computed(() => bridge.canUpload(viewId.value))
const fileInput = ref<HTMLInputElement | null>(null)

// M149.2 (backlog/v1.md) — AI status strip (frontend.md § Processing
// progress: the AI status strip). `null` hides it. Driven purely by polling
// `GET /stats/overview`'s pending+processing counts, independent of how a
// document got ingested (this page's own upload button, the native Files
// app, a WebDAV sync client, …): whenever anything in the tenant is
// mid-pipeline, the strip shows it. Tenant-wide, so it starts on mount and is
// never tied to this page's own upload action.
const aiStrip = ref<{ total: number; done: number; stale: boolean } | null>(null)

// `total`/`done` since the strip last went idle. `total` only ever grows —
// `Math.max(total, inFlight + done)` — because `inFlight` alone can go UP as
// well as down (documents arriving mid-batch, not just finishing), so a peak
// tracked only against `inFlight` regresses `done` the moment a fresh arrival
// pushes `inFlight` back up without also raising the peak past its old high
// (M157.1 — see specs/frontend.md § Processing progress: the AI status strip
// for the worked example this formula was validated against).
let total = 0
let done = 0
// Consecutive poll failures since the last success. Distinguishes a stuck
// pipeline (data fresh, work genuinely stalled — kept visible indefinitely,
// see frontend.md) from a blind poller (data stale, work state unknown) —
// after MOMENTUM_CONFIG.AI_STRIP_STALE_AFTER_FAILURES misses in a row the
// strip stops asserting a count it can no longer substantiate.
let consecutiveFailures = 0
let statsPollTimer: ReturnType<typeof setInterval> | undefined

async function pollStatsOverview(): Promise<void> {
  let overview
  try {
    overview = await fetchStatsOverview()
  } catch {
    consecutiveFailures += 1
    if (aiStrip.value && consecutiveFailures >= MOMENTUM_CONFIG.AI_STRIP_STALE_AFTER_FAILURES) {
      aiStrip.value = { total, done, stale: true }
    }
    return
  }
  consecutiveFailures = 0
  const inFlight = (overview.statuses ?? [])
    .filter((status) => status.status === 'pending' || status.status === 'processing')
    .reduce((sum, status) => sum + (status.total ?? 0), 0)
  if (inFlight === 0) {
    total = 0
    done = 0
    aiStrip.value = null
    return
  }
  total = Math.max(total, inFlight + done)
  done = total - inFlight
  aiStrip.value = { total, done, stale: false }
}

statsPollTimer = setInterval(() => void pollStatsOverview(), MOMENTUM_CONFIG.AI_STRIP_POLL_INTERVAL_MS)
void pollStatsOverview()

onUnmounted(() => {
  if (statsPollTimer !== undefined) clearInterval(statsPollTimer)
})

// M148.1 (backlog/v1.md Phase 148): the mockup's "Add documents / or drop
// files here" zone. This is an INPUT AFFORDANCE onto the upload path that
// already exists above (onFilesPicked) — a drop calls the exact same
// function a file-input change does, never a second transfer mechanism.
//
// `dragDepth` rather than a bare boolean: the drop zone wraps the toolbar,
// tabs and table, so the pointer crosses in/out of many child elements while
// staying inside the zone, and each crossing fires its own dragenter/
// dragleave pair. A bare boolean would flicker the overlay off every time the
// pointer passed over a child; a depth counter only clears it once the
// pointer has actually left every nested element.
const isDragOver = ref(false)
let dragDepth = 0

function onDragEnter(event: DragEvent): void {
  if (!canUpload.value) return
  event.preventDefault()
  dragDepth += 1
  isDragOver.value = true
}

function onDragOver(event: DragEvent): void {
  if (!canUpload.value) return
  // A browser only fires `drop` if `dragover` calls preventDefault — without
  // this the drop is rejected and the browser navigates to the file instead.
  event.preventDefault()
}

function onDragLeave(event: DragEvent): void {
  if (!canUpload.value) return
  event.preventDefault()
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) isDragOver.value = false
}

async function onDrop(event: DragEvent): Promise<void> {
  dragDepth = 0
  isDragOver.value = false
  if (!canUpload.value) return
  event.preventDefault()
  await onFilesPicked(event.dataTransfer?.files ?? null)
}

async function onFilesPicked(files: FileList | null): Promise<void> {
  if (!files?.length) return
  uploading.value = true
  actionError.value = ''
  try {
    for (const file of Array.from(files)) {
      await bridge.uploadFile(viewId.value, dir.value, file)
    }
    reloadListing()
  } catch (error) {
    actionError.value =
      error instanceof UploadConflictError
        ? t('momentum', 'A file with that name already exists here')
        : error instanceof Error
          ? error.message
          : String(error)
  } finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

const activeSort = computed<SortState>(() => ({
  column:
    sort.value.column === 'basename' ? 'filename' : sort.value.column === 'mtime' ? 'mtime' : 'size',
  direction: sort.value.direction,
}))

// VirtualTable owns its own fetch/scroll state, so a view or directory change —
// and a local re-sort/filter, which changes the row set it already holds — has
// to remount it rather than mutate it underneath.
const tableKey = computed(
  () => `${viewId.value}::${dir.value}::${reloadKey.value}::${reflowKey.value}`,
)

// A selection only ever means something for the listing it was made in.
watch([viewId, dir], () => {
  selectedIds.value = []
  closeSidebar()
})

defineExpose({ stopWatchingRegistry })
</script>

<template>
  <div class="momentum-page momentum-page--file-browser">
    <NcEmptyContent
      v-if="!view"
      data-testid="file-browser-unknown-view"
      :name="t('momentum', 'This location is not available')"
      :description="viewId" />
    <template v-else>
      <!-- M148.1: the whole browsing area is the drop target, matching the
           mockup's "or drop files here" affordance — a user dragging a file
           does not have to find a specific corner of the page. -->
      <div
        class="momentum-page__drop-zone"
        :class="{ 'momentum-page__drop-zone--active': isDragOver }"
        data-testid="file-browser-drop-zone"
        @dragenter="onDragEnter"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop">
      <div
        class="momentum-page__toolbar"
        :class="{ 'momentum-page__toolbar--narrow': toolbarNarrow }">
        <!-- M161.4 (backlog/v1.md Phase 161): replaces both the "All files"
             NcActions view-menu and NcBreadcrumbs' first crumb — the two
             components that each rendered the view's name, producing "All
             files" twice in a row. Reverses M124.2, on purpose, at the
             operator's request (2026-09-03): Reload and the view's own
             file-list actions (core registers "Empty deleted files" on
             Trash) went with the removed menu, and the mockup
             (`mockup:3502`) has no equivalent surface for either. Upward
             navigation is kept — see `breadcrumbs` below — the mockup keeps
             crumbs inside a subfolder (`mockup:3496`).
             M171.3 (backlog/v1.md Phase 171): the heading/breadcrumb comes
             FIRST in source order, with "New" moved after it below — the
             mockup's `.toolbar-top-row` has `#breadcrumbs` as its first child
             and the New button's wrapper as its last, so this also fixes
             reading/focus order to match, not just visual position.
             M178.4 (backlog/v1.md Phase 178): ONE component for this row in
             BOTH the root and subfolder states, not a bespoke root heading
             next to NcBreadcrumbs for everywhere else. The two used to
             diverge visually even though they looked alike: NcBreadcrumbs
             wraps every crumb — including its own root/home one — in an
             NcButton sized to `--default-clickable-area` with the icon
             centred inside, while the bespoke root `<div>` put its FolderIcon
             directly at the row's edge with no such reservation, so the root
             route's visible content started 34px left of the same row on a
             folder route. Rendering the root through NcBreadcrumbs too (a
             root is just a one-crumb path) makes the two states share the
             exact same inset by construction, rather than by a margin tuned
             to match it. The home crumb keeps its accessible name via
             NcBreadcrumbs' `rootIcon` default (`icon-home`, unused visually
             once the `#icon` slot below wins, but still what drives
             NcBreadcrumb's own aria-label-from-icon-prop check). -->
        <NcBreadcrumbs data-testid="file-browser-heading">
          <NcBreadcrumb :name="t('momentum', 'Files')" @click="goTo('/')">
            <template #icon>
              <FolderIcon :size="20" />
            </template>
          </NcBreadcrumb>
          <NcBreadcrumb
            v-for="crumb in breadcrumbs"
            :key="crumb.dir"
            :name="crumb.name"
            @click="goTo(crumb.dir)" />
        </NcBreadcrumbs>

        <span class="momentum-page__toolbar-spacer" />

        <!-- "New" — core's own new-file menu (frontend.md § Files-app parity),
             with this app's upload as its upload-from-device entry so New is
             the single creation affordance. Entries come from the registry, so
             an entry a later Nextcloud or a third-party app registers appears
             here with no change. -->
        <!-- force-menu: with a single entry NcActions would otherwise render
             that entry inline INSTEAD of a menu, so "New" would disappear as a
             button and the one entry would take its place — confirmed while
             building this (an NcActions holding only the upload entry rendered
             neither a menu nor the entry). The mockup shows "New ▾" as a menu
             regardless of how many entries it holds. -->
        <NcActions
          data-testid="file-browser-new"
          type="primary"
          force-menu
          :menu-name="t('momentum', 'New')"
          :aria-label="t('momentum', 'New')">
          <NcActionButton
            v-if="canUpload"
            data-testid="file-browser-upload"
            :disabled="uploading"
            @click="fileInput?.click()">
            {{ uploading ? t('momentum', 'Uploading …') : t('momentum', 'Upload files') }}
          </NcActionButton>
          <NcActionButton
            v-for="entry in newMenuEntries"
            :key="entry.id"
            :data-testid="`file-browser-new-${entry.id}`"
            @click="runNewMenuEntry(entry.id)">
            {{ entry.label }}
          </NcActionButton>
        </NcActions>

        <!-- Hidden native input, driven by the NcButton above: NC has no file
             picker primitive, and this is never rendered as a bare form
             control to the user (CLAUDE.md § UI component priority). -->
        <input
          ref="fileInput"
          type="file"
          multiple
          class="momentum-page__file-input"
          data-testid="file-browser-file-input"
          @change="onFilesPicked(($event.target as HTMLInputElement).files)" />
      </div>

      <!-- Phase 146 / M171.2: the count of rows currently loaded/filtered, i.e.
           exactly what the table below is showing — never a corpus total we
           cannot know (the M33.6 first-page-only notice above already says
           when a sort has capped what's loaded; this label must not repeat or
           contradict that). Rendered above the tabs (mockup order) rather
           than moving the tabs themselves — see M171.2's note in
           backlog/v1.md: the tabs' position must stay independent of the
           AI strip's v-if (M158.1/M158.3), so only the count moves. -->
      <p
        v-if="!listingError"
        class="momentum-page__item-count"
        data-testid="file-browser-item-count">
        {{ n('momentum', '%n item', '%n items', nodes.length) }}
      </p>

      <!-- M158.1: tabs render BEFORE the AI strip so their vertical position
           never depends on pipeline activity (the strip is v-if-gated on
           aiStrip and would otherwise shift the tabs by 41px whenever it
           appears/disappears — see the phase notes in backlog/v1.md). -->
      <div v-if="showTabs" class="momentum-page__tabs-row">
        <div class="momentum-page__tabs" role="tablist" data-testid="file-browser-tabs">
          <NcButton
            v-for="id in FILE_BROWSER_TAB_VIEW_IDS"
            :key="id"
            :variant="id === viewId ? 'primary' : 'tertiary'"
            role="tab"
            :aria-selected="id === viewId"
            :data-testid="`file-browser-tab-${id}`"
            @click="goToTab(id)">
            {{ tabLabel(id) }}
          </NcButton>
        </div>

        <!-- M161.3 (backlog/v1.md Phase 161): filters `nodes` LOCALLY over the
             listing already loaded — never a request (see `visibleNodes`
             above). A sibling of the tab strip, not a child: the strip
             carries role="tablist" and a textbox inside a tablist is an ARIA
             violation. -->
        <NcTextField
          type="search"
          class="momentum-page__search"
          :label="t('momentum', 'Search by file name')"
          :placeholder="t('momentum', 'Search by file name')"
          :model-value="searchInput"
          data-testid="file-browser-search"
          @update:model-value="onSearchInput" />
      </div>

      <AiStatusStrip
        v-if="aiStrip"
        data-testid="file-browser-ai-strip"
        class="momentum-page__ai-strip"
        :total="aiStrip.total"
        :done="aiStrip.done"
        :stale="aiStrip.stale" />

      <p
        v-if="listingError || actionError"
        data-testid="file-browser-error"
        class="momentum-page__error">
        {{ [listingError, actionError].filter(Boolean).join(' — ') }}
      </p>

      <div
        v-if="selectedIds.length"
        class="momentum-page__selection-bar"
        data-testid="file-browser-selection-bar">
        <span data-testid="file-browser-selection-count">
          {{ n('momentum', '%n selected', '%n selected', selectedIds.length) }}
        </span>
        <NcActions force-menu :aria-label="t('momentum', 'Actions for the selection')">
          <NcActionButton
            v-for="action in batchActions"
            :key="action.id"
            :data-testid="`file-browser-batch-${action.id}`"
            @click="runBatchAction(action.id)">
            {{ action.label }}
          </NcActionButton>
        </NcActions>
        <NcButton data-testid="file-browser-clear-selection" @click="selectedIds = []">
          {{ t('momentum', 'Clear selection') }}
        </NcButton>
      </div>

      <!-- The table stays mounted always: it is what actually fetches (see
           fetchPage/VirtualTable's onMounted), so hiding it via `v-if` instead
           would strand the grid with no data on first navigation into grid
           mode. `hide-body` (M161.2, backlog/v1.md Phase 161) — not `v-show`
           on the whole component — hides only the row/skeleton/empty area in
           grid mode: the header (and the view toggle inside it, via
           `header-extra`) must stay rendered, or the control that switches
           back out of grid mode leaves with the table it's inside. The grid
           needs no such guard — `gridRows` is a computed over `nodes`,
           populated independently of VirtualTable — so it mounts only in grid
           mode (`v-if`, M147.1's unwindowed `v-for` is otherwise ~17 DOM nodes
           and a menu per row, hidden or not). -->
      <VirtualTable
        :key="tableKey"
        :columns="columns"
        :fetch-page="fetchPage"
        :active-sort="activeSort"
        :hide-body="viewMode === 'grid'"
        selectable
        :selected-ids="selectedIds"
        @sort-change="onSortChange"
        @selection-change="selectedIds = $event"
        @row-click="(id) => void onRowClick(id)">
        <template #header-extra>
          <!-- Table/grid toggle (M147.1, backlog/v1.md Phase 147; moved into
               the table header by M161.2), matching
               specs/mockup-ai-document-manager.html's `#grid-toggle`/
               `th.col-view` position. -->
          <NcButton
            variant="tertiary"
            data-testid="file-browser-view-toggle"
            :aria-pressed="viewMode === 'grid'"
            :aria-label="
              viewMode === 'grid' ? t('momentum', 'Switch to list view') : t('momentum', 'Switch to grid view')
            "
            @click="viewMode = viewMode === 'grid' ? 'table' : 'grid'">
            <template #icon>
              <ViewListIcon v-if="viewMode === 'grid'" :size="20" />
              <ViewGridIcon v-else :size="20" />
            </template>
          </NcButton>
        </template>
        <template #empty>
          <NcEmptyContent :name="view.emptyTitle || t('momentum', 'Nothing here')" />
        </template>
        <template #row-actions="{ row }">
          <div class="momentum-row-actions">
            <NcButton
              v-for="action in inlineActionsFor(row.id, 'table')"
              :key="action.id"
              variant="tertiary"
              :data-testid="`file-browser-action-${action.id}`"
              :aria-label="inlineActionLabel(action)"
              @click="runAction(action.id, row.id)">
              <template #icon>
                <span class="momentum-row-actions__icon" v-html="action.iconSvgInline" />
              </template>
            </NcButton>
            <NcActions force-menu :aria-label="t('momentum', 'Actions')">
              <template #icon>
                <DotsVerticalIcon :size="20" />
              </template>
              <NcActionButton
                v-if="bridge.sidebarAvailable()"
                data-testid="file-browser-details"
                @click="openSidebar(row.id)">
                {{ t('momentum', 'Open details') }}
              </NcActionButton>
              <NcActionButton
                v-for="action in menuActionsFor(row.id, 'table')"
                :key="action.id"
                :data-testid="`file-browser-action-${action.id}`"
                @click="runAction(action.id, row.id)">
                {{ inlineActionLabel(action) }}
              </NcActionButton>
            </NcActions>
          </div>
        </template>
      </VirtualTable>
      <FileTileGrid
        v-if="viewMode === 'grid'"
        :rows="gridRows"
        :selected-ids="selectedIds"
        @selection-change="selectedIds = $event"
        @row-click="(id) => void onRowClick(id)">
        <template #empty>
          <NcEmptyContent :name="view.emptyTitle || t('momentum', 'Nothing here')" />
        </template>
        <template #row-actions="{ row }">
          <div class="momentum-row-actions">
            <NcButton
              v-for="action in inlineActionsFor(row.id, 'tile')"
              :key="action.id"
              variant="tertiary"
              :data-testid="`file-browser-action-${action.id}`"
              :aria-label="inlineActionLabel(action)"
              @click="runAction(action.id, row.id)">
              <template #icon>
                <span class="momentum-row-actions__icon" v-html="action.iconSvgInline" />
              </template>
            </NcButton>
            <NcActions force-menu :aria-label="t('momentum', 'Actions')">
              <template #icon>
                <DotsVerticalIcon :size="20" />
              </template>
              <NcActionButton
                v-if="bridge.sidebarAvailable()"
                data-testid="file-browser-details"
                @click="openSidebar(row.id)">
                {{ t('momentum', 'Open details') }}
              </NcActionButton>
              <NcActionButton
                v-for="action in menuActionsFor(row.id, 'tile')"
                :key="action.id"
                :data-testid="`file-browser-action-${action.id}`"
                @click="runAction(action.id, row.id)">
                {{ inlineActionLabel(action) }}
              </NcActionButton>
            </NcActions>
          </div>
        </template>
      </FileTileGrid>

      <!-- M148.1: purely visual — the drop is already handled by the wrapping
           div's @drop above regardless of whether this renders. jsdom cannot
           prove this paints correctly; that is the operator's live check
           (Phase 148 notes), not this component's. -->
      <div
        v-if="isDragOver && canUpload"
        class="momentum-page__drop-overlay"
        data-testid="file-browser-drop-overlay">
        <CloudUploadOutlineIcon :size="32" />
        <p>{{ t('momentum', 'Drop files here to upload') }}</p>
      </div>
      </div>

      <FilesSidebar
        :node="sidebarNode"
        :tabs="sidebarTabs"
        :active-tab="sidebarActiveTab"
        @update:active-tab="sidebarActiveTab = $event"
        @close="closeSidebar" />
    </template>
  </div>
</template>

<style scoped>
.momentum-page--file-browser {
  display: flex;
  flex-direction: column;
  /* Bounded height so VirtualTable's own body is the scroller, never NC's
     content pane — the Phase 93 regression this project already paid for
     once (M93.1/M93.2). */
  height: 100%;
  min-height: 0;
}

.momentum-page__toolbar {
  display: flex;
  align-items: center;
  /* One row above the M171.3 breakpoint below. The breadcrumbs are what
     shrinks (min-width: 0 below) — the menus and the filters keep their
     size. */
  flex-wrap: nowrap;
  gap: var(--default-grid-baseline, 4px);
  padding: calc(var(--default-grid-baseline, 4px) * 2);
  /* Reserve NcAppContent's collapse-navigation toggle footprint (a
     --default-clickable-area square in the content pane's top-left corner —
     backlog Phase 75/90, M75.1/M90.1). This page has no heading row above the
     toolbar, so the toolbar is the element sharing the toggle's band, exactly
     like RecentDocumentsPage's. Found live: the toggle sat on top of the first
     breadcrumb, and Playwright refused to click it because the toggle's icon
     intercepted the pointer — the same class of defect M75.2's check exists
     for. Must be `margin`, not `padding`: padding moves the visible content
     but not the element's own bounding box, which is what that check
     measures. Retained-but-inert since Phase 174 (M174.1): the toggle's
     global offset that made this necessary was DocumentViewerPage's own
     non-`scoped` rule leaking onto every route, not a platform fact — M174.1
     anchored that rule to the viewer route only, so the toggle no longer
     reaches this band and this margin no longer does anything. Left in place
     rather than removed because retiring it needs its own five-route
     no-op check, out of scope for M174.1 — do not treat its presence as
     evidence the offset is still real. */
  margin-inline-start: var(--default-clickable-area, 44px);
}

/* M171.3: matches the mockup's `.content-toolbar .toolbar-top-row` narrow
   breakpoint (`specs/mockup-ai-document-manager.html`, `max-width: 1023px`),
   toggled by `toolbarNarrow` above rather than a CSS `@media` block. With
   the breadcrumb and "New" now at opposite ends of the row (spaced by
   `.momentum-page__toolbar-spacer`), a narrow viewport has nowhere to shrink
   the spacer to — wrapping lets "New" drop to its own line instead of
   crushing the breadcrumb against it. */
.momentum-page__toolbar--narrow {
  flex-wrap: wrap;
  row-gap: calc(var(--default-grid-baseline, 4px) * 2.2);
}

.momentum-page__toolbar-spacer {
  flex: 1 1 auto;
}

/* M161.3: wraps the tab strip and the file-name search field as siblings —
   the search field is NOT inside .momentum-page__tabs' role="tablist", a
   textbox is not a tab. */
.momentum-page__tabs-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--default-grid-baseline, 4px);
  padding: 0 calc(var(--default-grid-baseline, 4px) * 2)
    calc(var(--default-grid-baseline, 4px) * 2);
  /* M158.2 added a margin here matching .momentum-page__toolbar's
     (M75.1/M90.1) collapse-navigation-toggle reservation, on the reasoning
     that with the AI strip rendered after the tabs (M158.1), the tab strip
     was the row sharing the toggle's band. M171.2 (backlog Phase 171) moved
     the item count above the tab strip, into that band instead — measured
     live (backlog Phase 178, M178.3) at y=131..179 vs. the toggle's
     y=58..92, the tab strip no longer overlaps the toggle at all, so this
     margin was reserving footprint for a control it cannot collide with.
     Removed; .momentum-page__toolbar above still needs its own margin and
     still overlaps the toggle — that one is untouched. */
}

.momentum-page__tabs {
  display: flex;
  align-items: center;
  gap: var(--default-grid-baseline, 4px);
}

.momentum-page__search {
  flex: 0 1 260px;
}

/* M174.5: inline file actions (a named icon button per action, e.g. NC's
   `sharing-status`/`system-tags`) sit beside the overflow-menu trigger inside
   the same `#row-actions` slot cell. */
.momentum-row-actions {
  display: flex;
  align-items: center;
  gap: var(--default-grid-baseline, 4px);
}

/* M181.5: `action.iconSvgInline` above is raw markup handed over by Nextcloud's
   action registry (`v-html`, unavoidable — the host owns that SVG). Unlike a
   `vue-material-design-icons` component (e.g. `DotsVerticalIcon`, its sibling
   in this same row), the host's `<svg>` carries no width/height/class, so with
   no fix it collapses to a 0x0, black-fill rect. We supply what the component
   would have: an explicit size matching the sibling icon's `:size="20"`, and
   `currentColor` plus a `color` here so it follows the theme instead of a
   hardcoded fill. */
.momentum-row-actions__icon {
  display: flex;
  color: var(--color-main-text);
}

.momentum-row-actions__icon :deep(svg) {
  width: 20px;
  height: 20px;
  fill: currentColor;
}

.momentum-page__ai-strip {
  margin: 0 calc(var(--default-grid-baseline, 4px) * 2) calc(var(--default-grid-baseline, 4px) * 2);
}

/* Lets a long path shorten instead of squeezing the filters into a column. */
.momentum-page__toolbar :deep(.breadcrumb) {
  min-width: 0;
  overflow: hidden;
}

.momentum-page__item-count {
  margin: 0;
  padding: 0 calc(var(--default-grid-baseline, 4px) * 2) calc(var(--default-grid-baseline, 4px) * 2);
  font-size: var(--default-font-size, 15px);
  color: var(--color-text-maxcontrast);
}

.momentum-page__selection-bar {
  display: flex;
  align-items: center;
  gap: var(--default-grid-baseline, 4px);
  padding: 0 calc(var(--default-grid-baseline, 4px) * 2)
    calc(var(--default-grid-baseline, 4px) * 2);
}

.momentum-page__file-input {
  display: none;
}

.momentum-page__error {
  padding: 0 calc(var(--default-grid-baseline, 4px) * 2);
  color: var(--color-error-text, var(--color-error));
}

.momentum-page__drop-zone {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

.momentum-page__drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--default-grid-baseline, 4px);
  /* Never itself a drag target: without this the overlay becomes the element
     dragenter/dragleave fire on, which would fight the drop-zone's own depth
     counter for what "still inside" means. */
  pointer-events: none;
  background: var(--color-main-background, #fff);
  opacity: 0.92;
  border: 2px dashed var(--color-primary-element, var(--color-accent, #00679e));
  border-radius: var(--border-radius-large, 8px);
  color: var(--color-primary-element, var(--color-accent, #00679e));
  font-weight: 600;
}
</style>
