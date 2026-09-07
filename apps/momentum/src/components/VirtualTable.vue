<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { getLanguage, t } from '@nextcloud/l10n'
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, CloseIcon } from './icons'
import { mimeTypeToIcon, mimeTypeToIconColor } from './mimeTypeToIcon'
import {
  computeVisibleRowRange,
  formatByteSize,
  formatCellValue,
  formatRelativeDate,
  isNearBottom,
  parseSnippetSegments,
} from './virtualTableLayout'
import type { ColumnDef, Page, SortState, TableRow } from '../types'

// VirtualTable (frontend.md § VirtualTable): the low-level windowed table
// primitive DocumentList (M4.4) composes. `@nextcloud/vue` has no virtual-table
// primitive, so this is the one deliberate bespoke exception (CLAUDE.md §
// UI component priority). Its contract is exactly the two props frontend.md
// names — `columns` and `fetchPage(cursor?)` — and nothing more: it owns
// viewport culling, skeleton-while-loading, the empty state, cursor-paged
// prefetch on scroll, and typed cell rendering. Toolbar / filter / sort state
// live in DocumentList, never here.
//
// Single root (<div class="virtual-table">), so a caller's `class`/`style`
// auto-merges onto it — the multi-root `$attrs`-forwarding pitfall (CLAUDE.md)
// does not apply.
// `activeSort` and the `sortChange`/`rowClick` emits are the seam DocumentList
// (M4.4) uses to compose sortable headers and row navigation on top of this
// primitive: VirtualTable renders the arrow and fires the click, but never
// decides what the new sort is or where a row click navigates to — that
// state/behaviour stays in DocumentList (frontend.md § VirtualTable).
const props = defineProps<{
  columns: ColumnDef[]
  fetchPage: (cursor?: string) => Promise<Page>
  activeSort?: SortState
  // The cursor to request on first load — set by DocumentList (M4.5) when
  // restoring a `cursor` URL parameter (frontend.md § URL State Management)
  // so a shared/back-navigated link resumes from where it was left rather
  // than always starting at page 1.
  initialCursor?: string
  // The full column set (visible + hidden), for resolving the active sort's
  // `cursorPaginated` flag (M94.2). `columns` above is DocumentList's
  // *visible* subset — a column can be sortable and cursor-paginated while
  // hidden via ColumnPicker, and hiding it must never disable pagination.
  // Falls back to `columns` so callers that pass a single already-complete
  // set (e.g. tests) don't need to pass this separately.
  allColumns?: ColumnDef[]
  // Renders a leading checkbox column and emits `selectionChange` (M124.2,
  // frontend.md § Files-app parity). Opt-in: DocumentList does not pass it and
  // renders exactly as before. The SELECTED IDS ARE OWNED BY THE CALLER —
  // passed back in via `selectedIds` — because the caller is what knows when a
  // selection has become meaningless (a directory change), and a selection that
  // outlived its listing would let a bulk action land on rows the user can no
  // longer see.
  selectable?: boolean
  selectedIds?: string[]
  // M161.2 (backlog/v1.md Phase 161): hides the row/skeleton/empty/notice
  // area while keeping `.virtual-table__header` (and its `header-extra` slot)
  // mounted and visible. FileBrowserPage uses this instead of `v-show`-hiding
  // the whole component in grid mode — a `<thead>`-equivalent that leaves with
  // the rest of the table takes the view toggle with it, making the control
  // that switches back one-way (measured live, 2026-09-03: the toggle at
  // x=1873 vanished the moment grid mode hid the table it was inside).
  hideBody?: boolean
}>()

const emit = defineEmits<{
  (e: 'sortChange', key: string): void
  (e: 'rowClick', id: string): void
  (e: 'selectionChange', ids: string[]): void
}>()

// M171.1 (backlog/v1.md Phase 171): in grid mode (`hideBody`) only the first
// column stays a live sort control — it's the one the tile caption renders,
// so it's the only ordering a user can actually verify. Every other sortable
// column (Size, Modified for FileBrowserPage's grid) must go inert to
// pointer AND keyboard, and must stop announcing itself as a sort control —
// matching the mockup's *behaviour* (`table.filelist.grid-active
// thead th.col-size, th.col-mtime`), not its `color: transparent` mechanism,
// which would leave a screen-reader-reachable control that does nothing.
function isGridInertSort(index: number): boolean {
  return !!props.hideBody && index > 0
}

