import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DocumentList from './DocumentList.vue'
import TypeaheadSearch from './TypeaheadSearch.vue'
import FilterPill from './FilterPill.vue'
import FilterPicker from './FilterPicker.vue'
import ColumnPicker from './ColumnPicker.vue'
import VirtualTable from './VirtualTable.vue'
import { MOMENTUM_CONFIG } from '../config'
import type { ColumnDef, FilterableField, Page } from '../types'

// Component tests for DocumentList (frontend.md § DocumentList, M4.4): the
// composite that bundles toolbar + filter/sort/column state + VirtualTable so
// neither the By-Type List (M4.7) nor Recent Documents (M4.8) page duplicates
// that behaviour. NcPopover is stubbed (as in FilterPicker/ColumnPicker's own
// tests) so their popover content renders synchronously without needing real
// click-to-open interaction.

const NcPopoverStub = {
  name: 'NcPopover',
  props: ['shown'],
  emits: ['update:shown'],
  template: '<div class="nc-popover-stub"><slot name="trigger" :attrs="{}" /><slot /></div>',
}

const COLUMNS: ColumnDef[] = [
  { key: 'doc_id', label: 'Doc ID', dataType: 'string', defaultVisible: true },
  {
    key: 'filename',
    label: 'Filename',
    dataType: 'string',
    defaultVisible: true,
    sortable: true,
    // Cursor-paginated in these fixtures (unlike an extracted-field sort,
    // M33.6) so the page-advancing/cursor-replace tests below can still
    // exercise a second scroll-driven fetch.
    cursorPaginated: true,
  },
  { key: 'total_amount', label: 'Total', dataType: 'double', sortable: true },
  { key: 'status', label: 'Status', dataType: 'string' },
]

const FILTERABLE_FIELDS: FilterableField[] = [
  { field_name: 'total_amount', display_name: 'Total', data_type: 'double', operators: ['eq', 'gt', 'lt'] },
]

function makePage(): Page {
  return {
    items: [{ id: 'doc-1', cells: { doc_id: 'doc-1', filename: 'invoice.pdf', total_amount: 42, status: 'done' } }],
  }
}

type FetchPage = (cursor: string | undefined, sort: unknown, filters: unknown) => Promise<Page>

async function mountList(
  opts: {
    fetchPage?: FetchPage
    persistKey?: string
    initialUrl?: string
    reserveNavToggleCorner?: boolean
  } = {},
) {
  const fetchPage = opts.fetchPage ?? vi.fn(() => Promise.resolve(makePage()))
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'recent-documents', component: { template: '<div/>' } },
      { path: '/document/:docId', name: 'document-viewer', component: { template: '<div/>' } },
    ],
  })
  await router.push(opts.initialUrl ?? '/')
  await router.isReady()

  const w = mount(DocumentList, {
    props: {
      columns: COLUMNS,
      fetchPage,
      filterableFields: FILTERABLE_FIELDS,
      defaultSort: { column: 'created_at', direction: 'desc' },
      persistKey: opts.persistKey,
      reserveNavToggleCorner: opts.reserveNavToggleCorner,
    },
    global: { plugins: [router], stubs: { NcPopover: NcPopoverStub } },
  })
  // Give the scroll-body geometry stub VirtualTable needs to not immediately
  // treat itself as "near bottom" (mirrors VirtualTable.unit.test.ts).
  const body = w.find('[data-testid="virtual-table-body"]')
  if (body.exists()) {
    Object.defineProperty(body.element, 'clientHeight', { value: 300, configurable: true })
  }
  await flushPromises()
  return { w, fetchPage, router }
}

