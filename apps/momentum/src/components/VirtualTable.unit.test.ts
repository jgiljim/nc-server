import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import CheckIcon from 'vue-material-design-icons/Check.vue'
import CloseIcon from 'vue-material-design-icons/Close.vue'
import FilePdfBoxIcon from 'vue-material-design-icons/FilePdfBox.vue'
import FileOutlineIcon from 'vue-material-design-icons/FileOutline.vue'
import VirtualTable from './VirtualTable.vue'
import type { ColumnDef, Page, SortState, TableRow } from '../types'

// Component tests for VirtualTable (frontend.md § VirtualTable): the low-level
// windowed table primitive that DocumentList (M4.4) composes. It knows nothing
// about toolbars, filters, or sort state — its whole contract is `columns` and
// a `fetchPage(cursor?)` callback: fetch the first page on mount, render typed
// cells, show skeleton rows while a fetch is in flight, an `empty` slot once
// loaded with zero rows, and prefetch the next page on scroll-near-bottom.

const COLUMNS: ColumnDef[] = [
  { key: 'title', label: 'Title', dataType: 'string' },
  { key: 'amount', label: 'Amount', dataType: 'int64' },
  { key: 'reviewed', label: 'Reviewed', dataType: 'boolean' },
]

// A geometry the windowing math can page over: rows are ROW_HEIGHT(44)px tall,
// the viewport is 300px, so ~7 rows are visible at the top of a 30-row set.
const VIEWPORT_HEIGHT = 300

function makeRows(n: number, offset = 0): TableRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `row-${offset + i}`,
    cells: { title: `Doc ${offset + i}`, amount: 1000 + offset + i, reviewed: i % 2 === 0 },
  }))
}

// Mount with the scroll body's clientHeight defined up front — jsdom reports 0
// for layout geometry otherwise, which would starve the windowing math.
function mountTable(
  fetchPage: (cursor?: string) => Promise<Page>,
  opts: {
    columns?: ColumnDef[]
    allColumns?: ColumnDef[]
    emptySlot?: string
    activeSort?: SortState
    selectable?: boolean
    selectedIds?: string[]
    hideBody?: boolean
  } = {},
) {
  const w = mount(VirtualTable, {
    props: {
      columns: opts.columns ?? COLUMNS,
      allColumns: opts.allColumns,
      fetchPage,
      activeSort: opts.activeSort,
      selectable: opts.selectable,
      selectedIds: opts.selectedIds,
      hideBody: opts.hideBody,
    },
    slots: opts.emptySlot ? { empty: opts.emptySlot } : undefined,
  })
  const body = w.find('[data-testid="virtual-table-body"]').element
  Object.defineProperty(body, 'clientHeight', { value: VIEWPORT_HEIGHT, configurable: true })
  Object.defineProperty(body, 'scrollTop', { value: 0, writable: true, configurable: true })
  Object.defineProperty(body, 'scrollHeight', { value: 44 * 30, configurable: true })
  return w
}

