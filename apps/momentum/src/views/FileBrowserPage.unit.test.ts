import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import DotsVerticalIcon from 'vue-material-design-icons/DotsVertical.vue'
import FileBrowserPage from './FileBrowserPage.vue'
import {
  CONSOLIDATED_FILE_VIEW_IDS,
  UnknownViewError,
  UploadConflictError,
  toBridgeNode,
} from '../services/ncFilesBridge'
import { ncFilesBridge } from '../services/ncFilesBridgeRuntime'
import * as documentsService from '../services/documents'
import { router as appRouter } from '../router/index'
import { MOMENTUM_CONFIG } from '../config'
import type { Bridge, BridgeNode, BridgeView } from '../services/ncFilesBridge'

// frontend.md § Files & Shares Bridge — one page for every Nextcloud file
// view. Everything Nextcloud-side is behind the bridge, so these tests fake
// the bridge and assert what the PAGE does with it: which rows, which
// navigation, which affordances. What they cannot prove (that the registry is
// populated, that a view returns nodes at all) is M123.4's live check.
//
// A factory mock, not an automock: automocking would import the real runtime
// module, which pulls in `@nextcloud/files/dav` → `webdav`, not loadable here.
vi.mock('../services/ncFilesBridgeRuntime', () => ({
  ncFilesBridge: vi.fn(),
  setNcFilesBridgeForTesting: vi.fn(),
}))
// M127.3: a file click resolves its fileId to a document before deciding what
// to open, so the lookup is mocked here.
vi.mock('../services/documents')

const FILES_VIEW: BridgeView = { id: 'files', name: 'All files', columns: [] }

function node(path: string, type: 'file' | 'folder', extra: Record<string, unknown> = {}): BridgeNode {
  return toBridgeNode({
    path,
    basename: path.split('/').filter(Boolean).pop() ?? '',
    type,
    mime: type === 'file' ? 'application/pdf' : undefined,
    ...extra,
  })
}

function fakeBridge(overrides: Partial<Bridge> = {}): Bridge {
  return {
    views: () => [FILES_VIEW],
    navTree: () => [{ view: FILES_VIEW, children: [] }],
    view: (id: string) => (id === FILES_VIEW.id ? FILES_VIEW : undefined),
    listContents: async () => ({ folderPath: '/', nodes: [], folderRaw: { path: '/' } }),
    actionsFor: () => [],
    runAction: async () => true,
    sidebarAvailable: () => false,
    openSidebar: () => {},
    sidebarTabsFor: async () => [],
    closeSidebar: () => {},
    canUpload: () => false,
    uploadFile: async () => {},
    onViewsChanged: () => () => {},
    // M124.1 surfaces. Defaults are "nothing registered", so a test that cares
    // about the New menu / filters / batch actions has to say so.
    newMenuEntries: () => [],
    runNewMenuEntry: () => {},
    listActionsFor: () => [],
    runListAction: async () => true,
    filters: () => [],
    batchActionsFor: () => [],
    runBatchAction: async () => [true],
    // Identity sort by default: ordering assertions inject their own, so no
    // test leans on core's comparator being present.
    sortNodes: (nodes) => nodes,
    ...overrides,
  } as Bridge
}

let router: Router

// `NcActions`/`NcActionButton` are STUBBED in these tests, so menu items render
// inline in the component tree instead of into @nextcloud/vue's popover
// container. That container is cached and reused across mounts, and its ids
// repeat, which made document-wide lookups find items belonging to menus from
// earlier cases — flakiness that says nothing about this page. What is under
// test here is which entries the page offers and what it does when one is
// chosen; that the real popover opens on click is a browser behaviour, covered
// by the live check (M124.4) rather than simulated here.
const MENU_STUBS = {
  NcActions: {
    inheritAttrs: false,
    // The `icon` slot is rendered for real (not stubbed away) so tests can
    // assert on the actual trigger icon component (M174.4).
    template: '<div class="stub-actions" v-bind="$attrs"><slot name="icon" /><slot /></div>',
  },
  NcActionButton: {
    inheritAttrs: false,
    emits: ['click'],
    template: '<button class="stub-action" v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
  },
}

// Kept as no-ops so each test still reads as "open the menu, then choose" —
// the stubs render the items unconditionally.
async function openRowMenu(_wrapper: ReturnType<typeof mount>): Promise<void> {}
async function openNewMenu(_wrapper: ReturnType<typeof mount>): Promise<void> {}
async function openSelectionMenu(_wrapper: ReturnType<typeof mount>): Promise<void> {}

function menuItem(testId: string): HTMLElement | null {
  return mounted?.find(`[data-testid="${testId}"]`).exists()
    ? (mounted.find(`[data-testid="${testId}"]`).element as HTMLElement)
    : null
}

async function clickMenuItem(testId: string): Promise<void> {
  const el = mounted?.find(`[data-testid="${testId}"]`)
  if (!el?.exists()) throw new Error(`menu item '${testId}' is not rendered`)
  await el.trigger('click')
  await flushPromises()
}

let mounted: ReturnType<typeof mount> | undefined

async function mountPage(bridge: Bridge, path = '/browse/files'): Promise<ReturnType<typeof mount>> {
  mounted?.unmount()
  vi.mocked(ncFilesBridge).mockReturnValue(bridge)
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/browse/:viewId', name: 'file-browser', component: FileBrowserPage },
      { path: '/document/:docId', name: 'document-viewer', component: { template: '<div />' } },
    ],
  })
  await router.push(path)
  await router.isReady()
  // attachTo: NcActions' popover only mounts its menu when the component is in
  // the live document — detached, the trigger click opens nothing.
  const wrapper = mount(FileBrowserPage, {
    global: { plugins: [router], stubs: MENU_STUBS },
    attachTo: document.body,
  })
  mounted = wrapper
  await flushPromises()
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.restoreAllMocks()
  // restoreAllMocks restores spies but leaves a module mock's call history, so
  // "was never called" assertions would see the previous test's calls.
  vi.clearAllMocks()
  delete (globalThis as { OCA?: unknown }).OCA
  // Default: the clicked file has no document — the ordinary case for most
  // files in an account. Tests that care say otherwise.
  vi.mocked(documentsService.fetchDocumentByFileId).mockResolvedValue(undefined)
  // Default: nothing pending/processing tenant-wide, so the AI status strip
  // stays hidden unless a test opts into it. Tests that care say otherwise.
  vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue({
    statuses: [],
    total: 0,
    types: [],
  } as never)
})

afterEach(() => {
  mounted?.unmount()
  mounted = undefined
})

describe('FileBrowserPage — listing', () => {
  it('renders one row per node with name, size and modified date', async () => {
    // Phase 146: the `size`/`mtime` columns render human-readable
    // (`formatByteSize`) and relative (`formatRelativeDate`) text rather than
    // a raw byte count / absolute date — pin "now" so the relative rendering
    // is deterministic.
    vi.useFakeTimers({ now: new Date('2026-08-01T15:00:00Z') })
    try {
      const wrapper = await mountPage(
        fakeBridge({
          listContents: async () => ({ folderPath: '/', nodes: [
              node('/Invoices', 'folder'),
              node('/a.pdf', 'file', { size: 2048, mtime: new Date('2026-08-01T10:00:00Z') }),
            ], folderRaw: { path: '/' } }),
        }),
      )

      const text = wrapper.text()
      expect(text).toContain('Invoices')
      expect(text).toContain('a.pdf')
      // Size is rendered by VirtualTable's byteSize formatting; a folder has none.
      expect(text).toContain('2 KB')
      // Modified is rendered by VirtualTable's relativeDate formatting.
      expect(text).toContain('5 hours ago')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the number of loaded rows as an item count (M146.2)', async () => {
    const wrapper = await mountPage(
      fakeBridge({
        listContents: async () => ({
          folderPath: '/',
          nodes: [node('/Invoices', 'folder'), node('/a.pdf', 'file'), node('/b.pdf', 'file')],
          folderRaw: { path: '/' },
        }),
      }),
    )

    expect(wrapper.find('[data-testid="file-browser-item-count"]').text()).toBe('3 items')
  })

  it('uses the singular form for exactly one loaded row (M146.2)', async () => {
    const wrapper = await mountPage(
      fakeBridge({
        listContents: async () => ({ folderPath: '/', nodes: [node('/a.pdf', 'file')], folderRaw: { path: '/' } }),
      }),
    )

    expect(wrapper.find('[data-testid="file-browser-item-count"]').text()).toBe('1 item')
  })

  it('does not imply a corpus total it does not have — the count tracks the currently-loaded listing, not a fixed initial value (M146.2)', async () => {
    const listContents = vi.fn<Bridge['listContents']>(async (_view, dir) =>
      dir === '/Invoices'
        ? { folderPath: '/Invoices', nodes: [node('/Invoices/a.pdf', 'file')], folderRaw: { path: '/Invoices' } }
        : {
            folderPath: '/',
            nodes: [node('/Invoices', 'folder'), node('/b.pdf', 'file')],
            folderRaw: { path: '/' },
          },
    )
    const wrapper = await mountPage(fakeBridge({ listContents }))
    expect(wrapper.find('[data-testid="file-browser-item-count"]').text()).toBe('2 items')

    await wrapper.find('.virtual-table__row--clickable').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="file-browser-item-count"]').text()).toBe('1 item')
  })

  it('renders the view\'s OWN columns, so Trash shows core\'s trash columns', async () => {
    // Measured on NC 34: the trashbin view ships three columns of its own,
    // each rendering a DOM node. The page must not know they exist.
    const column = (id: string, title: string, text: string) => ({
      id,
      title,
      render: () => {
        const el = document.createElement('span')
        el.textContent = text
        return el
      },
    })
    const trashView: BridgeView = {
      id: 'trashbin',
      name: 'Deleted files',
      columns: [
        column('files_trashbin--original-location', 'Original location', '/Invoices'),
        column('files_trashbin--deleted-by', 'Deleted by', 'alice'),
      ],
    }
    const wrapper = await mountPage(
      fakeBridge({
        view: () => trashView,
        listContents: async () => ({ folderPath: '/', nodes: [node('/old.pdf', 'file')], folderRaw: { path: '/' } }),
      }),
      '/browse/trashbin',
    )

    expect(wrapper.text()).toContain('Original location')
    expect(wrapper.text()).toContain('/Invoices')
    expect(wrapper.text()).toContain('alice')
  })

  it('asks for the directory from ?dir=, not always the root', async () => {
    const listContents = vi.fn<Bridge['listContents']>(async () => ({ folderPath: '/Invoices', nodes: [], folderRaw: { path: '/Invoices' } }))

    await mountPage(fakeBridge({ listContents }), '/browse/files?dir=/Invoices')

    expect(listContents.mock.calls[0][0]).toBe('files')
    expect(listContents.mock.calls[0][1]).toBe('/Invoices')
  })

  it('shows an empty state carrying the view\'s own emptyTitle', async () => {
    const wrapper = await mountPage(
      fakeBridge({
        view: () => ({ id: 'sharingin', name: 'Shared with you', emptyTitle: 'Nothing shared yet', columns: [] }),
        listContents: async () => ({ folderPath: '/', nodes: [], folderRaw: { path: '/' } }),
      }),
      '/browse/sharingin',
    )

    expect(wrapper.text()).toContain('Nothing shared yet')
  })

  it('reports a failed listing instead of rendering an empty folder', async () => {
    // An empty folder and an unreachable one look identical to a user unless
    // this is said out loud.
    const wrapper = await mountPage(
      fakeBridge({
        listContents: async () => {
          throw new Error('Network request failed')
        },
      }),
    )

    expect(wrapper.find('[data-testid="file-browser-error"]').text()).toContain('Network request failed')
  })

  it('renders an empty state for a view the registry does not have', async () => {
    // A stale bookmark, or an app that was disabled. Never a crash.
    const wrapper = await mountPage(fakeBridge({ view: () => undefined }), '/browse/nope')

    expect(wrapper.find('[data-testid="file-browser-unknown-view"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('nope')
  })

  it('re-resolves the view when the registry populates after mount', async () => {
    // The registry is filled by server-added scripts whose load order relative
    // to this bundle is not guaranteed — a view missing at mount is not
    // necessarily missing.
    let registered = false
    let notify = () => {}
    const wrapper = await mountPage(
      fakeBridge({
        view: () => (registered ? FILES_VIEW : undefined),
        onViewsChanged: (listener) => {
          notify = listener
          return () => {}
        },
      }),
    )
    expect(wrapper.find('[data-testid="file-browser-unknown-view"]').exists()).toBe(true)

    registered = true
    notify()
    await flushPromises()

    expect(wrapper.find('[data-testid="file-browser-unknown-view"]').exists()).toBe(false)
  })
})

describe('FileBrowserPage — activation', () => {
  it('navigates into a folder, keeping the same view', async () => {
    const wrapper = await mountPage(
      fakeBridge({
        listContents: async () => ({ folderPath: '/', nodes: [node('/Invoices', 'folder')], folderRaw: { path: '/' } }),
      }),
    )

    await wrapper.find('.virtual-table__row').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.params.viewId).toBe('files')
    expect(router.currentRoute.value.query.dir).toBe('/Invoices')
  })

  it('opens a file with no document in Nextcloud\'s own previewer', async () => {
    const open = vi.fn()
    ;(globalThis as { OCA?: unknown }).OCA = { Viewer: { open } }
    const wrapper = await mountPage(
      fakeBridge({ listContents: async () => ({ folderPath: '/', nodes: [node('/a.pdf', 'file')], folderRaw: { path: '/' } }) }),
    )

    await wrapper.find('.virtual-table__row').trigger('click')
    await flushPromises()

    expect(open).toHaveBeenCalledWith({ path: '/a.pdf' })
    // And it did NOT navigate: a file is not a directory.
    expect(router.currentRoute.value.query.dir).toBeUndefined()
  })

  it('says so rather than doing nothing when the previewer is absent', async () => {
    const wrapper = await mountPage(
      fakeBridge({ listContents: async () => ({ folderPath: '/', nodes: [node('/a.pdf', 'file')], folderRaw: { path: '/' } }) }),
    )

    await wrapper.find('.virtual-table__row').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="file-browser-error"]').exists()).toBe(true)
  })
})