// `aria-sort` for the table's real sort state (a gap: these headers carried
// none before, in either mode). Never set on a grid-inert cell — announcing
// "sorted by Size" while the grid doesn't render Size at all would reproduce
// the exact defect this milestone removes, just in assistive technology.
function ariaSort(col: ColumnDef, index: number): 'ascending' | 'descending' | 'none' | undefined {
  if (!col.sortable || isGridInertSort(index)) return undefined
  if (props.activeSort?.column === col.key) {
    return props.activeSort.direction === 'asc' ? 'ascending' : 'descending'
  }
  return 'none'
}

// Fixed row geometry the windowing math pages over. Presentational (not a
// tunable behaviour like SCROLL_PREFETCH_ROWS), so it lives here rather than in
// MOMENTUM_CONFIG. Rows are a uniform height so spacer <div>s above/below the
// materialised window preserve the scrollbar's true extent.
const ROW_HEIGHT = 44
// Rows rendered beyond the viewport on each side, so a fast scroll doesn't flash
// blank before the next window materialises.
const OVERSCAN = 6
// Placeholder rows shown while a fetch is in flight.
const SKELETON_ROWS = 8

// M33.6: an active sort whose column has no `cursorPaginated: true` (today,
// any column other than `created_at` — api.md § Sort parameter, M32.1) always
// gets `next_cursor: null` back from the API, so infinite-scroll can never
// resume past the first page. Rather than silently capping (this project's
// "no silent caps" convention), show a visible notice and refuse to
// scroll-prefetch even if a response somehow carried a next_cursor anyway.
const activeSortColumn = computed(() =>
  (props.allColumns ?? props.columns).find((c) => c.key === props.activeSort?.column),
)
const isFirstPageOnlySort = computed(() => props.activeSort !== undefined && !activeSortColumn.value?.cursorPaginated)
const firstPageOnlyNoticeText = computed(() =>
  t('momentum', 'Showing first {count} results, sorted by {field}', {
    count: rows.value.length,
    field: activeSortColumn.value?.label ?? props.activeSort?.column ?? '',
  }),
)

const rows = ref<TableRow[]>([])
const loading = ref(false)
const loaded = ref(false)
const nextCursor = ref<string | undefined>(undefined)
const scrollTop = ref(0)
const viewportHeight = ref(0)
const scrollEl = ref<HTMLElement | null>(null)

// More pages exist iff the last fetched page carried a next_cursor. Checked
// with `!= null` (not `!== undefined`) as defense in depth: the wire format
// signals "no more pages" with `next_cursor: null`, and while fetchPage
// adapters normalize that to `undefined` before it reaches here (Page's
// stated contract), treating `null` the same as `undefined` means a future
// adapter that forgets the normalization degrades to "stop prefetching"
// rather than looping loadPage(null) back to page 1 forever.
const hasMore = computed(() => nextCursor.value != null)

// The empty slot shows only once the first fetch has settled with zero rows —
// never while still loading (that's the skeleton's job).
const isEmpty = computed(() => loaded.value && !loading.value && rows.value.length === 0)

const visibleRange = computed(() =>
  computeVisibleRowRange(scrollTop.value, viewportHeight.value, ROW_HEIGHT, rows.value.length, OVERSCAN),
)
const visibleRows = computed(() => rows.value.slice(visibleRange.value.start, visibleRange.value.end))
const topSpacerPx = computed(() => visibleRange.value.start * ROW_HEIGHT)
const bottomSpacerPx = computed(() => (rows.value.length - visibleRange.value.end) * ROW_HEIGHT)

function isNumeric(col: ColumnDef): boolean {
  return col.dataType === 'int64' || col.dataType === 'double'
}

// M171.6 (backlog/v1.md Phase 171): the mockup (`#filelist-table`) gives Size
// and Modified their own narrow, roughly-fixed widths (128px each at its
// 1920px reference) rather than an equal flex share, so Name absorbs the
// remaining row width instead of "2 KB" being stretched across a ~187px
// cell. `col.key` is FileBrowserPage's own column-id convention (`size`,
// `mtime`, byteSize/relativeDate-flagged) — no other VirtualTable caller uses
// those keys today (checked: DocumentsListPage/RecentDocumentsPage/
// ByTypeDocumentListPage all use different column ids), so this only
// re-proportions the file browser's table, same blast radius M171.4 checked.
function isNarrowColumn(col: ColumnDef): boolean {
  return col.key === 'size' || col.key === 'mtime'
}

