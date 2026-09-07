import { setLanguage, setLocale } from '@nextcloud/l10n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MOMENTUM_CONFIG } from '../config'
import {
  computeVisibleRowRange,
  formatByteSize,
  formatCellValue,
  formatRelativeDate,
  isNearBottom,
  parseSnippetSegments,
} from './virtualTableLayout'

// Unit tests for the pure windowing + cell-format helpers backing VirtualTable
// (frontend.md § VirtualTable). No DOM/Vue mounting — these are the backend-
// agnostic building blocks issue 60's VirtualTable.vue composes.

describe('computeVisibleRowRange', () => {
  it('returns the [start, end) window covering the viewport with no overscan', () => {
    // 100px viewport / 20px rows starting at scrollTop 0 → rows [0, 5).
    expect(computeVisibleRowRange(0, 100, 20, 100, 0)).toEqual({ start: 0, end: 5 })
  })

  it('offsets the window by scrollTop and pads it by overscan on both ends', () => {
    // scrollTop 200 → first visible row 10; viewport bottom 300 → row 15;
    // overscan 2 pads to [8, 17).
    expect(computeVisibleRowRange(200, 100, 20, 100, 2)).toEqual({ start: 8, end: 17 })
  })

  it('clamps the start to 0 even when overscan would push it negative', () => {
    expect(computeVisibleRowRange(0, 100, 20, 100, 5)).toEqual({ start: 0, end: 10 })
  })

  it('clamps negative scrollTop to a start of 0', () => {
    expect(computeVisibleRowRange(-500, 100, 20, 100, 0).start).toBe(0)
  })

  it('clamps the end to rowCount when scrolled past the bottom', () => {
    expect(computeVisibleRowRange(10_000, 100, 20, 100, 3)).toEqual({ start: 100, end: 100 })
  })

  it('returns an empty window for zero rows', () => {
    expect(computeVisibleRowRange(0, 100, 20, 0, 3)).toEqual({ start: 0, end: 0 })
  })

  it('degrades to the whole set when row height is non-positive', () => {
    expect(computeVisibleRowRange(0, 100, 0, 42, 3)).toEqual({ start: 0, end: 42 })
  })

  it('never produces a start greater than end', () => {
    const { start, end } = computeVisibleRowRange(9_999, 50, 20, 100, 10)
    expect(start).toBeLessThanOrEqual(end)
  })
})

describe('isNearBottom', () => {
  it('is false when the viewport is at the top of a long list', () => {
    expect(isNearBottom(0, 100, 20, 100)).toBe(false)
  })

  it('becomes true exactly SCROLL_PREFETCH_ROWS from the bottom', () => {
    // rowCount 100, prefetch default 3 → threshold last-visible index 97.
    // viewport bottom at row 97 → near bottom; at 96 → not yet.
    const prefetch = MOMENTUM_CONFIG.SCROLL_PREFETCH_ROWS
    expect(prefetch).toBe(3)
    // last visible = ceil((scrollTop + viewport) / rowHeight)
    // want 97: scrollTop + 100 = 1940 → scrollTop 1840.
    expect(isNearBottom(1840, 100, 20, 100)).toBe(true)
    // want 96: scrollTop + 100 = 1920 → scrollTop 1820.
    expect(isNearBottom(1820, 100, 20, 100)).toBe(false)
  })

  it('honours an explicit prefetch override', () => {
    // With prefetch 10 the threshold moves to last-visible index 90.
    expect(isNearBottom(1700, 100, 20, 100, 10)).toBe(true)
    expect(isNearBottom(1680, 100, 20, 100, 10)).toBe(false)
  })

  it('is false for an empty list (nothing loaded to prefetch past)', () => {
    expect(isNearBottom(0, 100, 20, 0)).toBe(false)
  })

  it('is true when every row fits (non-positive row height)', () => {
    expect(isNearBottom(0, 100, 0, 100)).toBe(true)
  })
})

