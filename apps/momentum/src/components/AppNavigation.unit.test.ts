import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'
import AppNavigation from './AppNavigation.vue'
import RecentDocumentsPage from '../views/RecentDocumentsPage.vue'
import FileBrowserPage from '../views/FileBrowserPage.vue'
import * as documentsService from '../services/documents'
import { ncFilesBridge } from '../services/ncFilesBridgeRuntime'
import { buildNavTree, toBridgeNode } from '../services/ncFilesBridge'
import { router as appRouter } from '../router/index'
import type { Bridge, BridgeView, RawView } from '../services/ncFilesBridge'

// frontend.md § Navigation Tree Additions — Recent Documents (always present),
// Documents (AI Filing) with one per-type sub-entry loaded from
// GET /document-types (in display_name order, no hardcoded type names), and
// Ask Filo. A brand-new tenant with no classified documents yet sees no type
// entries at all until GET /document-types returns some.

vi.mock('../services/documents')
// The runtime bridge is mocked, not the pure module: importing
// ncFilesBridgeRuntime for real would pull in `@nextcloud/files/dav` → the
// `webdav` package, which is not loadable in this jsdom run. The nav's own
// logic (which entries, nesting, order) lives in the pure `buildNavTree`, so
// the fake below deliberately uses the REAL implementation of it — the mock
// replaces the Nextcloud runtime, not the behaviour under test.
// A factory, not an automock: automocking imports the real module to derive
// its shape, which is exactly what must not happen here.
vi.mock('../services/ncFilesBridgeRuntime', () => ({
  ncFilesBridge: vi.fn(),
  setNcFilesBridgeForTesting: vi.fn(),
}))

// Mirrors the registry measured on NC 34 (see ncFilesBridge.unit.test.ts).
const FILE_VIEWS: RawView[] = [
  { id: 'files', name: 'All files', order: 0, getContents: async () => ({ contents: [] }) },
  { id: 'shareoverview', name: 'Shares', order: 20, getContents: async () => ({ contents: [] }) },
  {
    id: 'sharingin',
    name: 'Shared with you',
    order: 1,
    parent: 'shareoverview',
    getContents: async () => ({ contents: [] }),
  },
  { id: 'trashbin', name: 'Deleted files', order: 50, getContents: async () => ({ contents: [] }) },
]

function stubBridge(views: RawView[] = FILE_VIEWS): void {
  vi.mocked(ncFilesBridge).mockReturnValue({
    navTree: () => buildNavTree(views),
    onViewsChanged: () => () => {},
  } as unknown as ReturnType<typeof ncFilesBridge>)
}