describe('DocumentList', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('renders the toolbar left-to-right: search, filter picker, column picker, add new', () => {
    return mountList().then(({ w }) => {
      const toolbar = w.find('.momentum-document-list__toolbar')
      const searchIdx = toolbar.findComponent(TypeaheadSearch).element
      const filterPickerIdx = toolbar.findComponent(FilterPicker).element
      const columnPickerIdx = toolbar.findComponent(ColumnPicker).element
      const addNewIdx = toolbar.find('.momentum-document-list__add-new').element
      const all = Array.from(toolbar.element.querySelectorAll('*'))
      expect(all.indexOf(searchIdx)).toBeLessThan(all.indexOf(filterPickerIdx))
      expect(all.indexOf(filterPickerIdx)).toBeLessThan(all.indexOf(columnPickerIdx))
      expect(all.indexOf(columnPickerIdx)).toBeLessThan(all.indexOf(addNewIdx))
    })
  })

  // backlog Phase 90 / M90.1: RecentDocumentsPage has no heading row above
  // DocumentList, so it opts into reserving NcAppContent's nav-toggle
  // footprint directly on the toolbar (ByTypeDocumentListPage reserves it
  // on its own heading instead and never sets this prop).
  it('does not reserve the nav-toggle corner on the toolbar by default', async () => {
    const { w } = await mountList()
    expect(w.find('.momentum-document-list__toolbar').classes()).not.toContain(
      'momentum-document-list__toolbar--reserve-nav-toggle',
    )
  })

  it('reserves the nav-toggle corner on the toolbar when reserveNavToggleCorner is set', async () => {
    const { w } = await mountList({ reserveNavToggleCorner: true })
    expect(w.find('.momentum-document-list__toolbar').classes()).toContain(
      'momentum-document-list__toolbar--reserve-nav-toggle',
    )
  })

  it('prepends the three built-in filterable fields (status, reviewed, direction) ahead of caller-supplied ones', async () => {
    const { w } = await mountList()
    const picker = w.findComponent(FilterPicker)
    const fields = picker.props('fields') as FilterableField[]
    expect(fields.map((f) => f.field_name)).toEqual(['status', 'reviewed', 'direction', 'total_amount'])
  })

  it('gives the built-in fields the full eq/not_eq/in/not_in operator set (M23.7)', async () => {
    const { w } = await mountList()
    const picker = w.findComponent(FilterPicker)
    const fields = picker.props('fields') as FilterableField[]
    const builtIns = fields.filter((f) => ['status', 'reviewed', 'direction'].includes(f.field_name))
    for (const field of builtIns) {
      expect(field.operators).toEqual(['eq', 'not_eq', 'in', 'not_in'])
    }
  })

  it('passes only the defaultVisible columns to VirtualTable initially', async () => {
    const { w } = await mountList()
    const table = w.findComponent(VirtualTable)
    const cols = table.props('columns') as ColumnDef[]
    expect(cols.map((c) => c.key)).toEqual(['doc_id', 'filename'])
  })

  // M94.2: VirtualTable resolves the active sort's `cursorPaginated` flag
  // against the FULL column set, not the visible subset — DocumentList must
  // hand it the full set via `allColumns` regardless of what's visible.
  it('passes the full column set to VirtualTable as allColumns, not just the visible subset', async () => {
    const { w } = await mountList()
    const table = w.findComponent(VirtualTable)
    expect((table.props('allColumns') as ColumnDef[]).map((c) => c.key)).toEqual(
      COLUMNS.map((c) => c.key),
    )
  })

  it('falls back to showing all columns when none are marked defaultVisible', async () => {
    const columns: ColumnDef[] = [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
    ]
    const fetchPage = vi.fn(() => Promise.resolve(makePage()))
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', name: 'document-viewer', component: { template: '<div/>' } }],
    })
    await router.push('/')
    await router.isReady()
    const w = mount(DocumentList, {
      props: {
        columns,
        fetchPage,
        filterableFields: [],
        defaultSort: { column: 'created_at', direction: 'desc' },
      },
      global: { plugins: [router], stubs: { NcPopover: NcPopoverStub } },
    })
    await flushPromises()
    const table = w.findComponent(VirtualTable)
    expect((table.props('columns') as ColumnDef[]).map((c) => c.key)).toEqual(['a', 'b'])
  })

  it('emits a search commit as a FilterPill and includes it in the next fetchPage call', async () => {
    const { w, fetchPage } = await mountList()
    await w.findComponent(TypeaheadSearch).vm.$emit('searchCommit', 'acme')
    await flushPromises()
    expect(w.findComponent(FilterPill).props('label')).toBe('search: acme')
    expect(fetchPage).toHaveBeenLastCalledWith(
      undefined,
      { column: 'created_at', direction: 'desc' },
      [{ kind: 'search', term: 'acme' }],
    )
  })

  it('adds a FilterPicker filter as a pill, labeled "{display_name} {operator} {value}"', async () => {
    const { w, fetchPage } = await mountList()
    await w.findComponent(FilterPicker).vm.$emit('filterAdd', {
      field_name: 'total_amount',
      operator: 'gt',
      value: '100',
    })
    await flushPromises()
    expect(w.findComponent(FilterPill).props('label')).toBe('Total gt 100')
    expect(fetchPage).toHaveBeenLastCalledWith(
      undefined,
      { column: 'created_at', direction: 'desc' },
      [{ kind: 'field', field_name: 'total_amount', operator: 'gt', value: '100' }],
    )
  })

  it('removes a pill and its filter when the pill is dismissed', async () => {
    const { w, fetchPage } = await mountList()
    await w.findComponent(TypeaheadSearch).vm.$emit('searchCommit', 'acme')
    await flushPromises()
    await w.findComponent(FilterPill).vm.$emit('remove')
    await flushPromises()
    expect(w.findComponent(FilterPill).exists()).toBe(false)
    expect(fetchPage).toHaveBeenLastCalledWith(undefined, { column: 'created_at', direction: 'desc' }, [])
  })

  it('updates visible columns and persists them when persistKey is set', async () => {
    const { w } = await mountList({ persistKey: 'recent' })
    await w.findComponent(ColumnPicker).vm.$emit('change', ['doc_id', 'status'])
    await flushPromises()
    const table = w.findComponent(VirtualTable)
    expect((table.props('columns') as ColumnDef[]).map((c) => c.key)).toEqual(['doc_id', 'status'])
    expect(window.localStorage.getItem(MOMENTUM_CONFIG.COLUMN_PICKER_STORAGE_PREFIX + 'recent')).toBe(
      JSON.stringify(['doc_id', 'status']),
    )
  })

  it('sets the active sort ascending on first click of a sortable header, then toggles on second click', async () => {
    const { w, fetchPage } = await mountList()
    const table = w.findComponent(VirtualTable)
    await table.vm.$emit('sortChange', 'filename')
    await flushPromises()
    expect(fetchPage).toHaveBeenLastCalledWith(undefined, { column: 'filename', direction: 'asc' }, [])

    await w.findComponent(VirtualTable).vm.$emit('sortChange', 'filename')
    await flushPromises()
    expect(fetchPage).toHaveBeenLastCalledWith(undefined, { column: 'filename', direction: 'desc' }, [])
  })

  it('ignores a sort header click while a search term is active (M34.8: q= rejects an explicit sort)', async () => {
    const { w, fetchPage } = await mountList()
    await w.findComponent(TypeaheadSearch).vm.$emit('searchCommit', 'acme')
    await flushPromises()
    const callsBeforeSortClick = (fetchPage as ReturnType<typeof vi.fn>).mock.calls.length

    await w.findComponent(VirtualTable).vm.$emit('sortChange', 'filename')
    await flushPromises()

    expect((fetchPage as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBeforeSortClick)
    expect(w.findComponent(VirtualTable).props('activeSort')).toEqual({
      column: 'created_at',
      direction: 'desc',
    })
  })

  it('shows VirtualTable\'s first-page-only notice when sorting by a column without cursorPaginated (M33.6)', async () => {
    // total_amount is sortable but, unlike filename in these fixtures, has no
    // cursorPaginated flag — the extracted-field-sort shape M32.1 ships,
    // where next_cursor is always null past page 1.
    const { w } = await mountList()
    await w.findComponent(VirtualTable).vm.$emit('sortChange', 'total_amount')
    await flushPromises()
    expect(w.find('[data-testid="virtual-table-first-page-only-notice"]').exists()).toBe(true)
  })

  it('navigates to the document viewer route when VirtualTable emits a row click', async () => {
    const { w, router } = await mountList()
    const pushSpy = vi.spyOn(router, 'push')
    await w.findComponent(VirtualTable).vm.$emit('rowClick', 'doc-42')
    expect(pushSpy).toHaveBeenCalledWith({ name: 'document-viewer', params: { docId: 'doc-42' } })
  })

  it('emits addNew when the Add new button is clicked', async () => {
    const { w } = await mountList()
    await w.find('.momentum-document-list__add-new').trigger('click')
    expect(w.emitted('addNew')).toHaveLength(1)
  })
})