describe('FileBrowserPage — actions', () => {
  it('offers the actions the bridge reports for the row', async () => {
    const wrapper = await mountPage(
      fakeBridge({
        listContents: async () => ({ folderPath: '/', nodes: [node('/a.pdf', 'file')], folderRaw: { path: '/' } }),
        actionsFor: () => [
          { id: 'download', label: 'Download', inline: false },
          { id: 'delete', label: 'Delete', inline: false },
        ],
      }),
    )

    await openRowMenu(wrapper)

    expect(menuItem('file-browser-action-download')).not.toBeNull()
    expect(menuItem('file-browser-action-delete')).not.toBeNull()
  })

  it('runs an action through the bridge and re-reads the listing afterwards', async () => {
    const runAction = vi.fn<Bridge['runAction']>(async () => true)
    const listContents = vi.fn<Bridge['listContents']>(async () => ({ folderPath: '/', nodes: [node('/a.pdf', 'file')], folderRaw: { path: '/' } }))
    const wrapper = await mountPage(
      fakeBridge({ listContents, runAction, actionsFor: () => [{ id: 'delete', label: 'Delete', inline: false }] }),
    )
    const callsBefore = listContents.mock.calls.length
    await openRowMenu(wrapper)
    await clickMenuItem('file-browser-action-delete')
    await flushPromises()

    expect(runAction.mock.calls[0][0]).toBe('delete')
    // Core owns the operation, so its effect is only knowable by re-reading.
    expect(listContents.mock.calls.length).toBeGreaterThan(callsBefore)
  })

  it('surfaces an action failure instead of swallowing it', async () => {
    const wrapper = await mountPage(
      fakeBridge({
        listContents: async () => ({ folderPath: '/', nodes: [node('/a.pdf', 'file')], folderRaw: { path: '/' } }),
        actionsFor: () => [{ id: 'delete', label: 'Delete', inline: false }],
        runAction: async () => {
          throw new Error('Permission denied')
        },
      }),
    )

    await openRowMenu(wrapper)
    await clickMenuItem('file-browser-action-delete')

    expect(wrapper.find('[data-testid="file-browser-error"]').text()).toContain('Permission denied')
  })

  it('offers the details panel only where core\'s sidebar was actually loaded', async () => {
    const withoutSidebar = await mountPage(
      fakeBridge({ listContents: async () => ({ folderPath: '/', nodes: [node('/a.pdf', 'file')], folderRaw: { path: '/' } }) }),
    )
    await openRowMenu(withoutSidebar)
    expect(menuItem('file-browser-details')).toBeNull()

    const openSidebar = vi.fn()
    const withSidebar = await mountPage(
      fakeBridge({
        listContents: async () => ({ folderPath: '/', nodes: [node('/a.pdf', 'file')], folderRaw: { path: '/' } }),
        sidebarAvailable: () => true,
        openSidebar,
      }),
    )
    await openRowMenu(withSidebar)
    await clickMenuItem('file-browser-details')

    // Opens straight to our own tab (M174.7), not the raw path — the modern
    // `getSidebar().open(node, tab)` contract, not the legacy `open(path)`.
    expect(openSidebar).toHaveBeenCalledWith(expect.objectContaining({ path: '/a.pdf' }), 'momentum-nl')
  })

  // M177.3: `M174.7` reached the shared sidebar STORE (the assertion above)
  // but nothing on this page ever rendered it. "No console error" is
  // deliberately NOT the bar here — these assert a RENDERED sidebar element on
  // the named file, and `momentum-nl` SELECTABLE as a tab, both on the DOM.
  it('renders its own sidebar on the named file when details are opened, with momentum-nl selectable', async () => {
    const wrapper = await mountPage(
      fakeBridge({
        listContents: async () => ({ folderPath: '/', nodes: [node('/invoice.pdf', 'file')], folderRaw: { path: '/' } }),
        sidebarAvailable: () => true,
        openSidebar: () => {},
        sidebarTabsFor: async () => [
          { id: 'sharing', displayName: 'Sharing', iconSvgInline: '<svg />', order: 1, tagName: 'momentum-fake-sidebar-tab' },
          { id: 'momentum-nl', displayName: 'Ask AI', iconSvgInline: '<svg />', order: 2, tagName: 'momentum-fake-sidebar-tab' },
        ],
      }),
    )
    await openRowMenu(wrapper)
    await clickMenuItem('file-browser-details')
    await flushPromises()

    const sidebar = wrapper.find('[data-testid="files-sidebar"]')
    expect(sidebar.exists()).toBe(true)
    expect(sidebar.text()).toContain('invoice.pdf')
    const tabButton = wrapper.find('#tab-button-momentum-nl')
    expect(tabButton.exists()).toBe(true)
    expect(tabButton.attributes('role')).toBe('tab')
  })

  it('closes its own sidebar when the sidebar close control is used', async () => {
    const closeSidebar = vi.fn()
    const wrapper = await mountPage(
      fakeBridge({
        listContents: async () => ({ folderPath: '/', nodes: [node('/invoice.pdf', 'file')], folderRaw: { path: '/' } }),
        sidebarAvailable: () => true,
        openSidebar: () => {},
        closeSidebar,
        sidebarTabsFor: async () => [
          { id: 'momentum-nl', displayName: 'Ask AI', iconSvgInline: '<svg />', order: 1, tagName: 'momentum-fake-sidebar-tab' },
        ],
      }),
    )
    await openRowMenu(wrapper)
    await clickMenuItem('file-browser-details')
    await flushPromises()
    expect(wrapper.find('[data-testid="files-sidebar"]').exists()).toBe(true)

    await wrapper.find('[data-testid="files-sidebar"] button[aria-label="Close sidebar"]').trigger('click')

    expect(wrapper.find('[data-testid="files-sidebar"]').exists()).toBe(false)
    expect(closeSidebar).toHaveBeenCalledTimes(1)
  })

  // M174.4: the overflow trigger must use the `DotsVertical` component through
  // NcActions' `icon` slot in BOTH row-actions templates (table and grid) —
  // the two are hand-duplicated in FileBrowserPage.vue, so each is asserted
  // on independently rather than trusting one to imply the other.
  it('renders the row-actions trigger with the DotsVertical icon and an accessible name, in the table view', async () => {
    const wrapper = await mountPage(
      fakeBridge({ listContents: async () => ({ folderPath: '/', nodes: [node('/a.pdf', 'file')], folderRaw: { path: '/' } }) }),
    )

    const trigger = wrapper.find('.virtual-table__row .stub-actions')
    expect(trigger.exists()).toBe(true)
    expect(trigger.attributes('aria-label')).toBe('Actions')
    expect(trigger.findComponent(DotsVerticalIcon).exists()).toBe(true)
  })

  it('renders the row-actions trigger with the DotsVertical icon and an accessible name, in the grid view', async () => {
    const wrapper = await mountPage(
      fakeBridge({ listContents: async () => ({ folderPath: '/', nodes: [node('/a.pdf', 'file')], folderRaw: { path: '/' } }) }),
    )

    await wrapper.find('[data-testid="file-browser-view-toggle"]').trigger('click')
    await flushPromises()

    const trigger = wrapper.find('.file-tile-grid__actions .stub-actions')
    expect(trigger.exists()).toBe(true)
    expect(trigger.attributes('aria-label')).toBe('Actions')
    expect(trigger.findComponent(DotsVerticalIcon).exists()).toBe(true)
  })

  // M174.5: Nextcloud marks some actions (`sharing-status`, `system-tags`, …)
  // for INLINE presentation — their `displayName` deliberately returns "".
  // Rendered through the overflow menu that produced a blank, unnamed
  // clickable row; rendered as a row icon it must carry a real accessible
  // name instead. Table and grid are hand-duplicated templates (M174.4's own
  // lesson), so both are asserted independently.
  it('renders an inline action as a named row icon rather than a blank overflow-menu entry, in the table view', async () => {
    const wrapper = await mountPage(
      fakeBridge({
        listContents: async () => ({ folderPath: '/', nodes: [node('/a.pdf', 'file')], folderRaw: { path: '/' } }),
        actionsFor: () => [
          { id: 'sharing-status', label: '', iconSvgInline: '<svg></svg>', inline: true },
          { id: 'delete', label: 'Delete', inline: false },
        ],
      }),
    )

    const inlineButton = wrapper.find('[data-testid="file-browser-action-sharing-status"]')
    expect(inlineButton.exists()).toBe(true)
    expect(inlineButton.attributes('aria-label')).toBeTruthy()
    // The blank-named menu entry this milestone exists to remove: the inline
    // action must not ALSO appear inside the overflow menu.
    expect(wrapper.find('.stub-actions [data-testid="file-browser-action-sharing-status"]').exists()).toBe(false)
    // A non-inline action still renders in the overflow menu, unaffected.
    expect(menuItem('file-browser-action-delete')).not.toBeNull()
  })

  // M183.1 (backlog/v1.md Phase 183): the grid TILE renders no inline action
  // control — NC's own Files grid demotes its inline set into the tile's
  // overflow menu (measured live), and the mockup's `.grid-tile` template
  // carries no `person_add` either, only `grid-checkbox`/`grid-tile-more`/
  // icon/name. Demoted, NOT dropped: every action inline in the table must
  // stay reachable from the tile's menu, with a real name (an inline action's
  // `displayName` is deliberately ""). Replaces M174.5's grid case, which
  // asserted the inline control this milestone removes from the tile; the
  // table half of M174.5 is untouched above and stays correct.
  it('renders no inline action control on a grid tile, demoting it into the tile overflow menu instead', async () => {
    const wrapper = await mountPage(
      fakeBridge({
        listContents: async () => ({ folderPath: '/', nodes: [node('/a.pdf', 'file')], folderRaw: { path: '/' } }),
        actionsFor: () => [
          { id: 'sharing-status', label: '', iconSvgInline: '<svg></svg>', inline: true },
          { id: 'system-tags', label: '', iconSvgInline: '<svg></svg>', inline: true },
          { id: 'delete', label: 'Delete', inline: false },
        ],
      }),
    )

    // The measurement is only meaningful on a tile whose action set really
    // contains an inline action — assert it does in the TABLE view first,
    // else the grid assertions below pass vacuously.
    const tableInline = wrapper
      .findAll('.virtual-table__row [data-testid^="file-browser-action-"]')
      .filter((el) => el.element.closest('.stub-actions') === null)
    expect(tableInline.length).toBeGreaterThan(0)

    await wrapper.find('[data-testid="file-browser-view-toggle"]').trigger('click')
    await flushPromises()

    // Nothing but the overflow trigger sits in the tile's actions container.
    const tileActions = wrapper.find('.file-tile-grid__actions .momentum-row-actions')
    expect(tileActions.exists()).toBe(true)
    expect(tileActions.findAll('[data-testid^="file-browser-action-"]').every((el) =>
      el.element.closest('.stub-actions') !== null,
    )).toBe(true)
    expect(wrapper.find('.file-tile-grid__actions .momentum-row-actions__icon').exists()).toBe(false)

    // …and every one of them is reachable from that menu, named.
    for (const id of ['sharing-status', 'system-tags', 'delete']) {
      const entry = wrapper.find(`.file-tile-grid__actions .stub-actions [data-testid="file-browser-action-${id}"]`)
      expect(entry.exists()).toBe(true)
      expect(entry.text().trim()).toBeTruthy()
    }
  })

  // M177.4: `system-tags` declares `inline: true` but NC's `iconSvgInline`
  // returns an EMPTY STRING for it — the row icon is the whole presentation,
  // so with no icon there is nothing to show and the control is just an
  // invisible clickable box. An inline action earns a row control only when
  // it actually has an icon; without one it must fall back to the overflow
  // menu (with a real name, not the blank row M174.5 removed) rather than
  // rendering as a control with nothing visible in it.
  it('does not render an inline action with no icon as a row control, in the table view', async () => {
    const wrapper = await mountPage(
      fakeBridge({
        listContents: async () => ({ folderPath: '/', nodes: [node('/a.pdf', 'file')], folderRaw: { path: '/' } }),
        actionsFor: () => [{ id: 'system-tags', label: '', iconSvgInline: '', inline: true }],
      }),
    )

    const matches = wrapper.findAll('[data-testid="file-browser-action-system-tags"]')
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.every((el) => el.element.closest('.stub-actions') !== null)).toBe(true)
    const menuEntry = menuItem('file-browser-action-system-tags')
    expect(menuEntry).not.toBeNull()
    expect(menuEntry?.textContent?.trim()).toBeTruthy()
  })

  it('does not render an inline action with no icon as a row control, in the grid view', async () => {
    const wrapper = await mountPage(
      fakeBridge({
        listContents: async () => ({ folderPath: '/', nodes: [node('/a.pdf', 'file')], folderRaw: { path: '/' } }),
        actionsFor: () => [{ id: 'system-tags', label: '', iconSvgInline: '', inline: true }],
      }),
    )

    await wrapper.find('[data-testid="file-browser-view-toggle"]').trigger('click')
    await flushPromises()

    const matches = wrapper.findAll('[data-testid="file-browser-action-system-tags"]')
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.every((el) => el.element.closest('.stub-actions') !== null)).toBe(true)
    const menuEntry = menuItem('file-browser-action-system-tags')
    expect(menuEntry).not.toBeNull()
    expect(menuEntry?.textContent?.trim()).toBeTruthy()
  })

  // M181.5: a host-supplied inline action icon (`v-html="action.iconSvgInline"`)
  // carries no width/height/class of its own — NC's action registry hands over
  // bare markup, unlike the `DotsVerticalIcon` sibling in the same row, which
  // is a `vue-material-design-icons` component that ships its own sizing. With
  // no fix the host's <svg> collapses to 0x0/black; this asserts the CSS this
  // milestone adds actually reaches it, and that a host-supplied icon is
  // present on the row at all (else the assertion below passes vacuously).
  it('gives a host-supplied inline action icon a real size and a theme-following fill, in the table view', async () => {
    const wrapper = await mountPage(
      fakeBridge({
        listContents: async () => ({ folderPath: '/', nodes: [node('/a.pdf', 'file')], folderRaw: { path: '/' } }),
        actionsFor: () => [
          { id: 'sharing-status', label: '', iconSvgInline: '<svg id="mdi-account-plus-outline" viewBox="0 0 24 24"></svg>', inline: true },
        ],
      }),
    )

    const icon = wrapper.find('[data-testid="file-browser-action-sharing-status"] .momentum-row-actions__icon')
    expect(icon.exists()).toBe(true)
    const svg = icon.find('svg')
    expect(svg.exists()).toBe(true) // the host-supplied icon really is on this row
    expect(getComputedStyle(svg.element).width).toBe('20px')
    expect(getComputedStyle(svg.element).height).toBe('20px')
    expect(getComputedStyle(svg.element).fill).toBe('currentColor')
    expect(getComputedStyle(icon.element).color).toContain('--color-main-text')
    // The dots-menu trigger renders through a real vue-material-design-icons
    // component, so it needs none of the above — confirm it's the sibling in
    // the same row, not a stand-in for the host-supplied icon.
    expect(wrapper.find('.virtual-table__row .stub-actions').findComponent(DotsVerticalIcon).exists()).toBe(true)
  })

  // M183.1 retargets M181.5's GRID case rather than deleting it: the tile no
  // longer renders a host-supplied inline icon at all (it is demoted to the
  // menu), so what this asserts on the grid is that the icon-bearing action is
  // still there and still reachable — not that its <svg> is sized. M181.5's
  // sizing fix itself is NOT reverted; it is asserted on the table above,
  // which is the only surface that presents an inline icon now.
  it('presents a host-supplied inline action through the tile menu rather than as a sized tile icon, in the grid view', async () => {
    const wrapper = await mountPage(
      fakeBridge({
        listContents: async () => ({ folderPath: '/', nodes: [node('/a.pdf', 'file')], folderRaw: { path: '/' } }),
        actionsFor: () => [
          { id: 'sharing-status', label: '', iconSvgInline: '<svg id="mdi-account-plus-outline" viewBox="0 0 24 24"></svg>', inline: true },
        ],
      }),
    )

    // The host-supplied icon really is in this action set — asserted on the
    // table, so the grid assertion below cannot pass vacuously.
    expect(
      wrapper
        .find('.virtual-table__row [data-testid="file-browser-action-sharing-status"] .momentum-row-actions__icon svg')
        .exists(),
    ).toBe(true)

    await wrapper.find('[data-testid="file-browser-view-toggle"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('.file-tile-grid__actions .momentum-row-actions__icon').exists()).toBe(false)
    const menuEntry = wrapper.find(
      '.file-tile-grid__actions .stub-actions [data-testid="file-browser-action-sharing-status"]',
    )
    expect(menuEntry.exists()).toBe(true)
    expect(menuEntry.text().trim()).toBeTruthy()
    expect(wrapper.find('.file-tile-grid__actions .stub-actions').findComponent(DotsVerticalIcon).exists()).toBe(true)
  })
})

