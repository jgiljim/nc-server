import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RecentDocumentsPage from './RecentDocumentsPage.vue'
import DocumentList from '../components/DocumentList.vue'
import VirtualTable from '../components/VirtualTable.vue'
import ColumnPicker from '../components/ColumnPicker.vue'
import FilterPicker from '../components/FilterPicker.vue'
import * as documentsService from '../services/documents'
import type { ColumnDef, FilterableField } from '../types'

// frontend.md § Recent Documents (M4.8): the cross-type DocumentList
// instance — GET /search/documents with no type_name, system columns only,
// FilterPicker limited to the built-in fields DocumentList (M4.4) always
// prepends (status/reviewed/direction), and column-picker persistence under
// COLUMN_PICKER_STORAGE_PREFIX + 'recent'.

const NcPopoverStub = {
  name: 'NcPopover',
  props: ['shown'],
  emits: ['update:shown'],
  template: '<div class="nc-popover-stub"><slot name="trigger" :attrs="{}" /><slot /></div>',
}

vi.mock('../services/documents', async () => {
  const actual = await vi.importActual<typeof import('../services/documents')>('../services/documents')
  return { ...actual, fetchSearchDocuments: vi.fn() }
})

vi.mock('@nextcloud/router', () => ({
  generateUrl: (path: string) => `/index.php${path}`,
}))

async function mountPage(query?: Record<string, string>): Promise<{ w: ReturnType<typeof mount>; router: Router }> {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/recent', name: 'recent-documents', component: RecentDocumentsPage },
      { path: '/document/:docId', name: 'document-viewer', component: { template: '<div/>' } },
    ],
  })
  router.push({ path: '/recent', query })
  await router.isReady()
  const w = mount(RecentDocumentsPage, {
    global: { plugins: [router], stubs: { NcPopover: NcPopoverStub } },
  })
  const body = w.find('[data-testid="virtual-table-body"]')
  if (body.exists()) {
    Object.defineProperty(body.element, 'clientHeight', { value: 300, configurable: true })
  }
  await flushPromises()
  return { w, router }
}

