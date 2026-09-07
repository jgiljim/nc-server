import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'
import ByTypeDocumentListPage from './ByTypeDocumentListPage.vue'
import DocumentList from '../components/DocumentList.vue'
import * as documentsService from '../services/documents'

// frontend.md § By-Type Document List (M4.7). G26 (backlog/v1.md, resolved
// 2026-07-15): the row data call is `GET /search/documents?type_name=...`,
// not `type=`.

vi.mock('../services/documents')

vi.mock('@nextcloud/router', () => ({
  generateUrl: (path: string) => `/index.php${path}`,
}))

async function mountPage(initialPath = '/type/invoice'): Promise<{ wrapper: ReturnType<typeof mount>; router: Router }> {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/type/:typeName', name: 'by-type-document-list', component: ByTypeDocumentListPage }],
  })
  router.push(initialPath)
  await router.isReady()
  const wrapper = mount(ByTypeDocumentListPage, {
    global: { plugins: [router], stubs: { DocumentList: true } },
  })
  await flushPromises()
  return { wrapper, router }
}

const SCHEMA = {
  type_name: 'invoice',
  display_name: 'Invoice',
  fields: [
    { field_name: 'invoice_number', display_name: 'Invoice Number', data_type: 'string', operators: ['eq', 'like'], sort_order: 0 },
    { field_name: 'total_amount', display_name: 'Total Amount', data_type: 'double', operators: ['eq', 'gt'], sort_order: 1 },
    { field_name: 'due_date', display_name: 'Due Date', data_type: 'date', operators: ['eq', 'gt'], sort_order: 2 },
    { field_name: 'currency', display_name: 'Currency', data_type: 'string', operators: ['eq'], sort_order: 3 },
    { field_name: 'notes', display_name: 'Notes', data_type: 'string', operators: ['eq'], sort_order: 4 },
  ],
}

const OVERVIEW = {
  types: [{ type_name: 'invoice', display_name: 'Invoice', total: 1247, unreviewed: 89 }],
  total: 1247,
  unreviewed: 89,
}

