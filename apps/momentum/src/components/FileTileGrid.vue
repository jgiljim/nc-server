<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { getLanguage, t } from '@nextcloud/l10n'
import { mimeTypeToIcon, mimeTypeToIconColor } from './mimeTypeToIcon'
import { computeVisibleRowRange, formatCellValue } from './virtualTableLayout'
import type { TableRow } from '../types'

// FileTileGrid (M147.1, backlog/v1.md Phase 147; windowed by M163.1,
// backlog/v1.md Phase 163): the grid/tile view of the SAME rows VirtualTable
// renders as a table, matching specs/mockup-ai-document-manager.html's
// `.filelist-grid` — every row rendered twice, a table and a tile grid, with
// a toggle above swapping which one shows. FileBrowserPage owns the toggle;
// this component only knows how to render a `TableRow[]` as tiles.
//
// SELECTION IS NOT OWNED HERE. `selectedIds` comes in and `selectionChange`
// goes out, mirroring VirtualTable's `selectable` contract exactly, so a tile
// and its table row share one selection array rather than each keeping its
// own (CLAUDE.md § M147.1 note: "two selection models in one view is the
// defect this note exists to prevent").
const props = defineProps<{
  rows: TableRow[]
  selectedIds: string[]
}>()

const emit = defineEmits<{
  (e: 'rowClick', id: string): void
  (e: 'selectionChange', ids: string[]): void
}>()

const selected = computed(() => new Set(props.selectedIds))

// M163.1: M155.1 stopped this component mounting while hidden, but a bare
// `v-for` over every row was still ~17 DOM nodes per tile — fine hidden,
// ~8,500 nodes at 500 rows and ~85,000 at the 5,000-entry folder
// FileBrowserPage.vue's own comment cites once actually visible (measured
// live, backlog/v1.md Phase 163). VirtualTable already solves exactly this
// for the table view (`computeVisibleRowRange`), so this reuses that same
// pure windowing helper rather than adding a second implementation —
// `@nextcloud/vue` has no virtual-grid primitive, but a second bespoke one
// alongside VirtualTable's would be the defect this note exists to prevent.
//
// Fixed tile geometry the windowing math pages over, enforced via the inline
// `height`/`width` styles below rather than left to content-driven auto
// sizing (mirrors VirtualTable's fixed ROW_HEIGHT) — windowing needs to know
// exactly how tall a row of tiles is and how many tiles fit per row, and
// content-driven sizing can't give it that. TILE_WIDTH/GRID_GAP mirror the
// `.file-tile-grid` CSS below (`minmax(9rem, 1fr)` tracks, `1.4rem` gap) at a
// 16px root font size — the NC default; a user with a scaled root font size
// gets a slightly off overscan estimate, not a broken one, since OVERSCAN
// absorbs small misestimates.
const REM_PX = 16
const TILE_WIDTH = 9 * REM_PX
const TILE_HEIGHT = 8 * REM_PX
const GRID_GAP = 1.4 * REM_PX
// The per-grid-row pixel step computeVisibleRowRange pages over. CSS `gap`
// only applies *between* tracks (no gap after the last row), so this slightly
// overstates total height for N rows by one GRID_GAP — negligible next to
// OVERSCAN's buffer, and the same kind of approximation VirtualTable itself
// makes by ignoring border widths in ROW_HEIGHT.
const ROW_STEP = TILE_HEIGHT + GRID_GAP
// Grid rows of overscan on each side, not tile count — lower than
// VirtualTable's OVERSCAN=6 because each grid row already materialises many
// tiles at once (columnsPerRow of them), so the same node budget buys fewer
// row-heights of buffer.
const OVERSCAN = 2

const scrollEl = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(0)
const containerWidth = ref(0)
let resizeObserver: ResizeObserver | undefined

function syncGeometry(): void {
  const el = scrollEl.value
  if (!el) return
  viewportHeight.value = el.clientHeight
  containerWidth.value = el.clientWidth
}

function onScroll(): void {
  const el = scrollEl.value
  if (!el) return
  scrollTop.value = el.scrollTop
  syncGeometry()
}