describe('FileBrowserPage — an action failure must stay readable', () => {
  it('keeps the action error visible even though the listing reloads right after', async () => {
    // The re-read that follows every action normally SUCCEEDS, so one shared
    // message would be cleared milliseconds after being set — leaving the user
    // with a refused delete and no reason given. Found while building M123.2;
    // hence its own case rather than a comment.
    const wrapper = await mountPage(
      fakeBridge({
        listContents: async () => ({ folderPath: '/', nodes: [node('/a.pdf', 'file')], folderRaw: { path: '/' } }),
        actionsFor: () => [{ id: 'delete', label: 'Delete', inline: false }],
        runAction: async () => {
          throw new Error('Permission denied')
        },
      }),
    )

    await openRowMenu(wrapper)
    await clickMenuItem('file-browser-action-delete')
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('[data-testid="file-browser-error"]').text()).toContain('Permission denied')
  })
})

describe('FileBrowserPage — upload', () => {
  it('offers upload only where the bridge says a writable directory exists', async () => {
    // Upload lives inside the New menu now (M124.3), so this opens it — the
    // same click a user makes.
    const writable = await mountPage(fakeBridge({ canUpload: () => true }))
    await openNewMenu(writable)
    expect(menuItem('file-browser-upload')).not.toBeNull()

    const projection = await mountPage(fakeBridge({ canUpload: () => false }), '/browse/sharingin')
    await openNewMenu(projection)
    expect(menuItem('file-browser-upload')).toBeNull()
  })

  it('uploads into the directory being viewed and re-reads it', async () => {
    const uploadFile = vi.fn<Bridge['uploadFile']>(async () => {})
    const listContents = vi.fn<Bridge['listContents']>(async () => ({ folderPath: '/Invoices', nodes: [], folderRaw: { path: '/Invoices' } }))
    const wrapper = await mountPage(
      fakeBridge({ canUpload: () => true, uploadFile, listContents }),
      '/browse/files?dir=/Invoices',
    )
    const callsBefore = listContents.mock.calls.length
    const file = { name: 'new.pdf', size: 1, arrayBuffer: async () => new ArrayBuffer(1) }

    const input = wrapper.find('[data-testid="file-browser-file-input"]')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await flushPromises()
    await flushPromises()

    expect(uploadFile).toHaveBeenCalledWith('files', '/Invoices', file)
    expect(listContents.mock.calls.length).toBeGreaterThan(callsBefore)
  })

  it('tells the user a name is taken rather than replacing their file', async () => {
    const wrapper = await mountPage(
      fakeBridge({
        canUpload: () => true,
        uploadFile: async () => {
          throw new UploadConflictError('/a.pdf')
        },
      }),
    )
    const input = wrapper.find('[data-testid="file-browser-file-input"]')
    Object.defineProperty(input.element, 'files', {
      value: [{ name: 'a.pdf', size: 1, arrayBuffer: async () => new ArrayBuffer(1) }],
      configurable: true,
    })

    await input.trigger('change')
    await flushPromises()

    expect(wrapper.find('[data-testid="file-browser-error"]').text()).toContain('already exists')
  })
})