// A promise we resolve by hand, to observe the in-flight (loading) state.
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('VirtualTable', () => {
  it('renders one header cell per column', async () => {
    const w = mountTable(() => Promise.resolve({ items: makeRows(3) }))
    await flushPromises()
    const headers = w.findAll('[role="columnheader"]')
    expect(headers).toHaveLength(COLUMNS.length)
    expect(headers.map((h) => h.text())).toEqual(['Title', 'Amount', 'Reviewed'])
  })

  it('fetches the first page on mount with no cursor and renders its rows', async () => {
    const fetchPage = vi.fn(() => Promise.resolve({ items: makeRows(3) }))
    const w = mountTable(fetchPage)
    await flushPromises()
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(fetchPage).toHaveBeenCalledWith(undefined)
    expect(w.findAll('[role="row"]:not([data-testid="virtual-table-skeleton"]) [role="cell"]').length)
      .toBeGreaterThan(0)
    expect(w.text()).toContain('Doc 0')
  })

  it('fetches the first page with initialCursor when provided (M4.5 URL state restore)', async () => {
    const fetchPage = vi.fn(() => Promise.resolve({ items: makeRows(3) }))
    const w = mount(VirtualTable, { props: { columns: COLUMNS, fetchPage, initialCursor: 'restored-cursor' } })
    const body = w.find('[data-testid="virtual-table-body"]').element
    Object.defineProperty(body, 'clientHeight', { value: VIEWPORT_HEIGHT, configurable: true })
    await flushPromises()
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(fetchPage).toHaveBeenCalledWith('restored-cursor')
  })

  it('shows skeleton rows while a fetch is in flight and hides them once loaded', async () => {
    const d = deferred<Page>()
    const w = mountTable(() => d.promise)
    await w.vm.$nextTick()
    // Fetch is pending: skeleton visible, empty slot not shown.
    expect(w.find('[data-testid="virtual-table-skeleton"]').exists()).toBe(true)
    d.resolve({ items: makeRows(2) })
    await flushPromises()
    expect(w.find('[data-testid="virtual-table-skeleton"]').exists()).toBe(false)
  })

  it('renders the empty slot once loaded with zero rows', async () => {
    const w = mountTable(() => Promise.resolve({ items: [] }), {
      emptySlot: '<div class="my-empty">Nothing here</div>',
    })
    await flushPromises()
    expect(w.find('.my-empty').exists()).toBe(true)
    expect(w.text()).toContain('Nothing here')
  })

  // M171.4 (backlog/v1.md Phase 171): --select, --actions and --view-toggle
  // are single-class selectors tying specificity (0,1,0) with the base
  // `.virtual-table__th, .virtual-table__td { flex: 1 1 0 }` rule, so which
  // one wins is decided by declaration order alone. Assert an ABSOLUTE
  // width here, not a header-vs-body comparison — today's equal-sixths
  // layout is internally consistent and would pass a relative check even
  // while every fixed-width rule is dead.
  it('computes a fixed clickable-area width for the select/actions/view-toggle columns, not a flex share of the row', async () => {
    const w = mount(VirtualTable, {
      props: {
        columns: COLUMNS,
        fetchPage: () => Promise.resolve({ items: makeRows(1) }),
        selectable: true,
      },
      slots: {
        'row-actions': '<button>actions</button>',
        'header-extra': '<button data-testid="fake-toggle">toggle</button>',
      },
    })
    const body = w.find('[data-testid="virtual-table-body"]').element
    Object.defineProperty(body, 'clientHeight', { value: VIEWPORT_HEIGHT, configurable: true })
    await flushPromises()

    const selectHeader = w.find('.virtual-table__th--select').element as HTMLElement
    expect(getComputedStyle(selectHeader).flex).toBe('0 0 var(--default-clickable-area)')

    // M181.3 (backlog/v1.md Phase 181): --default-clickable-area (34px) alone
    // clips the button by its own padding-inline (12px) under
    // `justify-content: flex-end` — 51px is M171.6's own declared width for
    // this column and is the value measured live to fully contain it.
    const viewToggleHeader = w.find('.virtual-table__th--view-toggle').element as HTMLElement
    expect(getComputedStyle(viewToggleHeader).flex).toBe('0 0 51px')

    // M181.1 (backlog/v1.md Phase 181): unlike --select/--view-toggle (a
    // single control each), the actions cell holds two 34x34 controls side
    // by side (M174.5 added the second one) with a `gap` between them
    // (`.momentum-row-actions`, FileBrowserPage.vue), so its basis must be two
    // clickable areas PLUS that gap, not just the two controls — M178.6's
    // calc-times-2 form undercounted the gap and clipped by exactly 4px. This
    // is a supplementary guard, not the sole one: jsdom computes no real flex
    // layout (no non-zero getBoundingClientRect), so it cannot assert the
    // actual containment M181.1 requires — that lives in
    // scripts/lib/nc-theme-overflow-check.mjs's --check=actions-column-fit,
    // wired into scripts/k8s-nc-smoke-test.sh, which measures a hovered row
    // in a real browser.
    const actionsHeader = w.find('.virtual-table__th--actions').element as HTMLElement
    expect(getComputedStyle(actionsHeader).flex).toBe(
      '0 0 calc(var(--default-clickable-area) * 2 + var(--default-grid-baseline))',
    )
  })

  // M171.5 (backlog/v1.md Phase 171): the header carries a trailing
  // `header-extra`/view-toggle cell (M161.2) with no body counterpart, so the
  // header ends up with one more cell than a row — every flexible column
  // downstream of that extra cell drifts out from under its header (measured
  // live: up to 104px, 53/110 sampled x-positions landing under the wrong
  // header). jsdom does not compute real flex layout, so this compares cell
  // *counts* per row category (the mechanism the pixel drift depends on)
  // rather than literal x coordinates: header, a rendered body row and the
  // loading skeleton must all carry the same number of cells, both with no
  // sort active and again after one, so column widths stay locked when
  // content — and therefore the active-sort indicator — changes.
  it('gives body rows and the skeleton the same cell count as the header, including a view-toggle filler, before and after a sort', async () => {
    const columns: ColumnDef[] = [
      { key: 'title', label: 'Title', dataType: 'string', sortable: true },
      { key: 'amount', label: 'Amount', dataType: 'int64', sortable: true },
    ]
    const d = deferred<Page>()
    const w = mount(VirtualTable, {
      props: { columns, fetchPage: () => d.promise, selectable: true },
      slots: {
        'row-actions': '<button>actions</button>',
        'header-extra': '<button data-testid="fake-toggle">toggle</button>',
      },
    })
    const body = w.find('[data-testid="virtual-table-body"]').element
    Object.defineProperty(body, 'clientHeight', { value: VIEWPORT_HEIGHT, configurable: true })

    // Still loading: the skeleton row must match the header cell-for-cell too
    // (it renders before any data arrives, where a first impression forms).
    await w.vm.$nextTick()
    const headerCellCount = w.find('.virtual-table__header').element.children.length
    const skeletonCellCount = w.find('.virtual-table__row--skeleton').element.children.length
    expect(skeletonCellCount).toBe(headerCellCount)

    d.resolve({ items: makeRows(1) })
    await flushPromises()

    const rowCellCount = w.find('.virtual-table__row--clickable').element.children.length
    expect(rowCellCount).toBe(headerCellCount)

    // Trigger a sort and re-assert: the cell counts must stay locked when the
    // active-sort column/indicator changes, not just on first render.
    await w.find('.virtual-table__th--sortable').trigger('click')
    expect(w.emitted('sortChange')?.[0]).toEqual(['title'])
    await w.setProps({ activeSort: { column: 'title', direction: 'asc' } })
    await flushPromises()

    expect(w.find('.virtual-table__header').element.children.length).toBe(headerCellCount)
    expect(w.find('.virtual-table__row--clickable').element.children.length).toBe(rowCellCount)
  })

  // M171.6 (backlog/v1.md Phase 171): the mockup gives Size/Modified a narrow,
  // roughly-fixed width and lets Name absorb the rest — not an equal flex
  // share (the "equal sixths" the milestone explicitly says must not pass).
  // Assert the proportion, not just that a width is declared: Size/Modified's
  // flex-basis must be smaller than Name's computed width share, i.e. Name
  // keeps `flex: 1 1 0` (grows) while Size/Modified get a bounded basis.
  it("narrows Size/Modified below Name's share instead of splitting the row into equal columns", async () => {
    const columns: ColumnDef[] = [
      { key: 'filename', label: 'Name', dataType: 'string' },
      { key: 'size', label: 'Size', dataType: 'int64', byteSize: true },
      { key: 'mtime', label: 'Modified', dataType: 'date', relativeDate: true },
    ]
    const w = mount(VirtualTable, {
      props: { columns, fetchPage: () => Promise.resolve({ items: makeRows(1) }) },
    })
    const body = w.find('[data-testid="virtual-table-body"]').element
    Object.defineProperty(body, 'clientHeight', { value: VIEWPORT_HEIGHT, configurable: true })
    await flushPromises()

    const headers = w.findAll('[role="columnheader"]')
    const nameHeader = headers[0].element as HTMLElement
    const sizeHeader = headers[1].element as HTMLElement
    const mtimeHeader = headers[2].element as HTMLElement

    // Name keeps the base rule's `flex: 1 1 0` — it grows to absorb whatever
    // width Size/Modified give up.
    expect(getComputedStyle(nameHeader).flex).toBe('1 1 0px')
    // Size/Modified must not share that same growable rule — each gets a
    // bounded, non-growing flex-basis instead.
    for (const el of [sizeHeader, mtimeHeader]) {
      const flex = getComputedStyle(el).flex
      expect(flex).not.toBe('1 1 0px')
      expect(flex).toMatch(/^0 /)
    }

    // Re-assert M171.5's alignment invariant: narrowing two columns must not
    // reintroduce a header/body cell-count divergence.
    const rowCellCount = w.find('.virtual-table__row--clickable').element.children.length
    expect(w.find('.virtual-table__header').element.children.length).toBe(rowCellCount)
  })

  it('does not render the empty slot while the first fetch is still in flight', async () => {
    const d = deferred<Page>()
    const w = mountTable(() => d.promise, { emptySlot: '<div class="my-empty">Nothing here</div>' })
    await w.vm.$nextTick()
    expect(w.find('.my-empty').exists()).toBe(false)
    d.resolve({ items: makeRows(1) })
    await flushPromises()
    expect(w.find('.my-empty').exists()).toBe(false)
  })

  it('renders boolean cells as Check/Close icon components, not text', async () => {
    // reviewed alternates true (row 0) / false (row 1); assert the icon
    // components render and the literal words "true"/"false" never do.
    const w = mountTable(() => Promise.resolve({ items: makeRows(2) }))
    await flushPromises()
    expect(w.findComponent(CheckIcon).exists()).toBe(true)
    expect(w.findComponent(CloseIcon).exists()).toBe(true)
    expect(w.text()).not.toContain('true')
    expect(w.text()).not.toContain('false')
  })

  it('renders a pill-marked column value inside a pill badge', async () => {
    // frontend.md § Recent Documents / § By-Type Document List: "doc id
    // (pill; click → Document Viewer)".
    const columns: ColumnDef[] = [{ key: 'title', label: 'Title', dataType: 'string', pill: true }]
    const w = mountTable(() => Promise.resolve({ items: makeRows(1) }), { columns })
    await flushPromises()
    const pill = w.find('.virtual-table__pill')
    expect(pill.exists()).toBe(true)
    expect(pill.text()).toBe('Doc 0')
  })

  it('right-aligns numeric (int64/double) cells', async () => {
    const w = mountTable(() => Promise.resolve({ items: makeRows(1) }))
    await flushPromises()
    // The Amount column is int64 → its header and cells carry the numeric modifier.
    const amountHeader = w.findAll('[role="columnheader"]')[1]
    expect(amountHeader.classes()).toContain('virtual-table__th--numeric')
    const cells = w.findAll('[role="cell"]')
    // First row: [title, amount, reviewed] → the amount cell is index 1.
    expect(cells[1].classes()).toContain('virtual-table__td--numeric')
    // String column is not right-aligned.
    expect(cells[0].classes()).not.toContain('virtual-table__td--numeric')
  })

  it('fetches the next page (passing the previous next_cursor) when scrolled near the bottom', async () => {
    const fetchPage = vi
      .fn<(cursor?: string) => Promise<Page>>()
      .mockResolvedValueOnce({ items: makeRows(30), next_cursor: 'cursor-2' })
      .mockResolvedValueOnce({ items: makeRows(30, 30) })
    const w = mountTable(fetchPage)
    await flushPromises()
    expect(fetchPage).toHaveBeenCalledTimes(1)

    // Scroll to the bottom of the 30-row set (30*44 - 300 = 1020).
    const body = w.find('[data-testid="virtual-table-body"]').element
    Object.defineProperty(body, 'scrollTop', { value: 44 * 30 - VIEWPORT_HEIGHT, configurable: true })
    await w.find('[data-testid="virtual-table-body"]').trigger('scroll')
    await flushPromises()

    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(fetchPage).toHaveBeenLastCalledWith('cursor-2')
  })

  it('does not prefetch past the last page (no next_cursor)', async () => {
    const fetchPage = vi.fn(() => Promise.resolve({ items: makeRows(30) }))
    const w = mountTable(fetchPage)
    await flushPromises()

    const body = w.find('[data-testid="virtual-table-body"]').element
    Object.defineProperty(body, 'scrollTop', { value: 44 * 30 - VIEWPORT_HEIGHT, configurable: true })
    await w.find('[data-testid="virtual-table-body"]').trigger('scroll')
    await flushPromises()

    // First page had no next_cursor → nothing more to fetch.
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  // M94.1: the API signals cursor exhaustion with `next_cursor: null` on the
  // wire, not by omitting the field — `null !== undefined`, so a naive
  // `hasMore` check that only excludes `undefined` keeps prefetching forever,
  // re-requesting page 1 with a nullish cursor and concatenating the corpus
  // to itself. `fetchPage` here bypasses the adapter-level normalization
  // (Page's stated `next_cursor?: string` contract) to prove VirtualTable
  // itself treats a raw `null` the same as an absent cursor.
  it('stops prefetching once a page reports cursor exhaustion via next_cursor: null', async () => {
    const fetchPage = vi
      .fn<(cursor?: string) => Promise<Page>>()
      .mockResolvedValueOnce({ items: makeRows(30), next_cursor: null } as unknown as Page)
    const w = mountTable(fetchPage)
    await flushPromises()
    expect(fetchPage).toHaveBeenCalledTimes(1)

    const body = w.find('[data-testid="virtual-table-body"]').element
    Object.defineProperty(body, 'scrollTop', { value: 44 * 30 - VIEWPORT_HEIGHT, configurable: true })
    await w.find('[data-testid="virtual-table-body"]').trigger('scroll')
    await flushPromises()

    // A nullish (not just absent) next_cursor must never reach loadPage —
    // that call is exactly what re-requests page 1 and duplicates rows.
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('still prefetches the next page when a page carries a real next_cursor (M94.1 no-regression check)', async () => {
    const fetchPage = vi
      .fn<(cursor?: string) => Promise<Page>>()
      .mockResolvedValueOnce({ items: makeRows(30), next_cursor: 'cursor-2' })
      .mockResolvedValueOnce({ items: makeRows(30, 30), next_cursor: null } as unknown as Page)
    const w = mountTable(fetchPage)
    await flushPromises()
    expect(fetchPage).toHaveBeenCalledTimes(1)

    const body = w.find('[data-testid="virtual-table-body"]').element
    Object.defineProperty(body, 'scrollTop', { value: 44 * 30 - VIEWPORT_HEIGHT, configurable: true })
    await w.find('[data-testid="virtual-table-body"]').trigger('scroll')
    await flushPromises()

    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(fetchPage).toHaveBeenLastCalledWith('cursor-2')
  })

  // M33.6: an extracted-field sort (api.md § Sort parameter, M32.1) always
  // returns next_cursor: null — a working column's ColumnDef has no
  // `cursorPaginated: true`. Rather than silently capping at one page (this
  // project's "no silent caps" convention), VirtualTable must show a visible
  // notice and refuse to scroll-prefetch even if a future response somehow
  // carried a next_cursor.
  it('shows a first-page-only notice when sorted by a column without cursorPaginated', async () => {
    const w = mountTable(() => Promise.resolve({ items: makeRows(3) }), {
      activeSort: { column: 'amount', direction: 'desc' },
    })
    await flushPromises()
    const notice = w.find('[data-testid="virtual-table-first-page-only-notice"]')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain('Amount')
    expect(notice.text()).toContain('3')
  })

  it('does not show the first-page-only notice when sorted by a cursorPaginated column', async () => {
    const columns: ColumnDef[] = [
      { key: 'title', label: 'Title', dataType: 'string', sortable: true, cursorPaginated: true },
      { key: 'amount', label: 'Amount', dataType: 'int64' },
    ]
    const w = mountTable(() => Promise.resolve({ items: makeRows(3), next_cursor: 'cursor-2' }), {
      columns,
      activeSort: { column: 'title', direction: 'asc' },
    })
    await flushPromises()
    expect(w.find('[data-testid="virtual-table-first-page-only-notice"]').exists()).toBe(false)
  })

  it('does not show the first-page-only notice when no sort is active', async () => {
    const w = mountTable(() => Promise.resolve({ items: makeRows(3) }))
    await flushPromises()
    expect(w.find('[data-testid="virtual-table-first-page-only-notice"]').exists()).toBe(false)
  })

  // M33.10: the `filename` column renders a file-type icon (M33.9's
  // mimeTypeToIcon map) keyed on the row's `mime_type` cell (M33.8).
  it('renders the mime-type-mapped file icon in the filename column', async () => {
    const columns: ColumnDef[] = [{ key: 'filename', label: 'Filename', dataType: 'string' }]
    const rows: TableRow[] = [
      { id: 'row-0', cells: { filename: 'invoice.pdf', mime_type: 'application/pdf' } },
    ]
    const w = mountTable(() => Promise.resolve({ items: rows }), { columns })
    await flushPromises()
    expect(w.findComponent(FilePdfBoxIcon).exists()).toBe(true)
    expect(w.text()).toContain('invoice.pdf')
  })

  it('falls back to the generic file icon in the filename column when mime_type is missing', async () => {
    const columns: ColumnDef[] = [{ key: 'filename', label: 'Filename', dataType: 'string' }]
    const rows: TableRow[] = [{ id: 'row-0', cells: { filename: 'mystery-file' } }]
    const w = mountTable(() => Promise.resolve({ items: rows }), { columns })
    await flushPromises()
    expect(w.findComponent(FileOutlineIcon).exists()).toBe(true)
  })

  // M34.9 (backlog/v1.md): a `q=` full-text hit carries a `snippet` cell
  // (M34.5's ts_headline() excerpt, mapped in per M34.8) — rendered under the
  // filename column so the row visibly shows why it matched.
  it('renders the highlighted snippet under the filename column when present', async () => {
    const columns: ColumnDef[] = [{ key: 'filename', label: 'Filename', dataType: 'string' }]
    const rows: TableRow[] = [
      {
        id: 'row-0',
        cells: { filename: 'invoice.pdf', mime_type: 'application/pdf', snippet: 'the <b>Acme</b> invoice' },
      },
    ]
    const w = mountTable(() => Promise.resolve({ items: rows }), { columns })
    await flushPromises()
    const snippet = w.find('[data-testid="virtual-table-snippet"]')
    expect(snippet.exists()).toBe(true)
    expect(snippet.text()).toBe('the Acme invoice')
    expect(snippet.find('strong').text()).toBe('Acme')
  })

  it('renders no snippet element for a row without a snippet cell', async () => {
    const columns: ColumnDef[] = [{ key: 'filename', label: 'Filename', dataType: 'string' }]
    const rows: TableRow[] = [{ id: 'row-0', cells: { filename: 'invoice.pdf' } }]
    const w = mountTable(() => Promise.resolve({ items: rows }), { columns })
    await flushPromises()
    expect(w.find('[data-testid="virtual-table-snippet"]').exists()).toBe(false)
  })

  it('renders snippet markup as inert text rather than executing it (XSS safety)', async () => {
    const columns: ColumnDef[] = [{ key: 'filename', label: 'Filename', dataType: 'string' }]
    const rows: TableRow[] = [
      {
        id: 'row-0',
        cells: { filename: 'invoice.pdf', snippet: '<img src=x onerror=alert(1)> <b>match</b>' },
      },
    ]
    const w = mountTable(() => Promise.resolve({ items: rows }), { columns })
    await flushPromises()
    expect(w.find('[data-testid="virtual-table-snippet"] img').exists()).toBe(false)
    expect(w.find('[data-testid="virtual-table-snippet"]').text()).toContain('<img src=x onerror=alert(1)>')
  })

  // M94.2: the active sort's `cursorPaginated` flag must be resolved against
  // the FULL column set (`allColumns`), not just the visible subset
  // (`columns`) — a column hidden via ColumnPicker must not disable
  // pagination for a sort the API genuinely pages correctly.
  it('scroll-prefetches and shows no notice when the active sort column is cursorPaginated but hidden from the visible column set', async () => {
    const visibleColumns: ColumnDef[] = [{ key: 'amount', label: 'Amount', dataType: 'int64' }]
    const allColumns: ColumnDef[] = [
      ...visibleColumns,
      { key: 'title', label: 'Title', dataType: 'string', sortable: true, cursorPaginated: true },
    ]
    const fetchPage = vi.fn((cursor?: string) =>
      Promise.resolve(cursor ? { items: makeRows(30, 30) } : { items: makeRows(30), next_cursor: 'cursor-2' }),
    )
    const w = mountTable(fetchPage, {
      columns: visibleColumns,
      allColumns,
      activeSort: { column: 'title', direction: 'asc' },
    })
    await flushPromises()

    expect(w.find('[data-testid="virtual-table-first-page-only-notice"]').exists()).toBe(false)

    const body = w.find('[data-testid="virtual-table-body"]').element
    Object.defineProperty(body, 'scrollTop', { value: 44 * 30 - VIEWPORT_HEIGHT, configurable: true })
    await w.find('[data-testid="virtual-table-body"]').trigger('scroll')
    await flushPromises()

    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(fetchPage).toHaveBeenLastCalledWith('cursor-2')
  })

  it('never scroll-prefetches while the active sort is not cursorPaginated, even if a next_cursor is returned', async () => {
    const fetchPage = vi.fn(() => Promise.resolve({ items: makeRows(30), next_cursor: 'cursor-2' }))
    const w = mountTable(fetchPage, { activeSort: { column: 'amount', direction: 'desc' } })
    await flushPromises()

    const body = w.find('[data-testid="virtual-table-body"]').element
    Object.defineProperty(body, 'scrollTop', { value: 44 * 30 - VIEWPORT_HEIGHT, configurable: true })
    await w.find('[data-testid="virtual-table-body"]').trigger('scroll')
    await flushPromises()

    expect(fetchPage).toHaveBeenCalledTimes(1)
  })
})

// --- M124.2: opt-in selection (frontend.md § Files-app parity) --------------
describe('VirtualTable selection', () => {
  const page = async (): Promise<Page> => ({ items: makeRows(3) })

  it('renders no checkbox column unless asked, so existing callers are untouched', async () => {
    const w = mountTable(page)
    await flushPromises()

    expect(w.find('[data-testid="virtual-table-select-all"]').exists()).toBe(false)
    expect(w.findAll('[data-testid="virtual-table-select-row"]')).toHaveLength(0)
  })

  it('emits the new selection when a row is checked, without activating the row', async () => {
    const w = mountTable(page, { selectable: true, selectedIds: [] })
    await flushPromises()

    await w.findAll('[data-testid="virtual-table-select-row"]')[1].setValue(true)

    expect(w.emitted('selectionChange')?.[0]).toEqual([['row-1']])
    // Checking must not navigate/preview — that is what a row CLICK does.
    expect(w.emitted('rowClick')).toBeUndefined()
  })

  it('unchecks by emitting the selection without that row', async () => {
    const w = mountTable(page, { selectable: true, selectedIds: ['row-0', 'row-1'] })
    await flushPromises()

    await w.findAll('[data-testid="virtual-table-select-row"]')[0].setValue(false)

    expect(w.emitted('selectionChange')?.[0]).toEqual([['row-1']])
  })

  it('does not own the selection: it renders whatever the caller passes back', async () => {
    // The caller clears it on a directory change, which is why this component
    // must not keep its own copy — a stale selection could send a bulk delete
    // at rows the user can no longer see.
    const w = mountTable(page, { selectable: true, selectedIds: ['row-2'] })
    await flushPromises()

    const boxes = w.findAll('[data-testid="virtual-table-select-row"]')
    expect(boxes.map((box) => (box.element as HTMLInputElement).checked)).toEqual([false, false, true])

    await w.setProps({ selectedIds: [] })
    expect(
      w.findAll('[data-testid="virtual-table-select-row"]').map((b) => (b.element as HTMLInputElement).checked),
    ).toEqual([false, false, false])
  })

  it('select-all covers the loaded rows, and toggles back off', async () => {
    const w = mountTable(page, { selectable: true, selectedIds: [] })
    await flushPromises()

    await w.find('[data-testid="virtual-table-select-all"]').setValue(true)
    expect(w.emitted('selectionChange')?.[0]).toEqual([['row-0', 'row-1', 'row-2']])

    await w.setProps({ selectedIds: ['row-0', 'row-1', 'row-2'] })
    await w.find('[data-testid="virtual-table-select-all"]').setValue(false)
    expect(w.emitted('selectionChange')?.[1]).toEqual([[]])
  })

  it('marks selected rows so the selection is visible, not only in a counter', async () => {
    const w = mountTable(page, { selectable: true, selectedIds: ['row-1'] })
    await flushPromises()

    const rows = w.findAll('.virtual-table__row:not(.virtual-table__row--skeleton)')
    expect(rows[1].classes()).toContain('virtual-table__row--selected')
    expect(rows[0].classes()).not.toContain('virtual-table__row--selected')
  })
})

// M161.2 (backlog/v1.md Phase 161): `hideBody` hides only the row/skeleton/
// empty/notice area, keeping `.virtual-table__header` (and the `header-extra`
// slot FileBrowserPage puts its table/grid toggle in) mounted and visible —
// a caller must never have to `v-show` the whole component to get this.
describe('VirtualTable — hideBody + header-extra slot (M161.2)', () => {
  it('renders the header-extra slot inside the header, empty by default for other callers', async () => {
    const w = mountTable(() => Promise.resolve({ items: makeRows(1) }))
    await flushPromises()

    // No caller passed the slot, so no extra header cell exists — every other
    // VirtualTable usage is unaffected by this milestone.
    expect(w.find('.virtual-table__th--view-toggle').exists()).toBe(false)
  })

  it('renders a caller-provided header-extra slot as a trailing header cell', async () => {
    const w = mount(VirtualTable, {
      props: { columns: COLUMNS, fetchPage: () => Promise.resolve({ items: makeRows(1) }) },
      slots: { 'header-extra': '<button data-testid="fake-toggle">toggle</button>' },
    })
    await flushPromises()

    const cell = w.find('.virtual-table__th--view-toggle')
    expect(cell.exists()).toBe(true)
    expect(cell.find('[data-testid="fake-toggle"]').exists()).toBe(true)
  })

  it('hides the body but keeps the header (and its header-extra slot) visible when hideBody is true', async () => {
    const w = mount(VirtualTable, {
      props: {
        columns: COLUMNS,
        fetchPage: () => Promise.resolve({ items: makeRows(3) }),
        hideBody: true,
      },
      slots: { 'header-extra': '<button data-testid="fake-toggle">toggle</button>' },
    })
    await flushPromises()

    expect(w.find('.virtual-table__header').isVisible()).toBe(true)
    expect(w.find('[data-testid="fake-toggle"]').isVisible()).toBe(true)
    expect(w.find('[data-testid="virtual-table-body"]').isVisible()).toBe(false)
  })

  it('shows the body again, header still intact, once hideBody goes back to false', async () => {
    const w = mount(VirtualTable, {
      props: {
        columns: COLUMNS,
        fetchPage: () => Promise.resolve({ items: makeRows(3) }),
        hideBody: true,
      },
      slots: { 'header-extra': '<button data-testid="fake-toggle">toggle</button>' },
    })
    await flushPromises()

    await w.setProps({ hideBody: false })

    expect(w.find('[data-testid="virtual-table-body"]').isVisible()).toBe(true)
    expect(w.find('.virtual-table__header').isVisible()).toBe(true)
    expect(w.find('[data-testid="fake-toggle"]').isVisible()).toBe(true)
  })

  it('does not show the empty slot while hideBody is true, even with zero rows', async () => {
    const w = mount(VirtualTable, {
      props: {
        columns: COLUMNS,
        fetchPage: () => Promise.resolve({ items: [] }),
        hideBody: true,
      },
      slots: { empty: '<div data-testid="fake-empty">nothing here</div>' },
    })
    await flushPromises()

    expect(w.find('[data-testid="fake-empty"]').exists()).toBe(false)
  })
})

// M171.1 (backlog/v1.md Phase 171): in grid mode (`hideBody`), `Size`/`Modified`
// (any non-first sortable column) must go inert to pointer AND keyboard and
// stop announcing themselves as a sort control — while `Name` (the first
// column, the tile caption) stays a live sort control in both modes.
describe('VirtualTable — grid-mode sort inertness (M171.1)', () => {
  const SORTABLE_COLUMNS: ColumnDef[] = [
    { key: 'filename', label: 'Name', dataType: 'string', sortable: true },
    { key: 'size', label: 'Size', dataType: 'int64', sortable: true },
    { key: 'mtime', label: 'Modified', dataType: 'date', sortable: true },
  ]

  it('table mode: every sortable column (including the first) is clickable and carries aria-sort', async () => {
    const w = mountTable(() => Promise.resolve({ items: makeRows(1) }), {
      columns: SORTABLE_COLUMNS,
      activeSort: { column: 'size', direction: 'asc' },
    })
    await flushPromises()

    const headers = w.findAll('[role="columnheader"]')
    // [Name, Size, Modified] — no select/actions/view-toggle cells were requested.
    expect(headers[0].attributes('aria-sort')).toBe('none')
    expect(headers[1].attributes('aria-sort')).toBe('ascending')
    expect(headers[2].attributes('aria-sort')).toBe('none')

    await headers[2].trigger('click')
    expect(w.emitted('sortChange')?.[0]).toEqual(['mtime'])
  })

  it('grid mode: Size and Modified are inert to pointer and carry no aria-sort, but Name still sorts', async () => {
    const w = mountTable(() => Promise.resolve({ items: makeRows(1) }), {
      columns: SORTABLE_COLUMNS,
      activeSort: { column: 'size', direction: 'asc' },
      hideBody: true,
    })
    await flushPromises()

    const headers = w.findAll('[role="columnheader"]')
    const [nameHeader, sizeHeader, mtimeHeader] = headers

    // Name: still a live, announced sort control.
    expect(nameHeader.classes()).toContain('virtual-table__th--sortable')
    expect(nameHeader.attributes('aria-sort')).toBe('none')
    await nameHeader.trigger('click')
    expect(w.emitted('sortChange')?.[0]).toEqual(['filename'])

    // Size / Modified: inert to pointer (click emits nothing) and to
    // assistive tech (no aria-sort at all, even though Size IS the active sort).
    for (const header of [sizeHeader, mtimeHeader]) {
      expect(header.classes()).not.toContain('virtual-table__th--sortable')
      expect(header.classes()).toContain('virtual-table__th--grid-inert')
      expect(header.attributes('aria-sort')).toBeUndefined()
    }
    await sizeHeader.trigger('click')
    await mtimeHeader.trigger('click')
    // Only Name's earlier click emitted — Size/Modified add nothing further.
    expect(w.emitted('sortChange')).toEqual([['filename']])
  })

  it('grid mode: Size/Modified are not keyboard-focusable (no tabindex added to the inert cells)', async () => {
    const w = mountTable(() => Promise.resolve({ items: makeRows(1) }), {
      columns: SORTABLE_COLUMNS,
      hideBody: true,
    })
    await flushPromises()

    const [, sizeHeader, mtimeHeader] = w.findAll('[role="columnheader"]')
    expect(sizeHeader.attributes('tabindex')).toBeUndefined()
    expect(mtimeHeader.attributes('tabindex')).toBeUndefined()
  })
})