async function mountNav(): Promise<ReturnType<typeof mount>> {
  stubBridge()
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'documents', component: { template: '<div />' } },
      { path: '/type/:typeName', name: 'by-type-document-list', component: { template: '<div />' } },
      { path: '/recent', name: 'recent-documents', component: { template: '<div />' } },
      { path: '/chat', name: 'nl-query', component: { template: '<div />' } },
      { path: '/browse/:viewId', name: 'file-browser', component: { template: '<div />' } },
    ],
  })
  router.push('/')
  await router.isReady()
  const wrapper = mount(AppNavigation, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('AppNavigation', () => {
  it('shows two flat document entries: Documents and Chat', async () => {
    const wrapper = await mountNav()

    expect(wrapper.find('[data-testid="nav-documents"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nav-ask-filo"]').exists()).toBe(true)
    // Renamed from "Ask Filo" 2026-08-26 — the route (nl-query) and testid
    // are unchanged, only the label.
    expect(wrapper.get('[data-testid="nav-ask-filo"]').text()).toBe('Chat')
  })

  // M126.1 — "Recent Documents" was the same table as Documents with the same
  // `created_at DESC` default, so it was a second way to the same place. Its
  // ROUTE stays (deep links, and the M93.2 list-scroll check target it); only
  // the nav entry is gone.
  it('no longer offers a Recent Documents entry', async () => {
    const wrapper = await mountNav()

    expect(wrapper.find('[data-testid="nav-recent"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Recent Documents')
  })

  // M125.3 — document type became a sortable/filterable COLUMN of the
  // Documents table, so the nav no longer carries one entry per type. It also
  // no longer asks for the type registry at all: an entry per type was the only
  // reason it ever did.
  it('renders no per-type entries and does not load the type registry', async () => {
    vi.mocked(documentsService.fetchDocumentTypes).mockResolvedValue([
      { type_name: 'invoice', display_name: 'Invoices' },
      { type_name: 'contract', display_name: 'Contracts' },
    ])

    const wrapper = await mountNav()

    expect(wrapper.findAll('[data-testid="nav-type-item"]')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('Invoices')
    expect(documentsService.fetchDocumentTypes).not.toHaveBeenCalled()
  })

  it('has no collapsible document entry left to expand', async () => {
    // The old entry was `allow-collapse` with a chevron; a leftover collapse
    // affordance with nothing behind it is worse than none.
    const wrapper = await mountNav()

    expect(wrapper.find('[data-testid="nav-documents"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nav-documents"] .app-navigation-entry__children').exists()).toBe(
      false,
    )
  })

  it('links Documents and Chat to their routes', async () => {
    const wrapper = await mountNav()
    const router = wrapper.vm.$.appContext.config.globalProperties.$router

    await wrapper.find('[data-testid="nav-documents"] a').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('documents')

    await wrapper.find('[data-testid="nav-ask-filo"] a').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('nl-query')
  })
})

describe('AppNavigation — Nextcloud file views (frontend.md § Files & Shares Bridge)', () => {
  it('lists the registry views and nests the sharing views under Shares', async () => {
    vi.mocked(documentsService.fetchDocumentTypes).mockResolvedValue([])

    const wrapper = await mountNav()

    const names = wrapper
      .findAll('[data-testid="nav-file-view"]')
      .map((item) => item.text())
      .join(' ')
    expect(names).toContain('Files')
    expect(names).toContain('Shares')
    expect(names).toContain('Deleted files')
    // "Shared with you" is a CHILD of Shares, never a top-level entry.
    expect(wrapper.findAll('[data-testid="nav-file-view-child"]').map((c) => c.text())).toEqual([
      'Shared with you',
    ])
  })

  it('links each view at its own browse route', async () => {
    vi.mocked(documentsService.fetchDocumentTypes).mockResolvedValue([])

    const wrapper = await mountNav()

    const hrefs = wrapper.findAll('a').map((a) => a.attributes('href'))
    expect(hrefs).toContain('/browse/files')
    expect(hrefs).toContain('/browse/sharingin')
  })

  // Phase 145 — All files / Personal files / Recent / Favorites are the same
  // table under a different filter; they collapse into ONE "Files" entry
  // rather than four separate rail entries. Tags is hidden from the rail
  // outright (Phase 150, M150.1) — five rail entries total: Documents, Chat,
  // Files, Shares, Deleted files.
  it('collapses All files/Personal files/Recent/Favorites into one Files entry, and hides Tags', async () => {
    vi.mocked(documentsService.fetchDocumentTypes).mockResolvedValue([])
    stubBridge([
      { id: 'files', name: 'All files', order: 0, getContents: async () => ({ contents: [] }) },
      { id: 'personal', name: 'Personal files', order: 5, getContents: async () => ({ contents: [] }) },
      { id: 'recent', name: 'Recent', order: 10, getContents: async () => ({ contents: [] }) },
      { id: 'favorites', name: 'Favorites', order: 15, getContents: async () => ({ contents: [] }) },
      { id: 'shareoverview', name: 'Shares', order: 20, getContents: async () => ({ contents: [] }) },
      { id: 'tags', name: 'Tags', order: 30, getContents: async () => ({ contents: [] }) },
      { id: 'trashbin', name: 'Deleted files', order: 50, getContents: async () => ({ contents: [] }) },
    ])

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'documents', component: { template: '<div />' } },
        { path: '/type/:typeName', name: 'by-type-document-list', component: { template: '<div />' } },
        { path: '/recent', name: 'recent-documents', component: { template: '<div />' } },
        { path: '/chat', name: 'nl-query', component: { template: '<div />' } },
        { path: '/browse/:viewId', name: 'file-browser', component: { template: '<div />' } },
      ],
    })
    router.push('/')
    await router.isReady()
    const wrapper = mount(AppNavigation, { global: { plugins: [router] } })
    await flushPromises()

    const items = wrapper.findAll('[data-testid="nav-file-view"]')
    expect(items.map((item) => item.text())).toEqual(['Files', 'Shares', 'Deleted files'])
    expect(items[0].find('a').attributes('href')).toBe('/browse/files')
  })

  // Phase 150 (M150.1) — Tags loses its nav entry, but the route stays
  // reachable ("hide, don't remove" for the route; only the rail changes).
  it('the tags route still resolves even though it has no nav entry', () => {
    const resolved = appRouter.resolve('/browse/tags')

    expect(resolved.name).toBe('file-browser')
    expect(resolved.params.viewId).toBe('tags')
  })

  // M150.2 — same shape as M145.2's RecentDocumentsPage check: a resolved
  // route name proves nothing about whether the page behind it actually
  // renders. Mount FileBrowserPage at /browse/tags directly and assert on
  // data fetched THROUGH the page, not just a route object existing.
  it('FileBrowserPage still mounts and renders at /browse/tags, not just a registered path', async () => {
    const TAGS_VIEW: BridgeView = { id: 'tags', name: 'Tags', columns: [] }
    const tagsBridge: Bridge = {
      views: () => [TAGS_VIEW],
      navTree: () => [{ view: TAGS_VIEW, children: [] }],
      view: (id: string) => (id === TAGS_VIEW.id ? TAGS_VIEW : undefined),
      listContents: async () => ({
        folderPath: '/',
        nodes: [
          toBridgeNode({
            path: '/marker-tagged-file.pdf',
            basename: 'marker-tagged-file.pdf',
            type: 'file',
            mime: 'application/pdf',
          }),
        ],
        folderRaw: { path: '/' },
      }),
      actionsFor: () => [],
      runAction: async () => true,
      sidebarAvailable: () => false,
      openSidebar: () => {},
      sidebarTabsFor: async () => [],
      closeSidebar: () => {},
      canUpload: () => false,
      uploadFile: async () => {},
      onViewsChanged: () => () => {},
      newMenuEntries: () => [],
      runNewMenuEntry: () => {},
      listActionsFor: () => [],
      runListAction: async () => true,
      filters: () => [],
      batchActionsFor: () => [],
      runBatchAction: async () => [true],
      sortNodes: (nodes) => nodes,
    } as Bridge
    vi.mocked(ncFilesBridge).mockReturnValue(tagsBridge)
    vi.mocked(documentsService.fetchDocumentByFileId).mockResolvedValue(undefined)
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue({
      statuses: [],
      total: 0,
      types: [],
    } as never)

    const router: Router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/browse/:viewId', name: 'file-browser', component: FileBrowserPage }],
    })
    await router.push('/browse/tags')
    await router.isReady()
    const wrapper = mount(FileBrowserPage, { global: { plugins: [router] } })
    await flushPromises()
    await flushPromises()

    // Asserting on a node fetched THROUGH the page is what proves the route
    // resolved to a working page, not just that a route object with this name
    // exists somewhere.
    expect(wrapper.text()).toContain('marker-tagged-file.pdf')
  })

  // M150.3 — the drift guard for the actual product goal (matching
  // specs/mockup-ai-document-manager.html's rail): the FULL rendered rail,
  // top-level entries only, in DOM order, must be exactly Documents, Chat,
  // Files, Shares, Deleted files — no more, no fewer. Unlike the tests above
  // (which each check one slice: file-view collapsing, Tags hiding, the
  // two flat app entries) this one spans both halves of the rail so it fails
  // if EITHER this phase (Tags reappearing) or Phase 145 (consolidation
  // regressing, e.g. Personal files/Recent/Favorites regaining their own
  // entries) regresses later, and it fails just as hard if the rail gains
  // scope (an extra entry nothing asked for).
  it('renders the nav rail as exactly Documents, Chat, Files, Shares, Deleted files, in that order', async () => {
    vi.mocked(documentsService.fetchDocumentTypes).mockResolvedValue([])
    stubBridge([
      { id: 'files', name: 'All files', order: 0, getContents: async () => ({ contents: [] }) },
      { id: 'personal', name: 'Personal files', order: 5, getContents: async () => ({ contents: [] }) },
      { id: 'recent', name: 'Recent', order: 10, getContents: async () => ({ contents: [] }) },
      { id: 'favorites', name: 'Favorites', order: 15, getContents: async () => ({ contents: [] }) },
      { id: 'shareoverview', name: 'Shares', order: 20, getContents: async () => ({ contents: [] }) },
      {
        id: 'sharingin',
        name: 'Shared with you',
        order: 1,
        parent: 'shareoverview',
        getContents: async () => ({ contents: [] }),
      },
      { id: 'tags', name: 'Tags', order: 30, getContents: async () => ({ contents: [] }) },
      { id: 'trashbin', name: 'Deleted files', order: 50, getContents: async () => ({ contents: [] }) },
    ])

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'documents', component: { template: '<div />' } },
        { path: '/type/:typeName', name: 'by-type-document-list', component: { template: '<div />' } },
        { path: '/recent', name: 'recent-documents', component: { template: '<div />' } },
        { path: '/chat', name: 'nl-query', component: { template: '<div />' } },
        { path: '/browse/:viewId', name: 'file-browser', component: { template: '<div />' } },
      ],
    })
    router.push('/')
    await router.isReady()
    const wrapper = mount(AppNavigation, { global: { plugins: [router] } })
    await flushPromises()

    const topLevel = wrapper.findAll(
      '[data-testid="nav-documents"], [data-testid="nav-ask-filo"], [data-testid="nav-file-view"]',
    )
    // `.text()` on a parent entry also picks up any nested children's text
    // (e.g. Shares' "Shared with you" child), so this reads each entry's OWN
    // label element rather than its full subtree — see the "Shares" case,
    // which nests a child in this test's fixture on purpose.
    expect(topLevel.map((item) => item.get('.app-navigation-entry__name').text().trim())).toEqual([
      'Documents',
      'Chat',
      'Files',
      'Shares',
      'Deleted files',
    ])
  })

  it('shows no file entries at all when the registry never populated', async () => {
    // i.e. core's files-init did not load. The app's own three entries must
    // still render — a missing bridge degrades the nav, it does not break it.
    vi.mocked(documentsService.fetchDocumentTypes).mockResolvedValue([])
    stubBridge([])

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'documents', component: { template: '<div />' } },
        { path: '/type/:typeName', name: 'by-type-document-list', component: { template: '<div />' } },
        { path: '/recent', name: 'recent-documents', component: { template: '<div />' } },
        { path: '/chat', name: 'nl-query', component: { template: '<div />' } },
        { path: '/browse/:viewId', name: 'file-browser', component: { template: '<div />' } },
      ],
    })
    router.push('/')
    await router.isReady()
    const wrapper = mount(AppNavigation, { global: { plugins: [router] } })
    await flushPromises()

    expect(wrapper.findAll('[data-testid="nav-file-view"]')).toHaveLength(0)
    // The app's own entries still render: a missing bridge degrades the nav, it
    // does not break it.
    expect(wrapper.find('[data-testid="nav-documents"]').exists()).toBe(true)
  })
})