describe('FileBrowserPage — drag-and-drop upload (M148.1)', () => {
  // Nothing in this repo touches a `DragEvent`, and jsdom's `dataTransfer` is a
  // stub (backlog/v1.md Phase 148 notes) — these tests can only prove the
  // handlers are bound and that a drop reuses the EXISTING upload path
  // (`bridge.uploadFile`), never a second transfer mechanism. Whether a real
  // drag from a real desktop actually lands is the operator's live check.
  it('calls the existing upload path when a file is dropped', async () => {
    const uploadFile = vi.fn<Bridge['uploadFile']>(async () => {})
    const listContents = vi.fn<Bridge['listContents']>(async () => ({
      folderPath: '/Invoices',
      nodes: [],
      folderRaw: { path: '/Invoices' },
    }))
    const wrapper = await mountPage(
      fakeBridge({ canUpload: () => true, uploadFile, listContents }),
      '/browse/files?dir=/Invoices',
    )
    const callsBefore = listContents.mock.calls.length
    const file = { name: 'dropped.pdf', size: 1, arrayBuffer: async () => new ArrayBuffer(1) }
    const dropZone = wrapper.find('[data-testid="file-browser-drop-zone"]')

    await dropZone.trigger('drop', { dataTransfer: { files: [file] } })
    await flushPromises()
    await flushPromises()

    expect(uploadFile).toHaveBeenCalledWith('files', '/Invoices', file)
    expect(listContents.mock.calls.length).toBeGreaterThan(callsBefore)
  })

  it('shows the drop overlay only while a drag is over the zone, and only where upload is allowed', async () => {
    const wrapper = await mountPage(fakeBridge({ canUpload: () => true }))
    const dropZone = wrapper.find('[data-testid="file-browser-drop-zone"]')

    expect(wrapper.find('[data-testid="file-browser-drop-overlay"]').exists()).toBe(false)

    await dropZone.trigger('dragenter', { dataTransfer: { files: [] } })
    expect(wrapper.find('[data-testid="file-browser-drop-overlay"]').exists()).toBe(true)

    await dropZone.trigger('dragleave', { dataTransfer: { files: [] } })
    expect(wrapper.find('[data-testid="file-browser-drop-overlay"]').exists()).toBe(false)
  })

  it('never calls upload on a view where the bridge says upload is not allowed', async () => {
    const uploadFile = vi.fn<Bridge['uploadFile']>(async () => {})
    const wrapper = await mountPage(fakeBridge({ canUpload: () => false, uploadFile }))
    const dropZone = wrapper.find('[data-testid="file-browser-drop-zone"]')

    await dropZone.trigger('dragenter', { dataTransfer: { files: [] } })
    expect(wrapper.find('[data-testid="file-browser-drop-overlay"]').exists()).toBe(false)

    await dropZone.trigger('drop', {
      dataTransfer: { files: [{ name: 'x.pdf', size: 1, arrayBuffer: async () => new ArrayBuffer(1) }] },
    })
    await flushPromises()

    expect(uploadFile).not.toHaveBeenCalled()
  })
})

describe('FileBrowserPage — breadcrumbs', () => {
  it('walks back up the directory it is showing', async () => {
    const wrapper = await mountPage(
      fakeBridge({ listContents: async () => ({ folderPath: '/a/b', nodes: [], folderRaw: { path: '/a/b' } }) }),
      '/browse/files?dir=/a/b',
    )

    // The regression test that matters for M161.4: a naive "root heading
    // replaces the duplicate All files" fix deletes navigation along with the
    // duplication — this proves crumbs still render and still climb inside a
    // subfolder. One crumb per path segment, plus the view root. Asserted by
    // clicking rather than by text: NcBreadcrumbs renders the first crumb as
    // a home affordance, so its label is not necessarily in the DOM text.
    // Three crumbs: the view root (rendered as a home affordance by
    // NcBreadcrumbs, hence no text of its own), then one per path segment.
    const crumbs = wrapper.findAll('.vue-crumb')
    expect(crumbs.map((crumb) => crumb.text())).toEqual(['', 'a', 'b'])

    await crumbs[1].find('button').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.dir).toBe('/a')
  })

  it('is not fooled by a dir parameter that is not a path', async () => {
    // Query parameters are user input; a relative or junk value must fall back
    // to the root rather than being concatenated into a request.
    const listContents = vi.fn<Bridge['listContents']>(async () => ({ folderPath: '/', nodes: [], folderRaw: { path: '/' } }))

    await mountPage(fakeBridge({ listContents }), '/browse/files?dir=..%2F..%2Fetc')

    expect(listContents.mock.calls[0][1]).toBe('/')
  })
})

// M161.4 (backlog/v1.md Phase 161): "All files" was rendered twice in a row —
// once by the NcActions view-menu (`:menu-name="view.name"`) and once by
// NcBreadcrumbs' first crumb — and the mockup (`mockup:3502`) shows neither,
// only a folder icon + "Files" heading. This reverses M124.2, on purpose, at
// the operator's request (2026-09-03): Reload and the view's own file-list
// actions (formerly the "FileBrowserPage — view menu" describe block above
// this comment in git history) lived in the removed NcActions and have no
// mockup equivalent, so they are retired here rather than relocated — see
// backlog/v1.md Phase 161's M161.4 notes.
//
// M178.4 (backlog/v1.md Phase 178): the root no longer gets its own bespoke
// heading `<div>` — it renders through the SAME NcBreadcrumbs as a subfolder
// (one crumb, no path segments), so the root's home crumb is icon-only with
// no visible text, exactly like the home crumb already was inside a
// subfolder. That is a real behavior change from what this describe block's
// name still says ("root heading") — kept because splitting it out reads
// like an unrelated rename, not because a distinct "heading" still exists.
describe('FileBrowserPage — root heading replaces the duplicate "All files" (M161.4)', () => {
  it('renders an icon-only home crumb at the root, with no "All files" text in the toolbar', async () => {
    // Scoped to the toolbar, not the whole page: the "All files"/"Recent"/
    // "Favorites" tab strip (Phase 145, `.momentum-page__tabs`) legitimately
    // renders "All files" as a tab label — a DIFFERENT, unrelated surface
    // from the toolbar's view-menu/breadcrumb duplication this fixes.
    const wrapper = await mountPage(fakeBridge())

    const heading = wrapper.find('[data-testid="file-browser-heading"]')
    expect(heading.exists()).toBe(true)
    // No visible text: NcBreadcrumbs' first crumb renders its own #icon slot
    // instead of its name, same as it already does inside a subfolder (see
    // the describe block below) — M178.4 removes the divergence rather than
    // keeping one state text-labelled and the other icon-only.
    expect(heading.text()).toBe('')
    // The accessible name survives even with no visible text: NcBreadcrumbs'
    // `rootIcon` default drives NcBreadcrumb's aria-label-from-icon-prop
    // check regardless of which icon the `#icon` slot actually renders.
    expect(heading.find('button').attributes('aria-label')).toBe('Files')
    expect(wrapper.find('.momentum-page__toolbar').text()).not.toContain('All files')
  })

  it('renders the same single-component breadcrumb row at the root and inside a subfolder', async () => {
    const root = await mountPage(fakeBridge())
    expect(root.find('.momentum-page__heading').exists()).toBe(false)
    expect(root.findAll('.vue-crumb').map((crumb) => crumb.text())).toEqual([''])

    const wrapper = await mountPage(
      fakeBridge({ listContents: async () => ({ folderPath: '/a', nodes: [], folderRaw: { path: '/a' } }) }),
      '/browse/files?dir=/a',
    )

    expect(wrapper.find('.momentum-page__heading').exists()).toBe(false)
    const crumbs = wrapper.findAll('.vue-crumb')
    expect(crumbs.map((crumb) => crumb.text())).toEqual(['', 'a'])
  })

  it('renders no view menu and no Reload trigger, at the root or in a subfolder', async () => {
    const root = await mountPage(fakeBridge())
    expect(root.find('[data-testid="file-browser-view-menu"]').exists()).toBe(false)
    expect(root.find('[data-testid="file-browser-reload"]').exists()).toBe(false)

    const subfolder = await mountPage(
      fakeBridge({ listContents: async () => ({ folderPath: '/a', nodes: [], folderRaw: { path: '/a' } }) }),
      '/browse/files?dir=/a',
    )
    expect(subfolder.find('[data-testid="file-browser-view-menu"]').exists()).toBe(false)
    expect(subfolder.find('[data-testid="file-browser-reload"]').exists()).toBe(false)
  })
})