describe('DocumentList — URL state (frontend.md § URL State Management, M4.5)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('restores sort, filters, and columns from the URL on mount, ahead of localStorage/defaults', async () => {
    const { w, fetchPage } = await mountList({
      persistKey: 'recent',
      initialUrl: '/?sort=filename:asc&cols=doc_id,status&f=status:eq:done&f=q:search:acme',
    })
    const table = w.findComponent(VirtualTable)
    expect((table.props('columns') as ColumnDef[]).map((c) => c.key)).toEqual(['doc_id', 'status'])
    expect(table.props('activeSort')).toEqual({ column: 'filename', direction: 'asc' })
    expect(fetchPage).toHaveBeenCalledWith(
      undefined,
      { column: 'filename', direction: 'asc' },
      [
        { kind: 'field', field_name: 'status', operator: 'eq', value: 'done' },
        { kind: 'search', term: 'acme' },
      ],
    )
    expect(
      w.findAllComponents(FilterPill).map((pill) => pill.props('label')),
    ).toEqual(['Status eq done', 'search: acme'])
  })

  it('restores the cursor from the URL as the initial VirtualTable page', async () => {
    const { w } = await mountList({ initialUrl: '/?cursor=abc123' })
    const table = w.findComponent(VirtualTable)
    expect(table.props('initialCursor')).toBe('abc123')
  })

  it('pushes sort into the URL query and clears any cursor when sort changes', async () => {
    const { w, router } = await mountList({ initialUrl: '/?cursor=abc123' })
    const pushSpy = vi.spyOn(router, 'push')
    await w.findComponent(VirtualTable).vm.$emit('sortChange', 'filename')
    await flushPromises()
    expect(pushSpy).toHaveBeenCalledWith({ query: expect.objectContaining({ sort: 'filename:asc' }) })
    expect(router.currentRoute.value.query.sort).toBe('filename:asc')
    expect(router.currentRoute.value.query.cursor).toBeUndefined()
  })

  it('pushes filters into the URL query and clears any cursor when a filter is added', async () => {
    const { w, router } = await mountList({ initialUrl: '/?cursor=abc123' })
    await w.findComponent(FilterPicker).vm.$emit('filterAdd', {
      field_name: 'total_amount',
      operator: 'gt',
      value: '100',
    })
    await flushPromises()
    expect(router.currentRoute.value.query.f).toEqual(['total_amount:gt:100'])
    expect(router.currentRoute.value.query.cursor).toBeUndefined()
  })

  it('removes the f query param entirely once the last filter pill is dismissed', async () => {
    const { w, router } = await mountList()
    await w.findComponent(TypeaheadSearch).vm.$emit('searchCommit', 'acme')
    await flushPromises()
    expect(router.currentRoute.value.query.f).toEqual(['q:search:acme'])
    await w.findComponent(FilterPill).vm.$emit('remove')
    await flushPromises()
    expect(router.currentRoute.value.query.f).toBeUndefined()
  })

  it('pushes cols into the URL query when column visibility changes', async () => {
    const { w, router } = await mountList({ persistKey: 'recent' })
    await w.findComponent(ColumnPicker).vm.$emit('change', ['doc_id', 'status'])
    await flushPromises()
    expect(router.currentRoute.value.query.cols).toBe('doc_id,status')
  })

  it('replaces (not pushes) the cursor query param on page-advancing fetches', async () => {
    const page1Cursor = 'cursor-page-2'
    // Every first-page fetch (initial mount, and the remount triggered by
    // sortChange below) reports a next_cursor so the scroll-driven fetch has
    // something to advance to; only that final scroll-triggered call (cursor
    // === page1Cursor) resolves with an exhausted page.
    const fetchPage = vi.fn((cursor?: string) =>
      Promise.resolve(
        cursor === page1Cursor
          ? { items: [] }
          : { items: makePage().items, next_cursor: page1Cursor },
      ),
    )
    const { w, router } = await mountList({ fetchPage })
    const pushSpy = vi.spyOn(router, 'push')
    const replaceSpy = vi.spyOn(router, 'replace')

    await w.findComponent(VirtualTable).vm.$emit('sortChange', 'filename')
    await flushPromises()
    // Reset spies after the sort-triggered push so only the scroll-driven
    // pagination fetch below is asserted against replace/push below.
    pushSpy.mockClear()
    replaceSpy.mockClear()

    // Re-query the scroll body: it's a fresh element after VirtualTable
    // remounted on the sort change above (`:key="tableKey"`).
    const body = w.find('[data-testid="virtual-table-body"]').element as HTMLElement
    Object.defineProperty(body, 'clientHeight', { value: 300, configurable: true })
    body.dispatchEvent(new Event('scroll'))
    await flushPromises()

    expect(replaceSpy).toHaveBeenCalledWith({ query: expect.objectContaining({ cursor: page1Cursor }) })
    expect(router.currentRoute.value.query.cursor).toBe(page1Cursor)
    expect(pushSpy).not.toHaveBeenCalled()
  })
})