// One rendering seam for every cell: a column's `byteSize`/`relativeDate`
// presentation opt-ins (Phase 146) take priority over `formatCellValue`'s
// generic per-`dataType` formatting, which stays the default for every
// column that doesn't opt in (e.g. an extracted-field `int64`/`date` column
// that genuinely wants a raw grouped number / absolute date).
function cellText(row: TableRow, col: ColumnDef): string {
  const value = row.cells[col.key]
  if (col.byteSize) return formatByteSize(value)
  if (col.relativeDate) return formatRelativeDate(value)
  return formatCellValue(value, col.dataType ?? 'string', getLanguage())
}

// M33.10: the `filename` column shows a file-type icon keyed on the row's
// `mime_type` cell (M33.8's search response field), resolved via M33.9's
// mimeTypeToIcon map.
function fileTypeIcon(row: TableRow) {
  const mimeType = row.cells.mime_type
  return mimeTypeToIcon(typeof mimeType === 'string' ? mimeType : undefined)
}

function fileTypeIconColor(row: TableRow) {
  const mimeType = row.cells.mime_type
  return mimeTypeToIconColor(typeof mimeType === 'string' ? mimeType : undefined)
}

// M34.9 (backlog/v1.md): the `snippet` cell (M34.5's ts_headline() excerpt,
// mapped in per the M34.8 q= wiring) is present only for a `q=` full-text
// search hit — like `mime_type`, it's a hidden cell VirtualTable itself
// consumes rather than a selectable column. Rendered under the `filename`
// column so a matching row visibly shows *why* it matched, parsed via
// parseSnippetSegments rather than v-html since the excerpt wraps raw
// document content (CLAUDE.md § Security).
function rowSnippetSegments(row: TableRow) {
  const snippet = row.cells.snippet
  return typeof snippet === 'string' && snippet !== '' ? parseSnippetSegments(snippet) : null
}

// Fetch one page and append its rows. Guards against overlapping fetches so a
// burst of scroll events can't fire the same next-page request twice.
async function loadPage(cursor?: string): Promise<void> {
  if (loading.value) return
  loading.value = true
  try {
    const page = await props.fetchPage(cursor)
    rows.value = rows.value.concat(page.items)
    nextCursor.value = page.next_cursor
  } finally {
    loaded.value = true
    loading.value = false
  }
}

// Sync scroll geometry into reactive state, then prefetch the next page once
// the viewport is within SCROLL_PREFETCH_ROWS of the loaded set's bottom.
function onScroll(): void {
  const el = scrollEl.value
  if (!el) return
  scrollTop.value = el.scrollTop
  viewportHeight.value = el.clientHeight
  if (
    hasMore.value &&
    !loading.value &&
    !isFirstPageOnlySort.value &&
    isNearBottom(scrollTop.value, viewportHeight.value, ROW_HEIGHT, rows.value.length)
  ) {
    void loadPage(nextCursor.value)
  }
}

onMounted(() => {
  if (scrollEl.value) viewportHeight.value = scrollEl.value.clientHeight
  void loadPage(props.initialCursor)
})

const selected = computed(() => new Set(props.selectedIds ?? []))

// Select-all reflects the LOADED rows, which for a cursor-paginated table is
// not necessarily every row that exists — so it is deliberately described as
// "all loaded rows" and never used to imply a server-side "select everything".
const allLoadedSelected = computed(
  () => rows.value.length > 0 && rows.value.every((row) => selected.value.has(row.id)),
)

function toggleRow(id: string): void {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  emit('selectionChange', [...next])
}

function toggleAll(): void {
  emit('selectionChange', allLoadedSelected.value ? [] : rows.value.map((row) => row.id))
}
</script>