// M171.3 (backlog/v1.md Phase 171): `New` and the breadcrumb/heading were
// stacked at the toolbar's left edge, both in DOM order button-first — the
// mockup places them at opposite ends of the row, breadcrumb first. jsdom
// never computes real flex layout (no non-zero getBoundingClientRect), so
// "opposite ends" is asserted via DOM/reading order rather than pixel
// position — the milestone's own note is that a narrow-width position check
// would pass regardless of source order, since the two ends visually
// converge there; only the wrap-vs-crush behaviour is meaningful at that
// width. The `toolbarNarrow` breakpoint is a JS-toggled class (matching
// AiStatusStrip's M164.1 pattern above), not a CSS `@media` block, precisely
// so this suite can drive it deterministically via `matchMedia`.
function stubToolbarMatchMedia(matches: boolean) {
  const mql = {
    matches,
    media: '(max-width: 1023px)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql))
  return mql
}

describe('FileBrowserPage — toolbar New/breadcrumb placement (M171.3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the heading before "New" in DOM order at the wide/default width, unwrapped', async () => {
    stubToolbarMatchMedia(false)
    const wrapper = await mountPage(fakeBridge())

    const toolbar = wrapper.find('.momentum-page__toolbar').element as HTMLElement
    const heading = wrapper.find('[data-testid="file-browser-heading"]').element as HTMLElement
    const newButton = wrapper.find('[data-testid="file-browser-new"]').element as HTMLElement
    expect(
      heading.compareDocumentPosition(newButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    expect(toolbar.classList.contains('momentum-page__toolbar--narrow')).toBe(false)
    expect(getComputedStyle(toolbar).flexWrap).toBe('nowrap')
  })

  it('wraps "New" onto its own line under the mockup\'s narrow breakpoint, instead of squeezing the breadcrumb', async () => {
    stubToolbarMatchMedia(true)
    const wrapper = await mountPage(fakeBridge())

    const toolbar = wrapper.find('.momentum-page__toolbar').element as HTMLElement
    expect(toolbar.classList.contains('momentum-page__toolbar--narrow')).toBe(true)
    expect(getComputedStyle(toolbar).flexWrap).toBe('wrap')
  })
})

describe('FileBrowserPage — unknown view is not a crash', () => {
  it('does not call listContents at all for an unknown view', async () => {
    const listContents = vi.fn<Bridge['listContents']>(async () => {
      throw new UnknownViewError('nope')
    })

    const wrapper = await mountPage(fakeBridge({ view: () => undefined, listContents }), '/browse/nope')

    expect(listContents).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="file-browser-unknown-view"]').exists()).toBe(true)
  })
})

// --- M124.3: Files-app parity toolbar (frontend.md § Files-app parity) ------

describe('FileBrowserPage — New menu', () => {
  it("offers core's registered entries, and runs one with the current listing", async () => {
    const runNewMenuEntry = vi.fn<Bridge['runNewMenuEntry']>()
    const wrapper = await mountPage(
      fakeBridge({
        listContents: async () => ({ folderPath: '/', nodes: [], folderRaw: { path: '/' } }),
        newMenuEntries: () => [
          { id: 'newFolder', label: 'New folder', category: 1, order: 0 },
          { id: 'file-request', label: 'Create file request', category: 1, order: 10 },
        ],
        runNewMenuEntry,
      }),
    )

    await openNewMenu(wrapper)
    expect(menuItem('file-browser-new-newFolder')).not.toBeNull()
    expect(menuItem('file-browser-new-file-request')).not.toBeNull()

    await clickMenuItem('file-browser-new-newFolder')

    expect(runNewMenuEntry.mock.calls[0][0]).toBe('newFolder')
    // The LISTING, not a path: core's handlers create into its folder object.
    expect(runNewMenuEntry.mock.calls[0][1]).toMatchObject({ folderPath: '/' })
  })

  it('reports a failing entry instead of leaving the user with nothing', async () => {
    const wrapper = await mountPage(
      fakeBridge({
        newMenuEntries: () => [{ id: 'newFolder', label: 'New folder', category: 1, order: 0 }],
        runNewMenuEntry: () => {
          throw new Error('Folder already exists')
        },
      }),
    )

    await openNewMenu(wrapper)
    await clickMenuItem('file-browser-new-newFolder')

    expect(wrapper.find('[data-testid="file-browser-error"]').text()).toContain('Folder already exists')
  })
})

// The "FileBrowserPage — view menu" describe block (Reload, and the view's
// own file-list actions e.g. Trash's "Empty deleted files") was retired here,
// not relocated, by M161.4 (backlog/v1.md Phase 161) — see the retirement
// note above the "root heading replaces the duplicate All files" describe
// block. Kept as a documented gap rather than renumbering, mirroring how
// M161.1 retired the file-list-filter-trigger checks in this same phase.

describe('FileBrowserPage — filters', () => {
  function fakeFilter(id: string, keep: (basename: string) => boolean, tagName?: string) {
    let notify: (() => void) | undefined
    return {
      filter: {
        id,
        order: 0,
        displayName: id,
        tagName,
        apply: (nodes: BridgeNode[]) => nodes.filter((n) => keep(n.basename)),
        chips: () => [],
        subscribe: (onFilterChanged: () => void) => {
          notify = onFilterChanged
          return () => {
            notify = undefined
          }
        },
        attachTo: () => {},
      },
      change: () => notify?.(),
    }
  }

  it('applies every registered filter to the listing, UI or not', async () => {
    // `files:hidden` has no UI at all and must still be applied — that is
    // where NC's hidden-files behaviour comes from.
    const hidden = fakeFilter('files:hidden', (name) => !name.startsWith('.'))
    const wrapper = await mountPage(
      fakeBridge({
        listContents: async () => ({
          folderPath: '/',
          nodes: [node('/.secret', 'file'), node('/visible.pdf', 'file')],
          folderRaw: { path: '/' },
        }),
        filters: () => [hidden.filter],
      }),
    )

    const text = wrapper.text()
    expect(text).toContain('visible.pdf')
    expect(text).not.toContain('.secret')
  })

  it('re-applies without refetching when a filter changes', async () => {
    let keepAll = true
    const type = fakeFilter('files:type', (name) => keepAll || name === 'keep.pdf', 'x-type')
    const listContents = vi.fn<Bridge['listContents']>(async () => ({
      folderPath: '/',
      nodes: [node('/keep.pdf', 'file'), node('/drop.pdf', 'file')],
      folderRaw: { path: '/' },
    }))
    const wrapper = await mountPage(fakeBridge({ listContents, filters: () => [type.filter] }))
    expect(wrapper.text()).toContain('drop.pdf')
    const callsBefore = listContents.mock.calls.length

    keepAll = false
    type.change()
    await flushPromises()
    await flushPromises()

    expect(wrapper.text()).not.toContain('drop.pdf')
    expect(wrapper.text()).toContain('keep.pdf')
    // A filter change is a re-render of what we already have — the whole point
    // of core returning a directory in one call.
    expect(listContents.mock.calls.length).toBe(callsBefore)
  })
})

describe('FileBrowserPage — sorting', () => {
  it('sorts through the bridge (core\'s comparator), not by refetching', async () => {
    const sortNodes = vi.fn<Bridge['sortNodes']>((nodes) => nodes)
    const listContents = vi.fn<Bridge['listContents']>(async () => ({
      folderPath: '/',
      nodes: [node('/a.pdf', 'file')],
      folderRaw: { path: '/' },
    }))
    const wrapper = await mountPage(fakeBridge({ listContents, sortNodes }))
    const fetchesBefore = listContents.mock.calls.length

    // Click the "Name" header.
    await wrapper.findAll('.virtual-table__th')[1].trigger('click')
    await flushPromises()

    expect(listContents.mock.calls.length).toBe(fetchesBefore)
    const lastCall = sortNodes.mock.calls[sortNodes.mock.calls.length - 1]
    expect(lastCall[1]).toMatchObject({ column: 'basename', direction: 'desc' })
  })

  it('toggles direction on the same column and resets to ascending on a new one', async () => {
    const sortNodes = vi.fn<Bridge['sortNodes']>((nodes) => nodes)
    const wrapper = await mountPage(fakeBridge({ sortNodes }))

    // `.virtual-table__th--sortable` skips the select checkbox and the
    // actions header (M178.7, backlog/v1.md Phase 178 — actions now sits
    // between Name and Size, and is neither), so index 0/1 here are Name/Size
    // regardless of where the actions column lands.
    const headers = () => wrapper.findAll('.virtual-table__th--sortable')
    await headers()[0].trigger('click') // Name again -> desc
    await flushPromises()
    await headers()[1].trigger('click') // Size -> asc
    await flushPromises()

    const calls = sortNodes.mock.calls.map((call) => call[1])
    expect(calls[calls.length - 2]).toMatchObject({ column: 'basename', direction: 'desc' })
    expect(calls[calls.length - 1]).toMatchObject({ column: 'size', direction: 'asc' })
  })
})

describe('FileBrowserPage — selection', () => {
  const twoFiles = async () => ({
    folderPath: '/',
    nodes: [node('/a.pdf', 'file'), node('/b.pdf', 'file')],
    folderRaw: { path: '/' },
  })

  it('shows nothing until something is checked, then offers the batch actions', async () => {
    const wrapper = await mountPage(
      fakeBridge({
        listContents: twoFiles,
        batchActionsFor: () => [{ id: 'delete', label: 'Delete files', inline: false }],
      }),
    )
    expect(wrapper.find('[data-testid="file-browser-selection-bar"]').exists()).toBe(false)

    await wrapper.findAll('[data-testid="virtual-table-select-row"]')[0].setValue(true)
    await flushPromises()

    expect(wrapper.find('[data-testid="file-browser-selection-count"]').text()).toContain('1')
    await openSelectionMenu(wrapper)
    expect(menuItem('file-browser-batch-delete')).not.toBeNull()
  })

  it('runs a batch action with the whole selection and clears it afterwards', async () => {
    const runBatchAction = vi.fn<Bridge['runBatchAction']>(async () => [true, true])
    const wrapper = await mountPage(
      fakeBridge({
        listContents: twoFiles,
        batchActionsFor: () => [{ id: 'delete', label: 'Delete files', inline: false }],
        runBatchAction,
      }),
    )

    await wrapper.find('[data-testid="virtual-table-select-all"]').setValue(true)
    await flushPromises()
    await openSelectionMenu(wrapper)
    await clickMenuItem('file-browser-batch-delete')
    await flushPromises()

    expect(runBatchAction.mock.calls[0][0]).toBe('delete')
    expect((runBatchAction.mock.calls[0][1] as BridgeNode[]).map((n) => n.basename)).toEqual([
      'a.pdf',
      'b.pdf',
    ])
    // Cleared: the rows it referred to may not exist any more.
    expect(wrapper.find('[data-testid="file-browser-selection-bar"]').exists()).toBe(false)
  })

  it('says so when a batch only partly succeeded', async () => {
    // A batch that half-worked reported as success is the case a user most
    // needs told about.
    const wrapper = await mountPage(
      fakeBridge({
        listContents: twoFiles,
        batchActionsFor: () => [{ id: 'delete', label: 'Delete files', inline: false }],
        runBatchAction: async () => [true, false],
      }),
    )

    await wrapper.find('[data-testid="virtual-table-select-all"]').setValue(true)
    await flushPromises()
    await openSelectionMenu(wrapper)
    await clickMenuItem('file-browser-batch-delete')
    await flushPromises()

    expect(wrapper.find('[data-testid="file-browser-error"]').text()).toContain('could not be processed')
  })

  it('drops a selected row that the current filter hides', async () => {
    // Otherwise a bulk action could reach a row the user can no longer see.
    let hideB = false
    let notify: (() => void) | undefined
    const wrapper = await mountPage(
      fakeBridge({
        listContents: twoFiles,
        filters: () => [
          {
            id: 'files:type',
            order: 0,
            apply: (nodes) => nodes.filter((n) => !(hideB && n.basename === 'b.pdf')),
            chips: () => [],
            subscribe: (onFilterChanged) => {
              notify = onFilterChanged
              return () => {}
            },
            attachTo: () => {},
          },
        ],
        batchActionsFor: () => [{ id: 'delete', label: 'Delete files', inline: false }],
      }),
    )

    await wrapper.find('[data-testid="virtual-table-select-all"]').setValue(true)
    await flushPromises()
    expect(wrapper.find('[data-testid="file-browser-selection-count"]').text()).toContain('2')

    hideB = true
    notify?.()
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('[data-testid="file-browser-selection-count"]').text()).toContain('1')
  })

  it('clears the selection when the directory changes', async () => {
    const wrapper = await mountPage(
      fakeBridge({ listContents: twoFiles, batchActionsFor: () => [{ id: 'delete', label: 'Delete', inline: false }] }),
    )
    await wrapper.find('[data-testid="virtual-table-select-all"]').setValue(true)
    await flushPromises()
    expect(wrapper.find('[data-testid="file-browser-selection-bar"]').exists()).toBe(true)

    await router.push({ name: 'file-browser', params: { viewId: 'files' }, query: { dir: '/sub' } })
    await flushPromises()

    expect(wrapper.find('[data-testid="file-browser-selection-bar"]').exists()).toBe(false)
  })
})