describe('ByTypeDocumentListPage', () => {
  it('shows a loading indicator while the schema and stats are in flight', async () => {
    let resolveSchema!: (value: documentsService.DocumentTypeSchema) => void
    vi.mocked(documentsService.fetchDocumentTypeSchema).mockReturnValue(
      new Promise((resolve) => {
        resolveSchema = resolve
      }),
    )
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(OVERVIEW)

    const router: Router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/type/:typeName', name: 'by-type-document-list', component: ByTypeDocumentListPage }],
    })
    router.push('/type/invoice')
    await router.isReady()
    const wrapper = mount(ByTypeDocumentListPage, { global: { plugins: [router], stubs: { DocumentList: true } } })

    expect(wrapper.find('[data-testid="loading"]').exists()).toBe(true)

    resolveSchema(SCHEMA)
    await flushPromises()
    expect(wrapper.find('[data-testid="loading"]').exists()).toBe(false)
  })

  it('shows the type display name and total document count from the stats overview', async () => {
    vi.mocked(documentsService.fetchDocumentTypeSchema).mockResolvedValue(SCHEMA)
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(OVERVIEW)

    const { wrapper } = await mountPage()

    expect(wrapper.find('[data-testid="display-name"]').text()).toBe('Invoice')
    expect(wrapper.find('[data-testid="total-count"]').text()).toContain('1247')
  })

  it('falls back to a zero count when the type has no documents in the stats overview yet', async () => {
    vi.mocked(documentsService.fetchDocumentTypeSchema).mockResolvedValue(SCHEMA)
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue({ types: [], total: 0, unreviewed: 0 })

    const { wrapper } = await mountPage()

    expect(wrapper.find('[data-testid="total-count"]').text()).toContain('0')
  })

  // backlog Phase 90 / M90.1: this page reserves NcAppContent's
  // collapse-navigation-toggle footprint on its own heading (the header
  // row above DocumentList), so it must not also ask DocumentList to
  // reserve it on the toolbar (RecentDocumentsPage — with no heading row —
  // does that instead).
  it('does not ask DocumentList to reserve the nav-toggle corner (the heading above it does)', async () => {
    vi.mocked(documentsService.fetchDocumentTypeSchema).mockResolvedValue(SCHEMA)
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(OVERVIEW)

    const { wrapper } = await mountPage()

    expect(wrapper.findComponent(DocumentList).props('reserveNavToggleCorner')).toBeFalsy()
  })

  it('builds the fixed columns plus one per extracted field, ordered by sort_order', async () => {
    vi.mocked(documentsService.fetchDocumentTypeSchema).mockResolvedValue(SCHEMA)
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(OVERVIEW)

    const { wrapper } = await mountPage()

    const list = wrapper.findComponent(DocumentList)
    const columns = list.props('columns') as { key: string }[]
    expect(columns.map((c) => c.key)).toEqual([
      'filename',
      'created_at',
      'updated_at',
      'status',
      'reviewed',
      'invoice_number',
      'total_amount',
      'due_date',
      'currency',
      'notes',
    ])
  })

  it('marks filename and only the first 4 extracted fields (by sort_order) as default-visible', async () => {
    vi.mocked(documentsService.fetchDocumentTypeSchema).mockResolvedValue(SCHEMA)
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(OVERVIEW)

    const { wrapper } = await mountPage()

    const list = wrapper.findComponent(DocumentList)
    const columns = list.props('columns') as { key: string; defaultVisible?: boolean }[]
    const visible = columns.filter((c) => c.defaultVisible).map((c) => c.key)
    expect(visible).toEqual(['filename', 'invoice_number', 'total_amount', 'due_date', 'currency'])
  })

  it('never includes doc_id in the columns passed to ColumnPicker/DocumentList (Phase 50 static exclusion)', async () => {
    vi.mocked(documentsService.fetchDocumentTypeSchema).mockResolvedValue(SCHEMA)
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(OVERVIEW)

    const { wrapper } = await mountPage()

    const list = wrapper.findComponent(DocumentList)
    const columns = list.props('columns') as { key: string }[]
    expect(columns.some((c) => c.key === 'doc_id')).toBe(false)
  })

  it('marks created_at, updated_at, status, reviewed and every extracted-field column as sortable (M33.4/M33.5/M36.4)', async () => {
    vi.mocked(documentsService.fetchDocumentTypeSchema).mockResolvedValue(SCHEMA)
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(OVERVIEW)

    const { wrapper } = await mountPage()

    const list = wrapper.findComponent(DocumentList)
    const columns = list.props('columns') as { key: string; sortable?: boolean }[]
    const sortable = columns.filter((c) => c.sortable).map((c) => c.key)
    expect(sortable).toEqual([
      'created_at',
      'updated_at',
      'status',
      'reviewed',
      'invoice_number',
      'total_amount',
      'due_date',
      'currency',
      'notes',
    ])
  })

  it('marks the updated_at column as cursor-paginated (M36.4)', async () => {
    vi.mocked(documentsService.fetchDocumentTypeSchema).mockResolvedValue(SCHEMA)
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(OVERVIEW)

    const { wrapper } = await mountPage()

    const list = wrapper.findComponent(DocumentList)
    const columns = list.props('columns') as { key: string; cursorPaginated?: boolean }[]
    expect(columns.find((c) => c.key === 'updated_at')?.cursorPaginated).toBe(true)
  })

  it('passes only the extracted fields as filterableFields (built-ins are prepended by DocumentList itself)', async () => {
    vi.mocked(documentsService.fetchDocumentTypeSchema).mockResolvedValue(SCHEMA)
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(OVERVIEW)

    const { wrapper } = await mountPage()

    const list = wrapper.findComponent(DocumentList)
    const fields = list.props('filterableFields') as { field_name: string }[]
    expect(fields.map((f) => f.field_name)).toEqual(['invoice_number', 'total_amount', 'due_date', 'currency', 'notes'])
  })

  it('passes created_at desc as the default sort and the type name as the persist key', async () => {
    vi.mocked(documentsService.fetchDocumentTypeSchema).mockResolvedValue(SCHEMA)
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(OVERVIEW)

    const { wrapper } = await mountPage()

    const list = wrapper.findComponent(DocumentList)
    expect(list.props('defaultSort')).toEqual({ column: 'created_at', direction: 'desc' })
    expect(list.props('persistKey')).toBe('invoice')
  })

  it('fetchPage calls GET /search/documents scoped by type_name (G26: not `type`), mapping sort/filters and rows', async () => {
    vi.mocked(documentsService.fetchDocumentTypeSchema).mockResolvedValue(SCHEMA)
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(OVERVIEW)
    vi.mocked(documentsService.fetchSearchDocuments).mockResolvedValue({
      items: [
        {
          public_id: '42424242-4242-4242-4242-424242424242',
          path: '/Invoices/2026/acme-q1.pdf',
          mime_type: 'application/pdf',
          doc_type: 'invoice',
          status: 'done',
          reviewed: false,
          created_at: '2026-06-24T10:00:00Z',
          updated_at: '2026-06-25T11:00:00Z',
          fields: { invoice_number: 'INV-2026-001', total_amount: 1250 },
        },
      ],
      next_cursor: 'eyJ0cyI6...',
      limit: 50,
    })

    const { wrapper } = await mountPage()
    const list = wrapper.findComponent(DocumentList)
    const fetchPage = list.props('fetchPage') as (
      cursor: string | undefined,
      sort: { column: string; direction: string },
      filters: unknown[],
    ) => Promise<unknown>

    const page = await fetchPage('cursor-1', { column: 'created_at', direction: 'desc' }, [
      { kind: 'field', field_name: 'status', operator: 'eq', value: 'done' },
      { kind: 'search', term: 'acme' },
    ])

    expect(documentsService.fetchSearchDocuments).toHaveBeenCalledWith({
      typeName: 'invoice',
      sort: { column: 'created_at', direction: 'desc' },
      filters: [
        { kind: 'field', field_name: 'status', operator: 'eq', value: 'done' },
        { kind: 'search', term: 'acme' },
      ],
      cursor: 'cursor-1',
    })
    expect(page).toEqual({
      items: [
        {
          id: '42424242-4242-4242-4242-424242424242',
          cells: {
            filename: 'acme-q1.pdf',
            mime_type: 'application/pdf',
            created_at: '2026-06-24T10:00:00Z',
            updated_at: '2026-06-25T11:00:00Z',
            status: 'done',
            reviewed: false,
            snippet: null,
            invoice_number: 'INV-2026-001',
            total_amount: 1250,
          },
        },
      ],
      next_cursor: 'eyJ0cyI6...',
      limit: 50,
    })
  })

  // frontend.md § DocumentList toolbar item 5: "Add new" opens the NC
  // Frontend native drag-and-drop/upload UI — found live: this page never
  // listened for DocumentList's addNew event, so the button did nothing.
  it('opens the Files app in a new tab when DocumentList emits addNew', async () => {
    vi.mocked(documentsService.fetchDocumentTypeSchema).mockResolvedValue(SCHEMA)
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(OVERVIEW)
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    const { wrapper } = await mountPage()

    await wrapper.findComponent(DocumentList).vm.$emit('addNew')

    expect(openSpy).toHaveBeenCalledWith('/index.php/apps/files', '_blank', 'noopener')
  })

  // M178.1 (backlog/v1.md Phase 178): with zero rows VirtualTable's `empty`
  // slot must render actual, readable content — before this milestone it was
  // a 371px void with no text at all. DocumentList is mounted for real here
  // (not the `stubs: { DocumentList: true }` used above) since the slot
  // content lives inside it.
  describe('empty state (M178.1)', () => {
    async function mountReal(query?: Record<string, string>): Promise<ReturnType<typeof mount>> {
      const router: Router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/type/:typeName', name: 'by-type-document-list', component: ByTypeDocumentListPage }],
      })
      router.push({ path: '/type/invoice', query })
      await router.isReady()
      const wrapper = mount(ByTypeDocumentListPage, { global: { plugins: [router] } })
      await flushPromises()
      return wrapper
    }

    it('names the type in the empty message when there are no documents of it', async () => {
      vi.mocked(documentsService.fetchDocumentTypeSchema).mockResolvedValue(SCHEMA)
      vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue({ types: [], total: 0, unreviewed: 0 })
      vi.mocked(documentsService.fetchSearchDocuments).mockResolvedValue({ items: [], limit: 50 })

      const wrapper = await mountReal()
      const empty = wrapper.find('.virtual-table__empty')

      expect(empty.exists()).toBe(true)
      expect(empty.text()).toContain('No Invoice documents yet')
    })

    it('shows a different message when a filter excludes every row', async () => {
      vi.mocked(documentsService.fetchDocumentTypeSchema).mockResolvedValue(SCHEMA)
      vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue(OVERVIEW)
      vi.mocked(documentsService.fetchSearchDocuments).mockResolvedValue({ items: [], limit: 50 })

      const wrapper = await mountReal({ f: 'q:search:nope' })
      const empty = wrapper.find('.virtual-table__empty')

      expect(empty.text()).toContain('No Invoice documents match your filters')
      expect(empty.text()).not.toContain('yet')
    })
  })
})