describe('RecentDocumentsPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('mounts DocumentList with the system columns, all visible by default', async () => {
    vi.mocked(documentsService.fetchSearchDocuments).mockResolvedValue({ items: [], limit: 50 })

    const { w } = await mountPage()

    const list = w.findComponent(DocumentList)
    const columns = list.props('columns') as ColumnDef[]
    expect(columns.map((c) => c.key)).toEqual([
      'filename',
      'doc_type',
      'created_at',
      'updated_at',
      'status',
      'reviewed',
    ])
    const table = w.findComponent(VirtualTable)
    expect((table.props('columns') as ColumnDef[]).map((c) => c.key)).toEqual(
      columns.map((c) => c.key),
    )
  })

  // backlog Phase 90 / M90.1: this page has no heading row above
  // DocumentList (unlike ByTypeDocumentListPage), so its toolbar sits
  // directly under NcAppContent's collapse-navigation toggle and must opt
  // into DocumentList's own nav-toggle-corner reservation.
  it('mounts DocumentList with reserveNavToggleCorner set (M90.1)', async () => {
    vi.mocked(documentsService.fetchSearchDocuments).mockResolvedValue({ items: [], limit: 50 })
    const { w } = await mountPage()
    expect(w.findComponent(DocumentList).props('reserveNavToggleCorner')).toBe(true)
  })

  // backlog Phase 93 / M93.1: without this height chain, .virtual-table
  // never becomes the scroller (NC's own content pane scrolls instead) and
  // the virtualiser only ever renders its first window — copies the pattern
  // ByTypeDocumentListPage already gets right.
  it('propagates the content pane height down to DocumentList (M93.1)', async () => {
    vi.mocked(documentsService.fetchSearchDocuments).mockResolvedValue({ items: [], limit: 50 })
    const { w } = await mountPage()
    expect(w.find('.momentum-page--recent-documents').exists()).toBe(true)
    expect(w.findComponent(DocumentList).classes()).toContain('momentum-recent-documents__list')
  })

  it('never includes doc_id in the columns passed to ColumnPicker/DocumentList (Phase 50 static exclusion)', async () => {
    vi.mocked(documentsService.fetchSearchDocuments).mockResolvedValue({ items: [], limit: 50 })
    const { w } = await mountPage()
    const columns = w.findComponent(DocumentList).props('columns') as ColumnDef[]
    expect(columns.some((c) => c.key === 'doc_id')).toBe(false)
  })

  it('marks the built-in status/reviewed/doc_type/created_at/updated_at columns as sortable (M33.4, M36.4)', async () => {
    vi.mocked(documentsService.fetchSearchDocuments).mockResolvedValue({ items: [], limit: 50 })
    const { w } = await mountPage()
    const columns = w.findComponent(DocumentList).props('columns') as ColumnDef[]
    const sortable = columns.filter((c) => c.sortable).map((c) => c.key)
    expect(sortable).toEqual(['doc_type', 'created_at', 'updated_at', 'status', 'reviewed'])
  })

  it('marks the updated_at column as cursor-paginated (M36.4)', async () => {
    vi.mocked(documentsService.fetchSearchDocuments).mockResolvedValue({ items: [], limit: 50 })
    const { w } = await mountPage()
    const columns = w.findComponent(DocumentList).props('columns') as ColumnDef[]
    expect(columns.find((c) => c.key === 'updated_at')?.cursorPaginated).toBe(true)
  })

  it('does not offer any extracted-field filters, only the built-ins DocumentList prepends', async () => {
    vi.mocked(documentsService.fetchSearchDocuments).mockResolvedValue({ items: [], limit: 50 })
    const { w } = await mountPage()
    expect(w.findComponent(DocumentList).props('filterableFields') as FilterableField[]).toEqual([])
    const picker = w.findComponent(FilterPicker)
    expect((picker.props('fields') as FilterableField[]).map((f) => f.field_name)).toEqual([
      'status',
      'reviewed',
      'direction',
    ])
  })

  it('defaults to sorting by created_at descending and persists columns under "recent"', async () => {
    vi.mocked(documentsService.fetchSearchDocuments).mockResolvedValue({ items: [], limit: 50 })
    const { w } = await mountPage()
    const table = w.findComponent(VirtualTable)
    expect(table.props('activeSort')).toEqual({ column: 'created_at', direction: 'desc' })

    await w.findComponent(ColumnPicker).vm.$emit('change', ['filename', 'status'])
    await flushPromises()
    expect(window.localStorage.getItem('momentum_columns_recent')).toBe(
      JSON.stringify(['filename', 'status']),
    )
  })

  it('fetches with no type_name filter, mapping search items into table rows', async () => {
    vi.mocked(documentsService.fetchSearchDocuments).mockResolvedValue({
      items: [
        {
          public_id: '42424242-4242-4242-4242-424242424242',
          path: '/Invoices/2026/acme-q1.pdf',
          doc_type: 'commercial_invoice',
          direction: 'inbound',
          status: 'done',
          reviewed: false,
          created_at: '2026-06-24T10:00:00Z',
          updated_at: '2026-06-25T11:00:00Z',
        },
      ],
      limit: 50,
      next_cursor: 'cursor-2',
    })

    const { w } = await mountPage()

    expect(documentsService.fetchSearchDocuments).toHaveBeenCalledWith(
      expect.not.objectContaining({ typeName: expect.anything() }),
    )
    const table = w.findComponent(VirtualTable)
    expect(w.text()).toContain('acme-q1.pdf')
    expect(w.text()).toContain('commercial_invoice')
    expect(table.exists()).toBe(true)
  })

  it('renders "Undefined" for a classifier no-match (M179.3), not a blank cell', async () => {
    // A done document with doc_type_source === 'none' is the classifier's
    // legitimate "no registry type fits" outcome (backlog/v1.md Phase 179) —
    // it must read distinctly from "not classified yet", which stays blank.
    vi.mocked(documentsService.fetchSearchDocuments).mockResolvedValue({
      items: [
        {
          public_id: '42424242-4242-4242-4242-424242424242',
          path: '/Invoices/2026/mystery.pdf',
          doc_type_source: 'none',
          status: 'done',
          reviewed: false,
          created_at: '2026-06-24T10:00:00Z',
          updated_at: '2026-06-25T11:00:00Z',
        },
      ],
      limit: 50,
    })

    const { w } = await mountPage()

    const table = w.findComponent(VirtualTable)
    const fetchPage = table.props('fetchPage') as (cursor?: string) => Promise<{
      items: { cells: Record<string, unknown> }[]
    }>
    const page = await fetchPage()
    expect(page.items[0]?.cells.doc_type).toBe('Undefined')
  })

  it('maps the search item updated_at into the updated_at table cell (M36.4)', async () => {
    vi.mocked(documentsService.fetchSearchDocuments).mockResolvedValue({
      items: [
        {
          public_id: '42424242-4242-4242-4242-424242424242',
          path: '/Invoices/2026/acme-q1.pdf',
          doc_type: 'commercial_invoice',
          status: 'done',
          reviewed: false,
          created_at: '2026-06-24T10:00:00Z',
          updated_at: '2026-06-25T11:00:00Z',
        },
      ],
      limit: 50,
    })

    const { w } = await mountPage()

    const table = w.findComponent(VirtualTable)
    const fetchPage = table.props('fetchPage') as (cursor?: string) => Promise<{
      items: { cells: Record<string, unknown> }[]
    }>
    const page = await fetchPage()
    expect(page.items[0]?.cells.updated_at).toBe('2026-06-25T11:00:00Z')
  })

  it('navigates to the Document Viewer when a row is clicked', async () => {
    vi.mocked(documentsService.fetchSearchDocuments).mockResolvedValue({
      items: [
        {
          public_id: '42424242-4242-4242-4242-424242424242',
          path: '/Invoices/2026/acme-q1.pdf',
          doc_type: 'commercial_invoice',
          status: 'done',
          reviewed: false,
          created_at: '2026-06-24T10:00:00Z',
        },
      ],
      limit: 50,
    })

    const { w, router } = await mountPage()
    const pushSpy = vi.spyOn(router, 'push')
    await w.find('.virtual-table__row--clickable').trigger('click')

    expect(pushSpy).toHaveBeenCalledWith({ name: 'document-viewer', params: { docId: '42424242-4242-4242-4242-424242424242' } })
  })

  // frontend.md § DocumentList toolbar item 5: "Add new" opens the NC
  // Frontend native drag-and-drop/upload UI. DocumentList only emits addNew
  // (DocumentList.unit.test.ts) — found live: neither page ever listened for
  // it, so the button was a dead end with no error and no effect.
  it('opens the Files app in a new tab when DocumentList emits addNew', async () => {
    vi.mocked(documentsService.fetchSearchDocuments).mockResolvedValue({ items: [], limit: 50 })
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    const { w } = await mountPage()

    await w.findComponent(DocumentList).vm.$emit('addNew')

    expect(openSpy).toHaveBeenCalledWith('/index.php/apps/files', '_blank', 'noopener')
  })

  // M178.1 (backlog/v1.md Phase 178): with zero rows VirtualTable's `empty`
  // slot must render actual, readable content — before this milestone it was
  // a 371px void with no text at all.
  describe('empty state (M178.1)', () => {
    it('renders a non-empty NcEmptyContent when there are no recent documents', async () => {
      vi.mocked(documentsService.fetchSearchDocuments).mockResolvedValue({ items: [], limit: 50 })

      const { w } = await mountPage()
      const empty = w.find('.virtual-table__empty')

      expect(empty.exists()).toBe(true)
      expect(empty.text()).not.toBe('')
      expect(empty.text()).toContain('No recent documents')
    })

    it('shows a different message when a filter excludes every row', async () => {
      vi.mocked(documentsService.fetchSearchDocuments).mockResolvedValue({ items: [], limit: 50 })

      const { w } = await mountPage({ f: 'q:search:nope' })
      const empty = w.find('.virtual-table__empty')

      expect(empty.text()).toContain('No documents match your filters')
      expect(empty.text()).not.toContain('No recent documents')
    })
  })
})