describe('FileBrowserPage — grid view (M147.1)', () => {
  const twoFiles = async () => ({
    folderPath: '/',
    nodes: [node('/Invoices', 'folder'), node('/a.pdf', 'file', { size: 2048 })],
    folderRaw: { path: '/' },
  })

  it('renders the table by default, with the grid not mounted at all', async () => {
    const wrapper = await mountPage(fakeBridge({ listContents: twoFiles }))

    expect(wrapper.find('[data-testid="virtual-table-body"]').isVisible()).toBe(true)
    // The table stays mounted always (it owns the fetch); the grid is
    // `v-if`-gated and must not exist in the DOM at all while hidden — a
    // 5000-entry folder must not pay for ~85,000 hidden tile DOM nodes.
    expect(wrapper.find('[data-testid="file-tile-grid-tile"]').exists()).toBe(false)
  })

  it('switches to the tile grid when the toggle is clicked, hiding the table', async () => {
    const wrapper = await mountPage(fakeBridge({ listContents: twoFiles }))

    await wrapper.find('[data-testid="file-browser-view-toggle"]').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('[data-testid="file-tile-grid-tile"]')).toHaveLength(2)
    expect(wrapper.find('[data-testid="virtual-table-body"]').isVisible()).toBe(false)
    const text = wrapper.text()
    expect(text).toContain('Invoices')
    expect(text).toContain('a.pdf')
  })

  it('toggles back to the table on a second click, unmounting the grid again', async () => {
    const wrapper = await mountPage(fakeBridge({ listContents: twoFiles }))
    const toggle = wrapper.find('[data-testid="file-browser-view-toggle"]')

    await toggle.trigger('click')
    await flushPromises()
    await toggle.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="virtual-table-body"]').isVisible()).toBe(true)
    expect(wrapper.find('[data-testid="file-tile-grid-tile"]').exists()).toBe(false)
  })

  it('renders tiles with real data on first navigation into grid mode (the table already fetched)', async () => {
    // Regression guard for the :98-101 comment: the grid is `v-if`-gated and
    // only mounts here for the first time, but `gridRows` is a computed over
    // `nodes` — populated by the always-mounted table's fetch — so the grid
    // is never stranded with no data on this first toggle.
    const wrapper = await mountPage(fakeBridge({ listContents: twoFiles }))

    expect(wrapper.find('[data-testid="file-tile-grid-tile"]').exists()).toBe(false)
    await wrapper.find('[data-testid="file-browser-view-toggle"]').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('[data-testid="file-tile-grid-tile"]')).toHaveLength(2)
    const text = wrapper.text()
    expect(text).toContain('Invoices')
    expect(text).toContain('a.pdf')
  })

  it('gives the grid a valid list/listitem ARIA tree, not an invalid grid/gridcell one', async () => {
    const wrapper = await mountPage(fakeBridge({ listContents: twoFiles }))

    await wrapper.find('[data-testid="file-browser-view-toggle"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('.file-tile-grid').attributes('role')).toBe('list')
    const tiles = wrapper.findAll('[data-testid="file-tile-grid-tile"]')
    for (const tile of tiles) {
      expect(tile.attributes('role')).toBe('listitem')
    }
  })

  it('shares ONE selection state between the table and the grid, not two', async () => {
    const wrapper = await mountPage(fakeBridge({ listContents: twoFiles }))

    await wrapper.findAll('[data-testid="virtual-table-select-row"]')[1].setValue(true)
    await flushPromises()
    expect(wrapper.find('[data-testid="file-browser-selection-count"]').text()).toContain('1')

    await wrapper.find('[data-testid="file-browser-view-toggle"]').trigger('click')
    await flushPromises()

    // The selection made in the table is reflected in the grid's own tile...
    const gridCheckboxes = wrapper.findAll('[data-testid="file-tile-grid-select"]')
    expect((gridCheckboxes[1].element as HTMLInputElement).checked).toBe(true)
    // ...and the selection bar (driven off the ONE shared array) still shows it.
    expect(wrapper.find('[data-testid="file-browser-selection-count"]').text()).toContain('1')

    // Selecting the OTHER tile from the grid extends that same shared array.
    await gridCheckboxes[0].setValue(true)
    await flushPromises()
    expect(wrapper.find('[data-testid="file-browser-selection-count"]').text()).toContain('2')
  })

  it('opens a folder from the grid the same way a row click does', async () => {
    const wrapper = await mountPage(fakeBridge({ listContents: twoFiles }))

    await wrapper.find('[data-testid="file-browser-view-toggle"]').trigger('click')
    await flushPromises()
    await wrapper.findAll('[data-testid="file-tile-grid-tile"]')[0].trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.dir).toBe('/Invoices')
  })
})

describe('FileBrowserPage — toolbar drift fixes (M161.1, M161.2)', () => {
  const twoFiles = async () => ({
    folderPath: '/',
    nodes: [node('/Invoices', 'folder'), node('/a.pdf', 'file', { size: 2048 })],
    folderRaw: { path: '/' },
  })

  // A filter WITH ui (tagName set) — proves the trigger is gone because
  // FileListFilters.vue's only call site was removed, not merely because no
  // test ever registered a filter with UI.
  const typeFilterWithUi = {
    id: 'files:type',
    order: 0,
    displayName: 'Type',
    tagName: 'files-file-list-filter-type',
    apply: (nodes: BridgeNode[]) => nodes,
    chips: () => [],
    subscribe: () => () => {},
    attachTo: () => {},
  }

  it('renders no file-list-filter triggers, even when core registers a filter with UI', async () => {
    const wrapper = await mountPage(
      fakeBridge({ listContents: twoFiles, filters: () => [typeFilterWithUi] }),
    )

    expect(wrapper.find('[data-testid="file-list-filters"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid^="file-list-filter-"]').exists()).toBe(false)
  })

  it('renders the view toggle inside the table header, not the toolbar', async () => {
    const wrapper = await mountPage(fakeBridge({ listContents: twoFiles }))

    const toggle = wrapper.find('[data-testid="file-browser-view-toggle"]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.element.closest('.virtual-table__header')).not.toBeNull()
    expect(toggle.element.closest('.momentum-page__toolbar')).toBeNull()
  })

  it('keeps the table header rendered and visible in grid mode, hiding only the body', async () => {
    const wrapper = await mountPage(fakeBridge({ listContents: twoFiles }))

    await wrapper.find('[data-testid="file-browser-view-toggle"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('.virtual-table__header').isVisible()).toBe(true)
    expect(wrapper.find('[data-testid="virtual-table-body"]').isVisible()).toBe(false)
    expect(wrapper.findAll('[data-testid="file-tile-grid-tile"]')).toHaveLength(2)
  })

  it('keeps the toggle reachable to switch back out of grid mode — the one-way-trip failure mode', async () => {
    const wrapper = await mountPage(fakeBridge({ listContents: twoFiles }))
    const toggle = wrapper.find('[data-testid="file-browser-view-toggle"]')

    await toggle.trigger('click')
    await flushPromises()

    // Re-find rather than reuse the stale VueWrapper: a component that moved
    // the toggle inside the now-hidden table root (the defect this milestone
    // fixes) would make it unreachable here.
    const toggleInGridMode = wrapper.find('[data-testid="file-browser-view-toggle"]')
    expect(toggleInGridMode.exists()).toBe(true)
    expect(toggleInGridMode.isVisible()).toBe(true)

    await toggleInGridMode.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="virtual-table-body"]').isVisible()).toBe(true)
    expect(wrapper.find('[data-testid="file-tile-grid-tile"]').exists()).toBe(false)
  })

  it('keeps aria-label and aria-pressed on the toggle in both modes', async () => {
    const wrapper = await mountPage(fakeBridge({ listContents: twoFiles }))
    const toggle = () => wrapper.find('[data-testid="file-browser-view-toggle"]')

    expect(toggle().attributes('aria-pressed')).toBe('false')
    expect(toggle().attributes('aria-label')).toBe('Switch to grid view')

    await toggle().trigger('click')
    await flushPromises()

    expect(toggle().attributes('aria-pressed')).toBe('true')
    expect(toggle().attributes('aria-label')).toBe('Switch to list view')
  })
})

describe('FileBrowserPage — a file that has a document (M127.3)', () => {
  const fileNode = () => node('/a.pdf', 'file', { fileid: 110 })

  it('opens the document split view instead of the previewer', async () => {
    vi.mocked(documentsService.fetchDocumentByFileId).mockResolvedValue({
      public_id: 'doc-public-1',
    } as never)
    const open = vi.fn()
    ;(globalThis as { OCA?: unknown }).OCA = { Viewer: { open } }
    const wrapper = await mountPage(
      fakeBridge({
        listContents: async () => ({ folderPath: '/', nodes: [fileNode()], folderRaw: { path: '/' } }),
      }),
    )

    await wrapper.find('.virtual-table__row').trigger('click')
    await flushPromises()
    await flushPromises()

    expect(documentsService.fetchDocumentByFileId).toHaveBeenCalledWith(110)
    expect(router.currentRoute.value.name).toBe('document-viewer')
    expect(router.currentRoute.value.params.docId).toBe('doc-public-1')
    // The previewer is NOT also opened — that would put two things on screen.
    expect(open).not.toHaveBeenCalled()
  })

  it('falls back to the previewer, silently, when the file has no document', async () => {
    // The common case: most files are not documents, and a just-ingested one is
    // still pending. It must not read as an error.
    const open = vi.fn()
    ;(globalThis as { OCA?: unknown }).OCA = { Viewer: { open } }
    const wrapper = await mountPage(
      fakeBridge({
        listContents: async () => ({ folderPath: '/', nodes: [fileNode()], folderRaw: { path: '/' } }),
      }),
    )

    await wrapper.find('.virtual-table__row').trigger('click')
    await flushPromises()
    await flushPromises()

    expect(open).toHaveBeenCalledWith({ path: '/a.pdf' })
    expect(wrapper.find('[data-testid="file-browser-error"]').exists()).toBe(false)
    expect(router.currentRoute.value.name).toBe('file-browser')
  })

  it('says so when the lookup itself fails, rather than quietly previewing', async () => {
    // A network error or a 5xx is not "no document": the app does not know, and
    // the user's click deserves an answer.
    vi.mocked(documentsService.fetchDocumentByFileId).mockRejectedValue(new Error('503'))
    const open = vi.fn()
    ;(globalThis as { OCA?: unknown }).OCA = { Viewer: { open } }
    const wrapper = await mountPage(
      fakeBridge({
        listContents: async () => ({ folderPath: '/', nodes: [fileNode()], folderRaw: { path: '/' } }),
      }),
    )

    await wrapper.find('.virtual-table__row').trigger('click')
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('[data-testid="file-browser-error"]').text()).toContain('503')
    expect(open).not.toHaveBeenCalled()
  })

  it('never looks a folder up: a folder click still navigates', async () => {
    const wrapper = await mountPage(
      fakeBridge({
        listContents: async () => ({
          folderPath: '/',
          nodes: [node('/Invoices', 'folder', { fileid: 99 })],
          folderRaw: { path: '/' },
        }),
      }),
    )

    await wrapper.find('.virtual-table__row').trigger('click')
    await flushPromises()

    expect(documentsService.fetchDocumentByFileId).not.toHaveBeenCalled()
    expect(router.currentRoute.value.query.dir).toBe('/Invoices')
  })

  it('previews a node with no fileid rather than calling the lookup with nothing', async () => {
    const open = vi.fn()
    ;(globalThis as { OCA?: unknown }).OCA = { Viewer: { open } }
    const wrapper = await mountPage(
      fakeBridge({
        listContents: async () => ({ folderPath: '/', nodes: [node('/a.pdf', 'file')], folderRaw: {} }),
      }),
    )

    await wrapper.find('.virtual-table__row').trigger('click')
    await flushPromises()

    expect(documentsService.fetchDocumentByFileId).not.toHaveBeenCalled()
    expect(open).toHaveBeenCalled()
  })
})

