// Pure windowing + cell-format helpers backing the VirtualTable primitive
// (frontend.md § VirtualTable). Deliberately free of any DOM or Vue import so
// they are unit-testable without mounting — VirtualTable.vue (issue 60) wires
// these into scroll handling and cell rendering. Every tunable comes from
// MOMENTUM_CONFIG (frontend.md § Frontend Configuration); no magic numbers here.
import { formatFileSize } from '@nextcloud/files'
import { formatRelativeTime } from '@nextcloud/l10n'
import { MOMENTUM_CONFIG } from '../config'
import type { FieldDataType } from '../types'

// The half-open [start, end) range of row indices VirtualTable materialises for
// a given scroll position: `start` inclusive, `end` exclusive.
export interface VisibleRowRange {
  start: number
  end: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

// Viewport culling: given the current scroll offset and geometry, return the
// half-open range of rows to render, padded by `overscan` rows on each side and
// clamped to [0, rowCount]. A non-positive row height is degenerate (rows have
// no height to page by) so the whole set is returned. Callers pass fixed row
// geometry; `overscan` defaults to none so the caller opts into padding.
export function computeVisibleRowRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  rowCount: number,
  overscan = 0,
): VisibleRowRange {
  if (rowCount <= 0) return { start: 0, end: 0 }
  if (rowHeight <= 0) return { start: 0, end: rowCount }

  const firstVisible = Math.floor(scrollTop / rowHeight)
  const lastVisible = Math.ceil((scrollTop + viewportHeight) / rowHeight)

  return {
    start: clamp(firstVisible - overscan, 0, rowCount),
    end: clamp(lastVisible + overscan, 0, rowCount),
  }
}

// True when the viewport bottom is within `prefetchRows` of the loaded set's
// bottom — the trigger for fetching the next page (frontend.md § VirtualTable:
// "Loads the next page when the user scrolls within SCROLL_PREFETCH_ROWS of the
// current bottom"). An empty set has nothing to prefetch past (false); a set
// whose rows all fit is trivially at its bottom (true).
export function isNearBottom(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  rowCount: number,
  prefetchRows: number = MOMENTUM_CONFIG.SCROLL_PREFETCH_ROWS,
): boolean {
  if (rowCount <= 0) return false
  if (rowHeight <= 0) return true

  const lastVisible = Math.ceil((scrollTop + viewportHeight) / rowHeight)
  return lastVisible >= rowCount - prefetchRows
}

// Coerce a value to a finite JS number, or null if it isn't numeric. Numeric
// strings (an int64 field can arrive JSON-encoded as a string) are accepted;
// empty/blank and non-numeric strings are not.
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return null
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
  }
  return null
}

// Coerce a value to a valid Date, or null. Accepts a Date instance or anything
// the Date constructor parses (ISO date/time strings, epoch millis).
function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

// Format one cell's raw value into display text according to its column type
// (frontend.md § VirtualTable). `null`/`undefined` → ''; `string` as-is;
// `int64` locale-grouped with no decimals; `double` locale decimal separator;
// `date` locale-aware via Intl. `boolean` renders as an icon in VirtualTable
// itself — this returns the textual fallback ('true'/'false') for a11y/export.
// `locale` defaults to the runtime's locale when omitted.
export function formatCellValue(
  value: unknown,
  type: FieldDataType,
  locale?: string,
): string {
  if (value === null || value === undefined) return ''

  switch (type) {
    case 'string':
      return typeof value === 'string' ? value : String(value)

    case 'boolean':
      return value ? 'true' : 'false'

    case 'int64': {
      if (typeof value === 'bigint') {
        return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)
      }
      const n = toNumber(value)
      return n === null
        ? ''
        : new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n)
    }

    case 'double': {
      const n = toNumber(value)
      return n === null ? '' : new Intl.NumberFormat(locale).format(n)
    }

    case 'date': {
      const d = toDate(value)
      return d === null ? '' : new Intl.DateTimeFormat(locale).format(d)
    }

    default:
      return String(value)
  }
}

// Human-readable file size (`54 KB`, `1 MB`) for a column that opts in via
// `ColumnDef.byteSize` (Phase 146) rather than `formatCellValue`'s locale-
// grouped raw byte count. Delegates to `@nextcloud/files`' `formatFileSize` —
// this project's convention (Phase 146 notes, CLAUDE.md) is to adopt a
// packaged helper rather than write our own. `formatFileSize` itself pulls
// its decimal-separator locale from `@nextcloud/l10n`'s `getCanonicalLocale()`
// (ambient global state, not a parameter), the same mechanism Phase 137 wired
// `getLanguage()` through for `formatCellValue` — tests must set it via
// `setLocale()`, not rely on the host's default.
export function formatByteSize(value: unknown): string {
  const n = toNumber(value)
  return n === null ? '' : formatFileSize(n)
}

// Relative date (`3 hours ago`, `yesterday`, `last week`) for a column that
// opts in via `ColumnDef.relativeDate` (Phase 146) rather than
// `formatCellValue`'s absolute `Intl.DateTimeFormat` rendering. Delegates to
// `@nextcloud/l10n`'s `formatRelativeTime`, which resolves "now" from
// `Date.now()` and its display language from the same ambient
// `getLanguage()` global `formatCellValue` threads explicitly — tests must
// control both via `vi.setSystemTime`/`setLanguage()`, not the host's
// defaults.
export function formatRelativeDate(value: unknown): string {
  const d = toDate(value)
  return d === null ? '' : formatRelativeTime(d)
}

// One piece of a ts_headline()-produced snippet (M34.5): either plain text or a
// matched term to render bolded.
export interface SnippetSegment {
  text: string
  highlighted: boolean
}

// Splits a ts_headline() snippet on its `<b>`/`</b>` match markers into plain-
// text/highlighted segments, so VirtualTable can render it with `{{ }}`
// interpolation (auto-escaped) instead of `v-html`. The snippet wraps document
// content ts_headline does not otherwise sanitize, so treating it as raw HTML
// would let a document's own text (e.g. a literal "<script>") execute — every
// segment here, `<b>`/`</b>` included, is always rendered as inert text.
export function parseSnippetSegments(snippet: string): SnippetSegment[] {
  if (snippet === '') return []
  return snippet
    .split(/<\/?b>/)
    .map((text, index) => ({ text, highlighted: index % 2 === 1 }))
}
