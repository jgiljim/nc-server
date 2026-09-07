import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import DocumentsListPage from './DocumentsListPage.vue'
import * as documentsService from '../services/documents'
import type { ColumnDef, FilterableField } from '../types'

// frontend.md § Documents (M125.2) — the cross-type table behind the nav's
// "Documents" entry, and what replaced the per-type submenu: document type is a
// column here, sortable and filterable.
vi.mock('../services/documents')

const TYPES = [
  { type_name: 'purchase_order', display_name: 'Purchase Orders' },
  { type_name: 'commercial_invoice', display_name: 'Commercial Invoices' },
]

// DocumentList is stubbed: what is under test here is the column/filter/row
// contract this page hands it, not the list's own rendering (which has its own
// tests). Named so `findComponent({ name })` resolves it.
const DocumentListStub = {
  name: 'DocumentList',
  props: ['columns', 'fetchPage', 'filterableFields', 'defaultSort', 'persistKey'],
  template: '<div class="stub-list" />',
}

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', name: 'documents-list', component: DocumentsListPage }],
  })
  router.push('/')
  await router.isReady()
  const wrapper = mount(DocumentsListPage, {
    global: { plugins: [router], stubs: { DocumentList: DocumentListStub } },
  })
  await flushPromises()
  return wrapper
}

function listProps(wrapper: ReturnType<typeof mount>): Record<string, unknown> {
  return wrapper.findComponent({ name: 'DocumentList' }).props() as Record<string, unknown>
}

beforeEach(() => {
  vi.mocked(documentsService.fetchDocumentTypes).mockResolvedValue(TYPES)
  vi.mocked(documentsService.fetchSearchDocuments).mockResolvedValue({
    items: [],
    next_cursor: null,
  } as never)
})

describe('DocumentsListPage — columns', () => {
  it('shows document type as a column, sortable and cursor-paginated', async () => {
    const columns = listProps(await mountPage()).columns as ColumnDef[]
    const docType = columns.find((column) => column.key === 'doc_type')

    expect(docType?.label).toBe('Document type')
    expect(docType?.sortable).toBe(true)
    // `sort=doc_type:...` is a real indexed built-in column with keyset
    // pagination (api.md § Sort parameter, M33.3), so infinite scroll must NOT
    // be disabled under it — without this flag VirtualTable shows its
    // first-page-only notice and stops prefetching.
    expect(docType?.cursorPaginated).toBe(true)
    expect(docType?.defaultVisible).toBe(true)
  })

  it('keeps the other built-in columns sortable and paginated too', async () => {
    const columns = listProps(await mountPage()).columns as ColumnDef[]

    for (const key of ['created_at', 'updated_at', 'status', 'reviewed']) {
      const column = columns.find((candidate) => candidate.key === key)
      expect(column?.sortable, key).toBe(true)
      expect(column?.cursorPaginated, key).toBe(true)
    }
  })
})

describe('DocumentsListPage — the type filter', () => {
  it('offers type_name with the API\'s own operators', async () => {
    const fields = listProps(await mountPage()).filterableFields as FilterableField[]
    const typeField = fields.find((field) => field.field_name === 'type_name')

    // `type_name` is the API's built-in filter field for document type
    // (api.md § Filtering) — not `doc_type`, which is the column name.
    expect(typeField).toBeDefined()
    expect(typeField?.operators).toEqual(['eq', 'not_eq', 'is_null', 'is_not_null'])
  })

  it('offers a chosen-from list of the tenant\'s types, by display name', async () => {
    // A user cannot be expected to type `commercial_invoice`.
    const fields = listProps(await mountPage()).filterableFields as FilterableField[]
    const typeField = fields.find((field) => field.field_name === 'type_name')

    expect(typeField?.values).toEqual([
      { value: 'commercial_invoice', label: 'Commercial Invoices' },
      { value: 'purchase_order', label: 'Purchase Orders' },
    ])
  })

  it('asks for the usage-scoped type list, not the whole catalog', async () => {
    // Filtering by a type with zero documents can only return zero rows, so
    // offering it would be an invitation to a dead end (frontend.md § Documents).
    await mountPage()

    expect(documentsService.fetchDocumentTypes).toHaveBeenCalledWith()
  })

  it('drops a type with no type_name instead of offering a blank option', async () => {
    vi.mocked(documentsService.fetchDocumentTypes).mockResolvedValue([
      { type_name: 'invoice', display_name: 'Invoices' },
      { display_name: 'Broken' } as never,
    ])

    const fields = listProps(await mountPage()).filterableFields as FilterableField[]

    expect(fields[0].values).toEqual([{ value: 'invoice', label: 'Invoices' }])
  })
})

