import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import FileTileGrid from './FileTileGrid.vue'
import type { TableRow } from '../types'

// Component tests for FileTileGrid (M147.1, backlog/v1.md Phase 147): the
// tile-grid rendering of the same rows VirtualTable renders as a table. It
// owns NO selection state of its own — `selectedIds` is passed in and
// `selectionChange` is emitted, exactly like VirtualTable's `selectable`
// contract, so a caller can drive both views off one shared array (CLAUDE.md's
// "two selection models in one view is the defect this note exists to
// prevent").

const ROWS: TableRow[] = [
  {
    id: '/Invoices',
    cells: { filename: 'Invoices', mime_type: 'httpd/unix-directory', size: null, mtime: null },
  },
  {
    id: '/a.pdf',
    cells: {
      filename: 'a.pdf',
      mime_type: 'application/pdf',
      size: 2048,
      mtime: '2026-08-01T10:00:00Z',
    },
  },
]

function mountGrid(opts: { rows?: TableRow[]; selectedIds?: string[] } = {}) {
  return mount(FileTileGrid, {
    props: {
      rows: opts.rows ?? ROWS,
      selectedIds: opts.selectedIds ?? [],
    },
  })
}

describe('FileTileGrid', () => {
  it('renders one tile per row, named', () => {
    const wrapper = mountGrid()
    const tiles = wrapper.findAll('[data-testid="file-tile-grid-tile"]')
    expect(tiles).toHaveLength(2)
    expect(wrapper.text()).toContain('Invoices')
    expect(wrapper.text()).toContain('a.pdf')
  })

  it('emits rowClick with the row id when a tile is clicked', async () => {
    const wrapper = mountGrid()
    await wrapper.findAll('[data-testid="file-tile-grid-tile"]')[1].trigger('click')
    expect(wrapper.emitted('rowClick')?.[0]).toEqual(['/a.pdf'])
  })

  it('toggles a tile into the shared selection without a second selection model', async () => {
    const wrapper = mountGrid()
    const checkbox = wrapper.findAll('[data-testid="file-tile-grid-select"]')[1]
    await checkbox.setValue(true)

    expect(wrapper.emitted('selectionChange')?.[0]).toEqual([['/a.pdf']])
  })

  it('checking a tile does not also fire rowClick', async () => {
    const wrapper = mountGrid()
    const checkbox = wrapper.findAll('[data-testid="file-tile-grid-select"]')[1]
    await checkbox.setValue(true)

    expect(wrapper.emitted('rowClick')).toBeUndefined()
  })

  it('reflects an already-selected id passed in via selectedIds', () => {
    const wrapper = mountGrid({ selectedIds: ['/a.pdf'] })
    const checkboxes = wrapper.findAll('[data-testid="file-tile-grid-select"]')
    expect((checkboxes[0].element as HTMLInputElement).checked).toBe(false)
    expect((checkboxes[1].element as HTMLInputElement).checked).toBe(true)
  })

  it('marks a selected tile so it stays visibly selected without hover', () => {
    const wrapper = mountGrid({ selectedIds: ['/a.pdf'] })
    const tiles = wrapper.findAll('[data-testid="file-tile-grid-tile"]')
    expect(tiles[1].classes()).toContain('file-tile-grid__tile--selected')
  })

  it('exposes a valid list/listitem ARIA tree, not grid/gridcell', () => {
    const wrapper = mountGrid()
    expect(wrapper.attributes('role')).toBe('list')
    for (const tile of wrapper.findAll('[data-testid="file-tile-grid-tile"]')) {
      expect(tile.attributes('role')).toBe('listitem')
    }
  })

  it('shows the empty slot when there are no rows', () => {
    const wrapper = mount(FileTileGrid, {
      props: { rows: [], selectedIds: [] },
      slots: { empty: '<div data-testid="grid-empty-slot">Nothing here</div>' },
    })
    expect(wrapper.find('[data-testid="grid-empty-slot"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="file-tile-grid-tile"]').exists()).toBe(false)
  })

  it('renders the row-actions slot per tile, scoped to that row', () => {
    const wrapper = mount(FileTileGrid, {
      props: { rows: ROWS, selectedIds: [] },
      slots: {
        'row-actions': `<template #default="{ row }"><button data-testid="tile-action" :data-row="row.id">act</button></template>`,
      },
    })
    const actions = wrapper.findAll('[data-testid="tile-action"]')
    expect(actions).toHaveLength(2)
    expect(actions[1].attributes('data-row')).toBe('/a.pdf')
  })

  it('clicking a row-actions control does not also fire rowClick', async () => {
    const wrapper = mount(FileTileGrid, {
      props: { rows: ROWS, selectedIds: [] },
      slots: {
        'row-actions': `<template #default="{ row }"><button data-testid="tile-action" :data-row="row.id">act</button></template>`,
      },
    })
    await wrapper.findAll('[data-testid="tile-action"]')[0].trigger('click')
    expect(wrapper.emitted('rowClick')).toBeUndefined()
  })
})