// M145.2 — RecentDocumentsPage (this app's OWN documents, not Nextcloud's file
// registry — see M126.1 / the Phase 145 header note on why the two "Recent"s
// must not be conflated) lost its nav entry back in M126.1; its route did
// not, because `scripts/k8s-nc-smoke-test.sh` deep-links `--check=list-scroll`
// straight at `/apps/momentum/recent`. The test above only proves the nav
// entry stays absent — it says nothing about whether the route still
// resolves or the page still renders, which is the actual failure this
// milestone exists to catch (a tab/nav-only test would pass while the deep
// link 404s).
describe('AppNavigation — the Recent Documents ROUTE survives even though its nav entry does not (M145.2)', () => {
  it('the production router still resolves /recent to the recent-documents route', () => {
    const resolved = appRouter.resolve('/recent')

    expect(resolved.name).toBe('recent-documents')
  })

  it('RecentDocumentsPage still mounts and renders at /recent, not just a registered path', async () => {
    vi.mocked(documentsService.fetchSearchDocuments).mockResolvedValue({
      items: [
        {
          public_id: '11111111-1111-1111-1111-111111111111',
          path: '/marker-recent-document.pdf',
          doc_type: 'invoice',
          status: 'done',
          reviewed: false,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
      limit: 50,
    })
    const router: Router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/recent', name: 'recent-documents', component: RecentDocumentsPage },
        { path: '/document/:docId', name: 'document-viewer', component: { template: '<div />' } },
      ],
    })
    router.push('/recent')
    await router.isReady()
    const wrapper = mount(RecentDocumentsPage, { global: { plugins: [router] } })
    const body = wrapper.find('[data-testid="virtual-table-body"]')
    if (body.exists()) {
      Object.defineProperty(body.element, 'clientHeight', { value: 300, configurable: true })
    }
    await flushPromises()

    // Asserting on data fetched THROUGH the page (not on a nav label or tab)
    // is what proves the route resolved to a working page, not just that a
    // route object with this name exists somewhere.
    expect(wrapper.text()).toContain('marker-recent-document.pdf')
  })
})