describe('formatCellValue', () => {
  it('renders null and undefined as an empty string for every type', () => {
    expect(formatCellValue(null, 'string')).toBe('')
    expect(formatCellValue(undefined, 'string')).toBe('')
    expect(formatCellValue(null, 'int64', 'en-US')).toBe('')
    expect(formatCellValue(undefined, 'double', 'en-US')).toBe('')
    expect(formatCellValue(null, 'date', 'en-US')).toBe('')
    expect(formatCellValue(undefined, 'boolean')).toBe('')
  })

  it('returns string values unchanged', () => {
    expect(formatCellValue('Invoice #42', 'string')).toBe('Invoice #42')
    expect(formatCellValue('', 'string')).toBe('')
  })

  it('coerces non-string values to text under the string type', () => {
    expect(formatCellValue(42, 'string')).toBe('42')
    expect(formatCellValue(true, 'string')).toBe('true')
  })

  it('formats int64 with locale grouping and no decimals', () => {
    expect(formatCellValue(1234567, 'int64', 'en-US')).toBe('1,234,567')
    expect(formatCellValue(1234567, 'int64', 'de-DE')).toBe('1.234.567')
  })

  it('rounds fractional input to a whole number for int64', () => {
    expect(formatCellValue(12.9, 'int64', 'en-US')).toBe('13')
  })

  it('accepts numeric strings and bigints for int64', () => {
    expect(formatCellValue('1000', 'int64', 'en-US')).toBe('1,000')
    expect(formatCellValue(1000n, 'int64', 'en-US')).toBe('1,000')
  })

  it('returns empty string for a non-numeric int64 value', () => {
    expect(formatCellValue('not-a-number', 'int64', 'en-US')).toBe('')
  })

  it('formats double with the locale decimal separator', () => {
    expect(formatCellValue(1234.5, 'double', 'en-US')).toBe('1,234.5')
    expect(formatCellValue(1234.5, 'double', 'de-DE')).toBe('1.234,5')
  })

  it('formats dates locale-aware from a Date object', () => {
    // Built from local components so the assertion is timezone-independent.
    const d = new Date(2026, 6, 23)
    expect(formatCellValue(d, 'date', 'en-US')).toBe('7/23/2026')
    expect(formatCellValue(d, 'date', 'de-DE')).toBe('23.7.2026')
  })

  it('parses ISO date strings before formatting', () => {
    expect(formatCellValue('2026-07-23', 'date', 'en-US')).toMatch(/2026/)
  })

  it('returns empty string for an unparseable date', () => {
    expect(formatCellValue('not-a-date', 'date', 'en-US')).toBe('')
  })

  it('renders booleans as their textual form (icon rendering lives in VirtualTable)', () => {
    expect(formatCellValue(true, 'boolean')).toBe('true')
    expect(formatCellValue(false, 'boolean')).toBe('false')
  })

  it('falls back to the runtime default locale when none is given', () => {
    // Don't assert an exact separator (host-locale dependent) — just that a
    // grouped integer round-trips to a non-empty string containing the digits.
    expect(formatCellValue(1234567, 'int64')).toMatch(/1.?234.?567/)
  })
})

// Phase 146: human-readable file sizes via `@nextcloud/files`' `formatFileSize`.
// `formatFileSize` reads its decimal-separator locale from `@nextcloud/l10n`'s
// ambient `getCanonicalLocale()` global rather than taking a parameter, so —
// per Phase 137's convention — these tests pin that global explicitly with
// `setLocale()` rather than asserting a substring that would pass or fail
// depending on the host machine's own locale.
describe('formatByteSize', () => {
  afterEach(() => {
    setLanguage('en')
    setLocale('en')
  })

  it('renders null and undefined as an empty string', () => {
    expect(formatByteSize(null)).toBe('')
    expect(formatByteSize(undefined)).toBe('')
  })

  it('renders a sub-kilobyte size in bytes', () => {
    setLocale('en')
    expect(formatByteSize(512)).toBe('512 B')
  })

  it('renders a kilobyte-scale size with no decimals', () => {
    setLocale('en')
    expect(formatByteSize(50_000)).toBe('49 KB')
  })

  it('renders a megabyte-scale size under an explicitly injected en locale', () => {
    setLocale('en')
    expect(formatByteSize(3_800_000)).toBe('3.6 MB')
  })

  it('renders the same megabyte-scale size with a comma decimal separator under an explicitly injected de locale', () => {
    setLocale('de')
    expect(formatByteSize(3_800_000)).toBe('3,6 MB')
  })

  it('returns empty string for a non-numeric value', () => {
    expect(formatByteSize('not-a-number')).toBe('')
  })
})