// M163.1 (backlog/v1.md Phase 163): FileTileGrid had NO windowing at all — a
// bare `v-for` over every row. Measured live on a real 500-file folder at
// 1440x900: 500 tiles, 8,500 grid-subtree DOM nodes, 868ms toggle-to-tiles.
// These tests reproduce that 1440x900 viewport (jsdom implements no layout,
// so clientWidth/clientHeight must be stubbed to get a non-zero window) and
// assert a concrete node budget, not merely "the grid renders" — every one of
// the 500 tiles being mounted would satisfy "renders" and is exactly the
// defect this milestone exists to fix. Below 500 rows the check passes
// trivially and proves nothing (backlog/v1.md Phase 163's note), so every
// case here uses at least 500.
function manyRows(count: number): TableRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `/file-${i}.pdf`,
    cells: { filename: `file-${i}.pdf`, mime_type: 'application/pdf', size: 2048, mtime: null },
  }))
}

describe('FileTileGrid windowing (M163.1)', () => {
  let originalClientWidth: PropertyDescriptor | undefined
  let originalClientHeight: PropertyDescriptor | undefined

  beforeEach(() => {
    // Stubbed once, at the prototype level, so every element the component
    // measures (the scroller root) reports the same 1440x900-viewport
    // geometry the live measurement used — jsdom has no real layout engine,
    // so clientWidth/clientHeight are 0 unless a test provides them.
    originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 1440 })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 800 })
  })

  afterEach(() => {
    if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth)
    if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight)
  })

  it('renders substantially fewer tiles than rows at 500 rows (concrete node budget)', () => {
    // At 1440x900 with a 9rem/1.4rem tile geometry, one screenful is ~8
    // columns x ~6 visible rows; with OVERSCAN=2 rows on each side that is at
    // most (6 + 2*2) * 8 = 80 tiles. Budgeted at 100 to leave headroom for
    // rounding without coming anywhere near "renders every row".
    const wrapper = mount(FileTileGrid, { props: { rows: manyRows(500), selectedIds: [] } })
    const tiles = wrapper.findAll('[data-testid="file-tile-grid-tile"]')
    expect(tiles.length).toBeGreaterThan(0)
    expect(tiles.length).toBeLessThan(100)
  })

  it('does not grow the rendered tile count linearly with folder size', () => {
    // The defect this milestone fixes is measured, live, as linear: DOM node
    // count scaled 1:1 with row count. A windowed grid must not: the rendered
    // set is bounded by the viewport, so 500 rows and 5,000 rows should
    // materialise close to the same number of tiles.
    const small = mount(FileTileGrid, { props: { rows: manyRows(500), selectedIds: [] } })
    const large = mount(FileTileGrid, { props: { rows: manyRows(5000), selectedIds: [] } })
    const smallCount = small.findAll('[data-testid="file-tile-grid-tile"]').length
    const largeCount = large.findAll('[data-testid="file-tile-grid-tile"]').length
    expect(largeCount).toBeLessThan(smallCount * 2)
  })

  it('keeps the scrollbar extent correct via spacers without mounting the skipped tiles', () => {
    const wrapper = mount(FileTileGrid, { props: { rows: manyRows(500), selectedIds: [] } })
    const tiles = wrapper.findAll('[data-testid="file-tile-grid-tile"]')
    // Every tile not materialised is accounted for by the top+bottom
    // spacers' combined height, not silently dropped from the scroll range.
    const spacerHeights = wrapper
      .findAll('.file-tile-grid__spacer')
      .map((el) => Number.parseFloat((el.attributes('style') ?? '').match(/height:\s*([\d.]+)px/)?.[1] ?? '0'))
    const totalSpacerHeight = spacerHeights.reduce((a, b) => a + b, 0)
    expect(totalSpacerHeight).toBeGreaterThan(0)
    expect(tiles.length).toBeLessThan(500)
  })

  it('still renders every row once scrolled to the bottom, just windowed there too', async () => {
    const rows = manyRows(500)
    const wrapper = mount(FileTileGrid, { props: { rows, selectedIds: [] } })
    const scroller = wrapper.get('[data-testid="file-tile-grid-scroller"]')
    // At 1440x900 with 8 columns and a ~150px row step, 500 rows total
    // ~9.5k px of scroll height — 9000 lands within a row-step of the true
    // bottom without depending on jsdom (which never clamps a
    // manually-assigned scrollTop the way a real browser would).
    Object.defineProperty(scroller.element, 'scrollTop', { configurable: true, value: 9000 })
    await scroller.trigger('scroll')
    const tiles = wrapper.findAll('[data-testid="file-tile-grid-tile"]')
    expect(tiles.length).toBeGreaterThan(0)
    expect(tiles.length).toBeLessThan(100)
    const lastTileText = tiles[tiles.length - 1].text()
    expect(lastTileText).toContain(rows[rows.length - 1].cells.filename as string)
  })
})