// Phase 145 — All files / Recent / Favorites are the same table under a
// different filter, so they render as TABS inside this page rather than as
// separate nav entries (AppNavigation.vue owns the nav side of this). The
// route for each stays exactly as it was (`/browse/files`, `/browse/recent`,
// `/browse/favorites`); a tab is only a link to it.
describe('FileBrowserPage — All files/Recent/Favorites tabs', () => {
  function bridgeWithViews(): Bridge {
    const views: Record<string, BridgeView> = {
      files: { id: 'files', name: 'All files', columns: [] },
      recent: { id: 'recent', name: 'Recent', columns: [] },
      favorites: { id: 'favorites', name: 'Favorites', columns: [] },
      trashbin: { id: 'trashbin', name: 'Deleted files', columns: [] },
    }
    return fakeBridge({
      view: (id: string) => views[id],
      listContents: async () => ({ folderPath: '/', nodes: [], folderRaw: { path: '/' } }),
    })
  }

  it('renders All files/Recent/Favorites tabs, with the current view active', async () => {
    const wrapper = await mountPage(bridgeWithViews(), '/browse/files')

    expect(wrapper.find('[data-testid="file-browser-tabs"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="file-browser-tab-files"]').text()).toBe('All files')
    expect(wrapper.find('[data-testid="file-browser-tab-recent"]').text()).toBe('Recent')
    expect(wrapper.find('[data-testid="file-browser-tab-favorites"]').text()).toBe('Favorites')
    expect(wrapper.find('[data-testid="file-browser-tab-files"]').attributes('aria-selected')).toBe(
      'true',
    )
    expect(
      wrapper.find('[data-testid="file-browser-tab-recent"]').attributes('aria-selected'),
    ).toBe('false')
  })

  it('does not render tabs for a view outside the All files/Recent/Favorites group', async () => {
    const wrapper = await mountPage(bridgeWithViews(), '/browse/trashbin')

    expect(wrapper.find('[data-testid="file-browser-tabs"]').exists()).toBe(false)
  })

  it('clicking a tab navigates to that view\'s own route, leaving it resolvable', async () => {
    const wrapper = await mountPage(bridgeWithViews(), '/browse/files')

    await wrapper.find('[data-testid="file-browser-tab-favorites"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('file-browser')
    expect(router.currentRoute.value.params.viewId).toBe('favorites')
  })
})

// M161.3 (backlog/v1.md Phase 161): a file-name search field beside the tab
// strip, filtering the ALREADY-LOADED listing — it must never issue a
// request, so these tests assert on the fake bridge's own listContents call
// count, not just on what's rendered (a server-search implementation would
// still pass every rendering-only assertion here).
describe('FileBrowserPage — file-name search field (M161.3)', () => {
  const threeFiles = async () => ({
    folderPath: '/',
    nodes: [
      node('/Invoices', 'folder'),
      node('/annual-report.pdf', 'file'),
      node('/budget.xlsx', 'file'),
    ],
    folderRaw: { path: '/' },
  })

  function searchField(wrapper: ReturnType<typeof mount>) {
    return wrapper.findComponent(NcTextField)
  }

  async function typeSearch(wrapper: ReturnType<typeof mount>, value: string): Promise<void> {
    await searchField(wrapper).vm.$emit('update:modelValue', value)
    await vi.advanceTimersByTimeAsync(MOMENTUM_CONFIG.SEARCH_DEBOUNCE_MS)
    await flushPromises()
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders a search field beside the tab strip', async () => {
    const wrapper = await mountPage(fakeBridge({ listContents: threeFiles }))

    expect(searchField(wrapper).exists()).toBe(true)
  })

  it('filters the rendered rows by file name after the debounce settles', async () => {
    const wrapper = await mountPage(fakeBridge({ listContents: threeFiles }))

    await typeSearch(wrapper, 'budget')

    const text = wrapper.text()
    expect(text).toContain('budget.xlsx')
    expect(text).not.toContain('annual-report.pdf')
    expect(text).not.toContain('Invoices')
  })

  it('issues no request when the field is typed into — a local filter, not a server search', async () => {
    const listContents = vi.fn(threeFiles)
    const wrapper = await mountPage(fakeBridge({ listContents }))
    listContents.mockClear()

    await typeSearch(wrapper, 'budget')

    expect(listContents).not.toHaveBeenCalled()
  })

  it('shows the SAME filtered set in the table and the grid, with the item count agreeing with both', async () => {
    const wrapper = await mountPage(fakeBridge({ listContents: threeFiles }))

    await typeSearch(wrapper, 'annual')

    expect(wrapper.find('[data-testid="file-browser-item-count"]').text()).toBe('1 item')
    expect(wrapper.findAll('.virtual-table__row--clickable')).toHaveLength(1)

    await wrapper.find('[data-testid="file-browser-view-toggle"]').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('[data-testid="file-tile-grid-tile"]')).toHaveLength(1)
    const text = wrapper.text()
    expect(text).toContain('annual-report.pdf')
    expect(text).not.toContain('budget.xlsx')
  })

  it('restores the full listing when the field is cleared', async () => {
    const wrapper = await mountPage(fakeBridge({ listContents: threeFiles }))

    await typeSearch(wrapper, 'budget')
    expect(wrapper.find('[data-testid="file-browser-item-count"]').text()).toBe('1 item')

    await typeSearch(wrapper, '')

    expect(wrapper.find('[data-testid="file-browser-item-count"]').text()).toBe('3 items')
    const text = wrapper.text()
    expect(text).toContain('Invoices')
    expect(text).toContain('annual-report.pdf')
    expect(text).toContain('budget.xlsx')
  })

  it('is not inside the tab strip\'s role="tablist" subtree', async () => {
    const wrapper = await mountPage(fakeBridge({ listContents: threeFiles }))

    const tablist = wrapper.find('[role="tablist"]')
    expect(tablist.exists()).toBe(true)
    expect(tablist.findComponent(NcTextField).exists()).toBe(false)
  })
})

// M145.2 — the gate for M145.1: personal/recent/favorites lost their OWN nav
// entry (AppNavigation.unit.test.ts's "collapses …" test), but their ROUTE
// must still resolve and their view must still render. Rendering the "Files"
// tab strip is not evidence of this — the tab strip only proves the merged
// entry renders; a route that 404s or a view that fails to mount would pass
// every tab-only assertion above while this milestone's whole reason for
// existing goes unmet. Derived from CONSOLIDATED_FILE_VIEW_IDS (the same
// constant AppNavigation.vue itself collapses on) rather than a hand-copied
// list, so this can't silently drift from what the nav actually removed.
// 'files' is excluded: it kept its own nav entry (renamed "Files"), so it was
// never removed from the rail — only personal/recent/favorites were.
describe('FileBrowserPage — routes Phase 145 removed from the nav rail still resolve and render (M145.2)', () => {
  const removedFromNavViewIds = CONSOLIDATED_FILE_VIEW_IDS.filter((id) => id !== 'files')

  it('removed at least the personal/recent/favorites view ids (sanity on the derivation itself)', () => {
    expect(removedFromNavViewIds).toEqual(expect.arrayContaining(['personal', 'recent', 'favorites']))
  })

  it.each(removedFromNavViewIds)(
    'the production router still resolves /browse/%s to the file-browser route',
    (viewId) => {
      const resolved = appRouter.resolve(`/browse/${viewId}`)

      expect(resolved.name).toBe('file-browser')
      expect(resolved.params.viewId).toBe(viewId)
    },
  )

  it.each(removedFromNavViewIds)(
    'FileBrowserPage still mounts and renders that view\'s own content at /browse/%s',
    async (viewId) => {
      const marker = `${viewId}-marker.pdf`
      const wrapper = await mountPage(
        fakeBridge({
          view: (id: string) => (id === viewId ? { id, name: viewId, columns: [] } : undefined),
          listContents: async () => ({
            folderPath: '/',
            nodes: [node(`/${marker}`, 'file')],
            folderRaw: { path: '/' },
          }),
        }),
        `/browse/${viewId}`,
      )

      // A view whose route silently stopped resolving would leave this page
      // blank (or throw); asserting on data fetched THROUGH that view's own
      // id — not on a tab label — is what proves the route, not just the
      // component file, survived.
      expect(wrapper.text()).toContain(marker)
    },
  )
})