describe('DocumentsListPage — rows', () => {
  it('queries every type: no type_name scope on the request', async () => {
    const wrapper = await mountPage()
    const fetchPage = listProps(wrapper).fetchPage as (
      cursor: string | undefined,
      sort: unknown,
      filters: unknown[],
    ) => Promise<unknown>

    await fetchPage(undefined, { column: 'created_at', direction: 'desc' }, [])

    const call = vi.mocked(documentsService.fetchSearchDocuments).mock.calls[0][0]
    expect(call.typeName).toBeUndefined()
  })

  it('renders the type\'s display name in the cell, not the wire value', async () => {
    // The wire value is what sorts and filters; it is not what a user reads.
    vi.mocked(documentsService.fetchSearchDocuments).mockResolvedValue({
      items: [
        {
          public_id: 'doc-1',
          path: '/Momentum Demo/inv.pdf',
          doc_type: 'commercial_invoice',
          status: 'done',
          reviewed: false,
        },
      ],
      next_cursor: null,
    } as never)
    const wrapper = await mountPage()
    const fetchPage = listProps(wrapper).fetchPage as (
      cursor: string | undefined,
      sort: unknown,
      filters: unknown[],
    ) => Promise<{ items: Array<{ cells: Record<string, unknown> }> }>

    const page = await fetchPage(undefined, { column: 'created_at', direction: 'desc' }, [])

    expect(page.items[0].cells.doc_type).toBe('Commercial Invoices')
    expect(page.items[0].cells.filename).toBe('inv.pdf')
  })

  it('leaves the type cell empty for a document that has none yet', async () => {
    vi.mocked(documentsService.fetchSearchDocuments).mockResolvedValue({
      items: [{ public_id: 'doc-2', path: '/a.pdf', status: 'pending', reviewed: false }],
      next_cursor: null,
    } as never)
    const wrapper = await mountPage()
    const fetchPage = listProps(wrapper).fetchPage as (
      cursor: string | undefined,
      sort: unknown,
      filters: unknown[],
    ) => Promise<{ items: Array<{ cells: Record<string, unknown> }> }>

    const page = await fetchPage(undefined, { column: 'created_at', direction: 'desc' }, [])

    expect(page.items[0].cells.doc_type).toBe('')
  })

  it('renders "Undefined" for a classifier no-match (M179.3), not a blank cell', async () => {
    // A done document with doc_type_source === 'none' is the classifier's
    // legitimate "no registry type fits" outcome (backlog/v1.md Phase 179) —
    // it must read distinctly from "not classified yet", which stays blank.
    vi.mocked(documentsService.fetchSearchDocuments).mockResolvedValue({
      items: [
        {
          public_id: 'doc-4',
          path: '/a.pdf',
          doc_type_source: 'none',
          status: 'done',
          reviewed: false,
        },
      ],
      next_cursor: null,
    } as never)
    const wrapper = await mountPage()
    const fetchPage = listProps(wrapper).fetchPage as (
      cursor: string | undefined,
      sort: unknown,
      filters: unknown[],
    ) => Promise<{ items: Array<{ cells: Record<string, unknown> }> }>

    const page = await fetchPage(undefined, { column: 'created_at', direction: 'desc' }, [])

    expect(page.items[0].cells.doc_type).toBe('Undefined')
  })

  it('falls back to the raw type when the registry does not know it', async () => {
    // A document classified as a type the tenant's registry no longer returns
    // must still show something truthful rather than an empty cell.
    vi.mocked(documentsService.fetchDocumentTypes).mockResolvedValue([])
    vi.mocked(documentsService.fetchSearchDocuments).mockResolvedValue({
      items: [{ public_id: 'doc-3', path: '/a.pdf', doc_type: 'mystery_type' }],
      next_cursor: null,
    } as never)
    const wrapper = await mountPage()
    const fetchPage = listProps(wrapper).fetchPage as (
      cursor: string | undefined,
      sort: unknown,
      filters: unknown[],
    ) => Promise<{ items: Array<{ cells: Record<string, unknown> }> }>

    const page = await fetchPage(undefined, { column: 'created_at', direction: 'desc' }, [])

    expect(page.items[0].cells.doc_type).toBe('mystery_type')
  })

  it('normalizes the API\'s null next_cursor to absent', async () => {
    const wrapper = await mountPage()
    const fetchPage = listProps(wrapper).fetchPage as (
      cursor: string | undefined,
      sort: unknown,
      filters: unknown[],
    ) => Promise<{ next_cursor?: string }>

    const page = await fetchPage(undefined, { column: 'created_at', direction: 'desc' }, [])

    expect(page.next_cursor).toBeUndefined()
  })

  it('defaults to newest first and persists its own column choice', async () => {
    const props = listProps(await mountPage())

    expect(props.defaultSort).toEqual({ column: 'created_at', direction: 'desc' })
    // Its own key: the Documents and Recent tables have different column sets,
    // so sharing one persisted choice would leak between them.
    expect(props.persistKey).toBe('documents')
  })
})

// M178.1 (backlog/v1.md Phase 178): with zero rows VirtualTable's `empty`
// slot must render actual, readable content — before this milestone it was
// a 371px void with no text at all. DocumentList is mounted for real here
// (not the stub used above) since the slot content lives inside it.
describe('DocumentsListPage — empty state (M178.1)', () => {
  async function mountReal(query?: Record<string, string>) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', name: 'documents-list', component: DocumentsListPage }],
    })
    router.push({ path: '/', query })
    await router.isReady()
    const wrapper = mount(DocumentsListPage, { global: { plugins: [router] } })
    await flushPromises()
    return wrapper
  }

  it('renders a non-empty NcEmptyContent when there are no documents at all', async () => {
    vi.mocked(documentsService.fetchSearchDocuments).mockResolvedValue({ items: [], next_cursor: null } as never)

    const wrapper = await mountReal()
    const empty = wrapper.find('.virtual-table__empty')

    expect(empty.exists()).toBe(true)
    expect(empty.text()).toContain('No documents yet')
  })

  it('shows a different message when a filter excludes every row', async () => {
    vi.mocked(documentsService.fetchSearchDocuments).mockResolvedValue({ items: [], next_cursor: null } as never)

    const wrapper = await mountReal({ f: 'q:search:nope' })
    const empty = wrapper.find('.virtual-table__empty')

    expect(empty.text()).toContain('No documents match your filters')
    expect(empty.text()).not.toContain('No documents yet')
  })
})