<template>
  <div
    class="virtual-table"
    :class="{ 'virtual-table--body-hidden': hideBody }"
    role="table">
    <div class="virtual-table__header" role="row">
      <div v-if="selectable" role="columnheader" class="virtual-table__th virtual-table__th--select">
        <input
          type="checkbox"
          data-testid="virtual-table-select-all"
          :aria-label="t('momentum', 'Select all loaded rows')"
          :checked="allLoadedSelected"
          @change="toggleAll" />
      </div>
      <template v-for="(col, colIndex) in columns" :key="col.key">
        <div
          role="columnheader"
          class="virtual-table__th"
          :class="{
            'virtual-table__th--numeric': isNumeric(col),
            'virtual-table__th--narrow': isNarrowColumn(col),
            'virtual-table__th--sortable': col.sortable && !isGridInertSort(colIndex),
            'virtual-table__th--grid-inert': col.sortable && isGridInertSort(colIndex),
          }"
          :aria-sort="ariaSort(col, colIndex)"
          @click="col.sortable && !isGridInertSort(colIndex) ? emit('sortChange', col.key) : undefined">
          {{ col.label }}
          <ArrowUpIcon
            v-if="!isGridInertSort(colIndex) && activeSort?.column === col.key && activeSort.direction === 'asc'"
            :size="16" />
          <ArrowDownIcon
            v-else-if="!isGridInertSort(colIndex) && activeSort?.column === col.key && activeSort.direction === 'desc'"
            :size="16" />
        </div>
        <!-- Actions column sits right after the first (name) column, matching
             both the mockup and Nextcloud's own Files app (M178.7,
             backlog/v1.md Phase 178) — present only when a caller provides the
             `row-actions` slot (FileBrowserPage, M123.2). Header cell kept
             empty and same-width as the row cells so columns stay aligned;
             without it every row would be one cell wider than the header. -->
        <div
          v-if="colIndex === 0 && $slots['row-actions']"
          role="columnheader"
          class="virtual-table__th virtual-table__th--actions"
          aria-hidden="true" />
      </template>
      <!-- Trailing view-toggle cell (M161.2, backlog/v1.md Phase 161),
           matching the mockup's `th.col-view` position — right-aligned, after
           every other header cell. Empty unless a caller provides it (only
           FileBrowserPage's table/grid toggle does today), so every other
           VirtualTable caller is unaffected. -->
      <div
        v-if="$slots['header-extra']"
        role="columnheader"
        class="virtual-table__th virtual-table__th--view-toggle">
        <slot name="header-extra" />
      </div>
    </div>

    <div
      v-show="!hideBody"
      ref="scrollEl"
      class="virtual-table__body"
      data-testid="virtual-table-body"
      @scroll="onScroll">
      <div class="virtual-table__spacer" :style="{ height: topSpacerPx + 'px' }" aria-hidden="true" />

      <div
        v-for="row in visibleRows"
        :key="row.id"
        role="row"
        class="virtual-table__row virtual-table__row--clickable"
        :class="{ 'virtual-table__row--selected': selected.has(row.id) }"
        :style="{ height: ROW_HEIGHT + 'px' }"
        @click="emit('rowClick', row.id)">
        <!-- `@click.stop`: checking a row must not also activate it (which
             would navigate into a folder or open a preview). -->
        <div
          v-if="selectable"
          role="cell"
          class="virtual-table__td virtual-table__td--select"
          @click.stop>
          <input
            type="checkbox"
            data-testid="virtual-table-select-row"
            :aria-label="t('momentum', 'Select row')"
            :checked="selected.has(row.id)"
            @change="toggleRow(row.id)" />
        </div>
        <template v-for="(col, colIndex) in columns" :key="col.key">
          <div
            role="cell"
            class="virtual-table__td"
            :class="{ 'virtual-table__td--numeric': isNumeric(col), 'virtual-table__td--narrow': isNarrowColumn(col) }">
            <template v-if="col.dataType === 'boolean'">
              <CheckIcon v-if="row.cells[col.key] === true" :size="20" />
              <CloseIcon v-else-if="row.cells[col.key] === false" :size="20" />
            </template>
            <span v-else-if="col.pill" class="virtual-table__pill">
              {{ cellText(row, col) }}
            </span>
            <div v-else-if="col.key === 'filename'" class="virtual-table__filename-cell">
              <span class="virtual-table__filename-line">
                <component
                  :is="fileTypeIcon(row)"
                  :size="22"
                  :fill-color="fileTypeIconColor(row)"
                  class="virtual-table__file-icon" />
                <span class="virtual-table__filename-text">{{ cellText(row, col) }}</span>
              </span>
              <span
                v-if="rowSnippetSegments(row)"
                class="virtual-table__snippet"
                data-testid="virtual-table-snippet">
                <template v-for="(segment, index) in rowSnippetSegments(row) ?? []" :key="index">
                  <strong v-if="segment.highlighted">{{ segment.text }}</strong>
                  <template v-else>{{ segment.text }}</template>
                </template>
              </span>
            </div>
            <template v-else>{{ cellText(row, col) }}</template>
          </div>
          <!-- `@click.stop`: the row itself is clickable (rowClick navigates
               or opens a preview), so a click on an action menu must not also
               trigger the row's own activation. Sits right after the first
               (name) column — see the matching header comment (M178.7). -->
          <div
            v-if="colIndex === 0 && $slots['row-actions']"
            role="cell"
            class="virtual-table__td virtual-table__td--actions"
            @click.stop>
            <slot name="row-actions" :row="row" />
          </div>
        </template>
        <!-- Trailing filler column mirroring the header's view-toggle cell
             (M171.5, backlog/v1.md Phase 171). The header carries a
             view-toggle cell whenever `header-extra` is provided (M161.2);
             without a same-width, empty counterpart here every body row would
             have one fewer cell than the header, so the flexible columns
             drift out of alignment with their headers — this is the same
             invariant the actions-column comment above documents for the
             actions column, just for the view-toggle one. -->
        <div
          v-if="$slots['header-extra']"
          role="cell"
          class="virtual-table__td virtual-table__td--view-toggle"
          aria-hidden="true" />
      </div>

      <div
        v-for="n in loading ? SKELETON_ROWS : 0"
        :key="'skeleton-' + n"
        role="row"
        data-testid="virtual-table-skeleton"
        class="virtual-table__row virtual-table__row--skeleton"
        aria-hidden="true"
        :style="{ height: ROW_HEIGHT + 'px' }">
        <div v-if="selectable" class="virtual-table__td virtual-table__td--select" />
        <template v-for="(col, colIndex) in columns" :key="col.key">
          <div class="virtual-table__td">
            <span class="virtual-table__skeleton-bar" />
          </div>
          <div v-if="colIndex === 0 && $slots['row-actions']" class="virtual-table__td virtual-table__td--actions" />
        </template>
        <div v-if="$slots['header-extra']" class="virtual-table__td virtual-table__td--view-toggle" />
      </div>

      <div class="virtual-table__spacer" :style="{ height: bottomSpacerPx + 'px' }" aria-hidden="true" />
    </div>

    <div v-if="isEmpty && !hideBody" class="virtual-table__empty">
      <slot name="empty" />
    </div>

    <div
      v-if="isFirstPageOnlySort && !isEmpty && !hideBody"
      data-testid="virtual-table-first-page-only-notice"
      class="virtual-table__notice">
      {{ firstPageOnlyNoticeText }}
    </div>
  </div>
</template>

<style scoped>
.virtual-table {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.virtual-table__header {
  display: flex;
  flex: 0 0 auto;
  border-bottom: 1px solid var(--color-border);
  font-weight: bold;
}

.virtual-table__body {
  flex: 1 1 auto;
  overflow-y: auto;
  min-height: 0;
}

/* M161.2: with the body hidden the root must shrink to the header's own
   content height instead of claiming its usual 100% — otherwise it leaves a
   blank gap where the (now v-show: none) body used to be, and steals the
   flex space a sibling grid view needs to fill instead. */
.virtual-table--body-hidden {
  height: auto;
  flex: 0 0 auto;
}

/* M171.4: this base rule must stay declared ABOVE every fixed-width column
   rule below (--view-toggle, --select, --actions). All of those are
   single-class selectors tying this one's specificity (0,1,0), so with equal
   specificity source order decides — if this rule is ever moved below them
   again, it wins again and silently zeroes out all three fixed widths (this
   is exactly how the bug measured in backlog/v1.md Phase 171/M171.4 happened:
   a 267px checkbox column). Do not reorder without re-reading that note. */
.virtual-table__th,
.virtual-table__td {
  flex: 1 1 0;
  padding: 0 12px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.virtual-table__th {
  padding-top: 8px;
  padding-bottom: 8px;
}

/* Fixed, narrow trailing column for the optional view-toggle header slot —
   right-aligned, matching the mockup's `th.col-view`. `--td--view-toggle` is
   the body/skeleton counterpart (M171.5, backlog/v1.md Phase 171): an inert
   filler cell so the header's extra column doesn't leave the header with one
   more cell than the row, which would drift every flexible column out of
   alignment with the row beneath it.

   The basis is `--default-clickable-area` (34px) alone is too narrow: with
   `justify-content: flex-end` the button lays out from the cell's right edge
   minus this rule's own `padding-inline` (12px), so the button starts at
   `width - 12 - 34` and clips by exactly that padding at 34px. `51px` is
   `M171.6`'s own declared width for this column (backlog/v1.md Phase 181,
   M181.3) and is sufficient — measured live, it fully contains the button.
   Do not remove the padding to "fix" this instead: it is shared cell
   styling, and dropping it here alone would make this column's control sit
   flush against the edge while every other column keeps its inset. */
.virtual-table__th--view-toggle {
  flex: 0 0 51px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.virtual-table__td--view-toggle {
  flex: 0 0 51px;
}

/* Fixed, narrow leading column for the optional selection checkbox — same
   reasoning as the actions column below: a single control must not take an
   equal share of the row. */
.virtual-table__th--select,
.virtual-table__td--select {
  flex: 0 0 var(--default-clickable-area);
  display: flex;
  align-items: center;
  justify-content: center;
}

.virtual-table__row--selected {
  background-color: var(--color-primary-element-light);
}

/* Fixed, narrow trailing column for the optional `row-actions` slot. Unlike
   --select/--view-toggle (a single control each), this slot holds TWO
   34x34 controls (the inline sharing-status button added by M174.5, plus the
   overflow menu) side by side with a `gap` between them
   (`.momentum-row-actions`, FileBrowserPage.vue) of `var(--default-grid-baseline,
   4px)` — so the basis must count two clickable areas PLUS that gap, not just
   the two controls (backlog/v1.md Phase 181, M181.1; the prior calc-times-2
   form undercounted the gap and clipped by exactly 4px). A single
   clickable-area basis here clips the second control, since `overflow: hidden`
   on the base rule above is load-bearing (keeps long filenames from bleeding
   across columns) and must stay. */
.virtual-table__th--actions,
.virtual-table__td--actions {
  flex: 0 0 calc(var(--default-clickable-area) * 2 + var(--default-grid-baseline));
  display: flex;
  align-items: center;
  justify-content: center;
}

.virtual-table__row {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--color-border);
}

.virtual-table__row--clickable {
  cursor: pointer;
}

.virtual-table__th--sortable {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
}

/* M171.1: the grid-mode-only inert state for a sortable column whose value
   the tile grid doesn't render (Size, Modified) — pointer-events: none is
   the actual click-blocker; the click handler is already gated in the
   template, this just keeps hover affordance honest too. */
.virtual-table__th--grid-inert {
  cursor: default;
  pointer-events: none;
}

.virtual-table__th--numeric,
.virtual-table__td--numeric {
  text-align: right;
  justify-content: flex-end;
}

/* M171.6 (backlog/v1.md Phase 171): Size/Modified get the mockup's narrow,
   roughly-fixed width (`#filelist-table`'s `th.col-size`/`th.col-mtime`,
   measured 128px) instead of an equal flex share with Name — matching the
   mockup over NC's own 88/110px Files-app values since this phase tracks the
   mockup. `flex: 0 1 128px` (shrinkable, not growable) rather than
   `--select`/`--actions`' `0 0 var(--default-clickable-area)`: those are
   fixed-size icon controls, this is text that must still ellipsis at narrow
   viewports rather than force a horizontal scrollbar. Same specificity
   (0,1,0) as the base rule above, so — same caveat as that rule's own
   comment — this must stay declared below it or it goes dead the same way. */
.virtual-table__th--narrow,
.virtual-table__td--narrow {
  flex: 0 1 128px;
}

.virtual-table__file-icon {
  flex: 0 0 auto;
}

.virtual-table__filename-cell {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  overflow: hidden;
}

.virtual-table__filename-line {
  display: flex;
  align-items: center;
  gap: calc(var(--default-grid-baseline, 4px) * 2);
  min-width: 0;
}

.virtual-table__filename-text,
.virtual-table__snippet {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.virtual-table__snippet {
  color: var(--color-text-maxcontrast);
  font-size: calc(var(--default-font-size, 15px) * 0.85);
}

.virtual-table__snippet strong {
  color: var(--color-main-text);
}

.virtual-table__pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--border-radius-pill, 16px);
  background: var(--color-background-dark);
  font-size: calc(var(--default-font-size, 15px) * 0.85);
}

.virtual-table__skeleton-bar {
  display: block;
  height: 12px;
  width: 70%;
  border-radius: var(--border-radius);
  background: var(--color-background-dark);
}

.virtual-table__empty {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.virtual-table__notice {
  flex: 0 0 auto;
  padding: 8px 12px;
  color: var(--color-text-maxcontrast);
  font-size: calc(var(--default-font-size, 15px) * 0.85);
  border-top: 1px solid var(--color-border);
}
</style>