// Phase 146: relative dates via `@nextcloud/l10n`'s `formatRelativeTime`.
// `formatRelativeTime` resolves "now" from `Date.now()` and its display
// language from the same ambient `getLanguage()` global `formatByteSize`
// depends on — tests pin both explicitly (`vi.useFakeTimers` + `setLanguage()`)
// rather than asserting a substring under the ambient host clock/locale.
describe('formatRelativeDate', () => {
  const NOW = new Date(2026, 8, 2, 12, 0, 0).getTime()

  afterEach(() => {
    vi.useRealTimers()
    setLanguage('en')
    setLocale('en')
  })

  it('renders null and undefined as an empty string', () => {
    expect(formatRelativeDate(null)).toBe('')
    expect(formatRelativeDate(undefined)).toBe('')
  })

  it('returns empty string for an unparseable date', () => {
    expect(formatRelativeDate('not-a-date')).toBe('')
  })

  it('renders a same-day timestamp in hours', () => {
    vi.useFakeTimers({ now: NOW })
    setLanguage('en')
    expect(formatRelativeDate(NOW - 3 * 3600 * 1000)).toBe('3 hours ago')
  })

  it('renders a one-day-old timestamp as "yesterday"', () => {
    vi.useFakeTimers({ now: NOW })
    setLanguage('en')
    expect(formatRelativeDate(NOW - 24 * 3600 * 1000)).toBe('yesterday')
  })

  it('renders a two-day-old timestamp in days', () => {
    vi.useFakeTimers({ now: NOW })
    setLanguage('en')
    expect(formatRelativeDate(NOW - 2 * 24 * 3600 * 1000)).toBe('2 days ago')
  })

  it('renders the same timestamps in German under an explicitly injected locale', () => {
    vi.useFakeTimers({ now: NOW })
    setLanguage('de')
    expect(formatRelativeDate(NOW - 24 * 3600 * 1000)).toBe('gestern')
    expect(formatRelativeDate(NOW - 2 * 24 * 3600 * 1000)).toBe('vorgestern')
  })
})

// M34.9 (backlog/v1.md): parses a ts_headline()-produced snippet (M34.5) into
// plain-text/highlighted segments VirtualTable renders with {{ }} interpolation
// rather than v-html — the snippet wraps *document content* (not sanitized by
// ts_headline beyond inserting <b>/</b> around matches), so treating it as raw
// HTML would be an XSS vector (CLAUDE.md § Security: "never dangerouslySetInnerHTML
// with user data").
describe('parseSnippetSegments', () => {
  it('splits plain text with no match into a single non-highlighted segment', () => {
    expect(parseSnippetSegments('no matches here')).toEqual([
      { text: 'no matches here', highlighted: false },
    ])
  })

  it('marks text wrapped in <b>/</b> as highlighted', () => {
    expect(parseSnippetSegments('the <b>invoice</b> total')).toEqual([
      { text: 'the ', highlighted: false },
      { text: 'invoice', highlighted: true },
      { text: ' total', highlighted: false },
    ])
  })

  it('handles multiple highlighted terms', () => {
    expect(parseSnippetSegments('<b>Acme</b> paid <b>Corp</b>')).toEqual([
      { text: '', highlighted: false },
      { text: 'Acme', highlighted: true },
      { text: ' paid ', highlighted: false },
      { text: 'Corp', highlighted: true },
      { text: '', highlighted: false },
    ])
  })

  it('returns an empty array for an empty snippet', () => {
    expect(parseSnippetSegments('')).toEqual([])
  })

  it('does not interpret non-<b> markup as HTML — it is treated as literal text', () => {
    // A document whose own content contains "<script>" must never be executed
    // or otherwise treated as markup; it survives as inert text content.
    expect(parseSnippetSegments('<script>alert(1)</script> <b>match</b>')).toEqual([
      { text: '<script>alert(1)</script> ', highlighted: false },
      { text: 'match', highlighted: true },
      { text: '', highlighted: false },
    ])
  })
})