onMounted(() => {
  syncGeometry()
  // jsdom (component tests) has no ResizeObserver; falling back to the
  // clientWidth read above means columnsPerRow degrades to its 1-column
  // floor there rather than throwing.
  if (typeof ResizeObserver !== 'undefined' && scrollEl.value) {
    resizeObserver = new ResizeObserver(syncGeometry)
    resizeObserver.observe(scrollEl.value)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
})

// Mirrors the CSS `repeat(auto-fill, minmax(9rem, 1fr))` track math: how many
// TILE_WIDTH-plus-gap tracks fit before the last one would drop below its
// minimum. Floored, never below 1 so a not-yet-laid-out container (width 0)
// still renders a column instead of an empty grid.
const columnsPerRow = computed(() => {
  if (containerWidth.value <= 0) return 1
  return Math.max(1, Math.floor((containerWidth.value + GRID_GAP) / (TILE_WIDTH + GRID_GAP)))
})

const gridRowCount = computed(() => Math.ceil(props.rows.length / columnsPerRow.value))

const visibleGridRowRange = computed(() =>
  computeVisibleRowRange(scrollTop.value, viewportHeight.value, ROW_STEP, gridRowCount.value, OVERSCAN),
)

const visibleRows = computed(() => {
  const start = visibleGridRowRange.value.start * columnsPerRow.value
  const end = Math.min(visibleGridRowRange.value.end * columnsPerRow.value, props.rows.length)
  return props.rows.slice(start, end)
})

const topSpacerPx = computed(() => visibleGridRowRange.value.start * ROW_STEP)
const bottomSpacerPx = computed(
  () => (gridRowCount.value - visibleGridRowRange.value.end) * ROW_STEP,
)

function tileIcon(row: TableRow) {
  const mimeType = row.cells.mime_type
  return mimeTypeToIcon(typeof mimeType === 'string' ? mimeType : undefined)
}

function tileIconColor(row: TableRow) {
  const mimeType = row.cells.mime_type
  return mimeTypeToIconColor(typeof mimeType === 'string' ? mimeType : undefined)
}

function tileName(row: TableRow): string {
  return formatCellValue(row.cells.filename, 'string', getLanguage())
}

function toggleTile(id: string): void {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  emit('selectionChange', [...next])
}
</script>

<template>
  <div
    ref="scrollEl"
    class="file-tile-grid"
    role="list"
    data-testid="file-tile-grid-scroller"
    :style="{ gridTemplateColumns: `repeat(${columnsPerRow}, minmax(${TILE_WIDTH}px, 1fr))` }"
    @scroll="onScroll">
    <div v-if="rows.length === 0" class="file-tile-grid__empty">
      <slot name="empty" />
    </div>
    <template v-else>
      <div
        class="file-tile-grid__spacer"
        :style="{ height: topSpacerPx + 'px' }"
        aria-hidden="true" />

      <div
        v-for="row in visibleRows"
        :key="row.id"
        role="listitem"
        class="file-tile-grid__tile"
        :class="{ 'file-tile-grid__tile--selected': selected.has(row.id) }"
        data-testid="file-tile-grid-tile"
        :style="{ height: TILE_HEIGHT + 'px' }"
        @click="emit('rowClick', row.id)">
        <!-- `@click.stop`: checking a tile must not also activate it, exactly
             like VirtualTable's row checkbox. -->
        <input
          type="checkbox"
          class="file-tile-grid__select"
          data-testid="file-tile-grid-select"
          :aria-label="t('momentum', 'Select row')"
          :checked="selected.has(row.id)"
          @click.stop
          @change="toggleTile(row.id)" />
        <span v-if="$slots['row-actions']" class="file-tile-grid__actions" @click.stop>
          <slot name="row-actions" :row="row" />
        </span>
        <div class="file-tile-grid__icon">
          <component :is="tileIcon(row)" :size="40" :fill-color="tileIconColor(row)" />
        </div>
        <span class="file-tile-grid__name">{{ tileName(row) }}</span>
      </div>

      <div
        class="file-tile-grid__spacer"
        :style="{ height: bottomSpacerPx + 'px' }"
        aria-hidden="true" />
    </template>
  </div>
</template>

<style scoped>
.file-tile-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
  align-content: flex-start;
  gap: 1.4rem;
  padding: 1rem 0;
  overflow-y: auto;
  min-height: 0;
  height: 100%;
}

.file-tile-grid__empty {
  grid-column: 1 / -1;
}

/* The windowing spacers (M163.1) that stand in for the tiles above/below the
   materialised range, so the scrollbar's true extent — and thus scroll
   position — stays correct without those tiles actually existing in the DOM.
   Must span every column or a CSS grid would place it in just the first
   track, collapsing the spacer's row instead of reserving its height. */
.file-tile-grid__spacer {
  grid-column: 1 / -1;
}

.file-tile-grid__tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  padding: 1rem 0.5rem;
  border-radius: var(--border-radius, 8px);
  cursor: pointer;
}

.file-tile-grid__tile:hover,
.file-tile-grid__tile--selected {
  background: var(--color-background-hover);
}

.file-tile-grid__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 3.2rem;
}

.file-tile-grid__name {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  width: 100%;
  text-align: center;
  line-height: 1.3;
  word-break: break-word;
  font-size: var(--default-font-size, 0.85rem);
  color: var(--color-main-text);
}

.file-tile-grid__select {
  position: absolute;
  top: 0.5rem;
  left: 0.5rem;
  z-index: 2;
  opacity: 0;
}

.file-tile-grid__tile:hover .file-tile-grid__select,
.file-tile-grid__tile--selected .file-tile-grid__select,
.file-tile-grid__select:focus {
  opacity: 1;
}

.file-tile-grid__actions {
  position: absolute;
  top: 0.3rem;
  right: 0.3rem;
  z-index: 2;
  opacity: 0;
}

.file-tile-grid__tile:hover .file-tile-grid__actions,
.file-tile-grid__actions:focus-within {
  opacity: 1;
}
</style>