// M142.2 (backlog/v1.md) — frontend.md § Processing progress: the AI status
// strip. Driven purely by polling GET /stats/overview for tenant-wide
// pending/processing counts — not tied to this page's own upload button, so
// it reflects pipeline activity from any source.
describe('FileBrowserPage — AI status strip', () => {
  function strip(wrapper: ReturnType<typeof mount>) {
    return wrapper.find('[data-testid="file-browser-ai-strip"]')
  }

  function statsOverview(statuses: Array<{ status: string; total: number }>) {
    return { statuses, total: 0, types: [] } as never
  }

  afterEach(() => {
    // Unmount BEFORE switching back to real timers: the top-level afterEach
    // also unmounts, but describe-local afterEach hooks run before it, so
    // leaving this to that one would call `onUnmounted`'s `clearInterval`
    // under real timers on an interval id the FAKE timer implementation
    // handed out — a no-op that would leak the fake poll interval across
    // test files sharing this worker.
    mounted?.unmount()
    mounted = undefined
    vi.useRealTimers()
  })

  it('shows no strip when nothing is pending or processing', async () => {
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(
      statsOverview([{ status: 'done', total: 3 }]),
    )
    const wrapper = await mountPage(fakeBridge({}))
    await flushPromises()

    expect(strip(wrapper).exists()).toBe(false)
  })

  it('shows the reading message and count as soon as anything is in flight', async () => {
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(
      statsOverview([{ status: 'pending', total: 5 }]),
    )
    const wrapper = await mountPage(fakeBridge({}))
    await flushPromises()

    expect(strip(wrapper).text()).toContain('Reading 5 documents')
    expect(strip(wrapper).text()).toContain('0 of 5')
  })

  it('sums pending and processing counts', async () => {
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(
      statsOverview([
        { status: 'pending', total: 2 },
        { status: 'processing', total: 3 },
      ]),
    )
    const wrapper = await mountPage(fakeBridge({}))
    await flushPromises()

    expect(strip(wrapper).text()).toContain('0 of 5')
  })

  it('tracks progress against the peak in-flight seen across polls, not the latest total', async () => {
    vi.useFakeTimers()
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(
      statsOverview([{ status: 'pending', total: 5 }]),
    )
    const wrapper = await mountPage(fakeBridge({}))
    await flushPromises()
    expect(strip(wrapper).text()).toContain('0 of 5')

    // In-flight shrank to 3 — 2 of the original 5 finished, so the strip
    // keeps counting against the peak (5) rather than resetting to "0 of 3".
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(
      statsOverview([{ status: 'processing', total: 3 }]),
    )
    await vi.advanceTimersByTimeAsync(MOMENTUM_CONFIG.DOCUMENT_POLL_INTERVAL_MS)
    expect(strip(wrapper).text()).toContain('Reading 5 documents')
    expect(strip(wrapper).text()).toContain('2 of 5')

    // Back down to zero in flight — the strip hides.
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(statsOverview([]))
    await vi.advanceTimersByTimeAsync(MOMENTUM_CONFIG.DOCUMENT_POLL_INTERVAL_MS)
    expect(strip(wrapper).exists()).toBe(false)
  })

  it('starts a fresh peak once a new batch begins after the strip went idle', async () => {
    vi.useFakeTimers()
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(statsOverview([]))
    const wrapper = await mountPage(fakeBridge({}))
    await flushPromises()
    expect(strip(wrapper).exists()).toBe(false)

    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(
      statsOverview([{ status: 'pending', total: 2 }]),
    )
    await vi.advanceTimersByTimeAsync(MOMENTUM_CONFIG.DOCUMENT_POLL_INTERVAL_MS)

    // Not "0 of 5" left over from a previous batch — a fresh peak of 2.
    expect(strip(wrapper).text()).toContain('Reading 2 documents')
    expect(strip(wrapper).text()).toContain('0 of 2')
  })

  it('keeps the strip up on a transient poll failure rather than hiding it', async () => {
    vi.useFakeTimers()
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(
      statsOverview([{ status: 'pending', total: 4 }]),
    )
    const wrapper = await mountPage(fakeBridge({}))
    await flushPromises()
    expect(strip(wrapper).text()).toContain('0 of 4')

    vi.mocked(documentsService.fetchStatsOverview).mockRejectedValueOnce(new Error('503'))
    await vi.advanceTimersByTimeAsync(MOMENTUM_CONFIG.DOCUMENT_POLL_INTERVAL_MS)

    expect(strip(wrapper).text()).toContain('0 of 4')
  })

  it('clears the poll timer on unmount', async () => {
    vi.useFakeTimers()
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    const wrapper = await mountPage(fakeBridge({}))
    await flushPromises()

    wrapper.unmount()
    mounted = undefined

    expect(clearIntervalSpy).toHaveBeenCalled()
    const callCountAtUnmount = vi.mocked(documentsService.fetchStatsOverview).mock.calls.length
    await vi.advanceTimersByTimeAsync(MOMENTUM_CONFIG.AI_STRIP_POLL_INTERVAL_MS * 3)
    expect(vi.mocked(documentsService.fetchStatsOverview).mock.calls.length).toBe(callCountAtUnmount)
  })

  // M157.1: `done` must never regress when documents arrive mid-batch — the
  // defect this milestone exists to fix. Sequence taken straight from the
  // issue: in-flight 10 -> 5 -> 8 -> 4, and `done`/`total` at each step.
  it('never regresses done when new documents arrive while a batch is still in flight', async () => {
    vi.useFakeTimers()
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(
      statsOverview([{ status: 'pending', total: 10 }]),
    )
    const wrapper = await mountPage(fakeBridge({}))
    await flushPromises()
    expect(strip(wrapper).text()).toContain('0 of 10')

    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(
      statsOverview([{ status: 'processing', total: 5 }]),
    )
    await vi.advanceTimersByTimeAsync(MOMENTUM_CONFIG.AI_STRIP_POLL_INTERVAL_MS)
    expect(strip(wrapper).text()).toContain('5 of 10')

    // 3 more documents arrived while 5 were still in flight (8 in flight now)
    // — total grows to 13, and done must NOT drop back to 2.
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(
      statsOverview([{ status: 'processing', total: 8 }]),
    )
    await vi.advanceTimersByTimeAsync(MOMENTUM_CONFIG.AI_STRIP_POLL_INTERVAL_MS)
    expect(strip(wrapper).text()).toContain('5 of 13')

    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(
      statsOverview([{ status: 'processing', total: 4 }]),
    )
    await vi.advanceTimersByTimeAsync(MOMENTUM_CONFIG.AI_STRIP_POLL_INTERVAL_MS)
    expect(strip(wrapper).text()).toContain('9 of 13')
  })

  // M157.2: a persistently-failing poll (not a one-off transient failure)
  // must stop asserting a count it can no longer substantiate.
  it('marks the strip stale after enough consecutive poll failures in a row', async () => {
    vi.useFakeTimers()
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(
      statsOverview([{ status: 'pending', total: 7 }]),
    )
    const wrapper = await mountPage(fakeBridge({}))
    await flushPromises()
    expect(strip(wrapper).text()).toContain('0 of 7')

    vi.mocked(documentsService.fetchStatsOverview).mockRejectedValue(new Error('403'))
    for (let i = 0; i < MOMENTUM_CONFIG.AI_STRIP_STALE_AFTER_FAILURES - 1; i++) {
      await vi.advanceTimersByTimeAsync(MOMENTUM_CONFIG.AI_STRIP_POLL_INTERVAL_MS)
      expect(strip(wrapper).text()).toContain('0 of 7')
    }

    await vi.advanceTimersByTimeAsync(MOMENTUM_CONFIG.AI_STRIP_POLL_INTERVAL_MS)
    expect(strip(wrapper).text()).not.toContain('0 of 7')
    expect(strip(wrapper).exists()).toBe(true)
  })

  // M157.3: the strip's poll must use its own interval constant, not
  // DOCUMENT_POLL_INTERVAL_MS (a different contract — a single document's
  // pending/processing poll vs. this tenant-wide, unconditional-from-mount
  // poll).
  it('sets up its poll timer with AI_STRIP_POLL_INTERVAL_MS', async () => {
    vi.useFakeTimers()
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(statsOverview([]))
    await mountPage(fakeBridge({}))
    await flushPromises()

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), MOMENTUM_CONFIG.AI_STRIP_POLL_INTERVAL_MS)
  })
})

// M171.2 (backlog/v1.md Phase 171): the item count moves above the tab strip
// to match the mockup, while M158.1's tabs-before-strip order is left
// untouched — asserted via DOM_POSITION_PRECEDING/FOLLOWING rather than mere
// existence, since both elements already exist today in the wrong order (an
// existence check passes on the defect).
describe('FileBrowserPage — item count position (M171.2)', () => {
  function statsOverview(statuses: Array<{ status: string; total: number }>) {
    return { statuses, total: 0, types: [] } as never
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the item count above the tab strip', async () => {
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(statsOverview([]))
    const wrapper = await mountPage(fakeBridge({}))
    await flushPromises()

    const itemCount = wrapper.get('[data-testid="file-browser-item-count"]').element
    const tabsRow = wrapper.get('[data-testid="file-browser-tabs"]').element

    // eslint-disable-next-line no-bitwise
    expect(
      itemCount.compareDocumentPosition(tabsRow) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('leaves the tab strip rendered before the AI status strip, unchanged by M158.1', async () => {
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(
      statsOverview([{ status: 'pending', total: 5 }]),
    )
    const wrapper = await mountPage(fakeBridge({}))
    await flushPromises()

    const tabsRow = wrapper.get('[data-testid="file-browser-tabs"]').element
    const aiStrip = wrapper.get('[data-testid="file-browser-ai-strip"]').element

    // eslint-disable-next-line no-bitwise
    expect(
      tabsRow.compareDocumentPosition(aiStrip) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('keeps the tab strip mounted regardless of whether the item count is showing', async () => {
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(statsOverview([]))
    const wrapper = await mountPage(fakeBridge({}))
    await flushPromises()

    expect(wrapper.find('[data-testid="file-browser-tabs"]').exists()).toBe(true)
  })
})

// Phase 178 / M178.3: `.momentum-page__tabs-row` used to carry the same
// collapse-navigation-toggle margin as `.momentum-page__toolbar`
// (M75.1/M90.1 via M158.2), but M171.2 moved the item count above the tab
// strip and into the toggle's band instead — measured live, the tab strip no
// longer overlaps the toggle at all, so the margin only reserved footprint
// for a control it cannot collide with. This asserts BOTH halves: the tab
// strip's margin is gone AND the toolbar — which still shares the toggle's
// band — keeps its own margin, so a change that also stripped the toolbar's
// margin (the fifth-occurrence failure mode the phase note warns about)
// fails this test too.
describe('FileBrowserPage — tab strip no longer reserves the toggle offset (Phase 178 / M178.3)', () => {
  it('removes the margin from the tab strip while the toolbar keeps clearing the toggle', async () => {
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue({ statuses: [], total: 0, types: [] } as never)
    const wrapper = await mountPage(fakeBridge({}))
    await flushPromises()

    const toolbar = wrapper.find('.momentum-page__toolbar').element as HTMLElement
    const tabsRow = wrapper.find('.momentum-page__tabs-row').element as HTMLElement

    const toggleOffset = 'var(--default-clickable-area, 44px)'
    expect(getComputedStyle(toolbar).marginInlineStart).toBe(toggleOffset)
    expect(getComputedStyle(tabsRow).marginInlineStart).not.toBe(toggleOffset)
  })
})
