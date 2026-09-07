import { describe, expect, it } from 'vitest'
import {
  decodeColsParam,
  decodeCursorParam,
  decodeFilterParams,
  decodeSortParam,
  encodeColsParam,
  encodeFilterParam,
  encodeFilterParams,
  encodeSortParam,
} from './urlState'
import type { ActiveFilter, SortState } from '../types'

// Pure encode/decode round-trip tests for URL state (frontend.md § URL State
// Management, M4.5). Component-level wiring (reading on mount,
// pushState/replaceState per action) is covered in DocumentList.unit.test.ts.

describe('urlState — sort', () => {
  it('encodes a SortState as column:direction', () => {
    expect(encodeSortParam({ column: 'created_at', direction: 'desc' })).toBe('created_at:desc')
  })

  it('decodes column:direction back into a SortState', () => {
    expect(decodeSortParam('filename:asc')).toEqual({ column: 'filename', direction: 'asc' })
  })

  it('round-trips a column name that itself contains a colon', () => {
    const sort: SortState = { column: 'weird:field', direction: 'asc' }
    expect(decodeSortParam(encodeSortParam(sort))).toEqual(sort)
  })

  it('returns null for a missing, malformed, or invalid-direction value', () => {
    expect(decodeSortParam(null)).toBeNull()
    expect(decodeSortParam(undefined)).toBeNull()
    expect(decodeSortParam('no-colon-here')).toBeNull()
    expect(decodeSortParam('created_at:sideways')).toBeNull()
  })

  it('takes the first value when vue-router hands back an array', () => {
    expect(decodeSortParam(['created_at:desc', 'filename:asc'])).toEqual({
      column: 'created_at',
      direction: 'desc',
    })
  })
})

describe('urlState — cols', () => {
  it('encodes column keys as a comma-separated list', () => {
    expect(encodeColsParam(['doc_id', 'filename', 'status'])).toBe('doc_id,filename,status')
  })

  it('decodes a comma-separated list back into column keys', () => {
    expect(decodeColsParam('doc_id,filename,status')).toEqual(['doc_id', 'filename', 'status'])
  })

  it('trims whitespace and drops empty entries', () => {
    expect(decodeColsParam('doc_id, filename ,,status')).toEqual(['doc_id', 'filename', 'status'])
  })

  it('returns null when absent or entirely empty', () => {
    expect(decodeColsParam(null)).toBeNull()
    expect(decodeColsParam(undefined)).toBeNull()
    expect(decodeColsParam('')).toBeNull()
    expect(decodeColsParam(',,')).toBeNull()
  })
})

describe('urlState — f (filters)', () => {
  it('encodes a field filter as field_name:operator:value', () => {
    const filter: ActiveFilter = { kind: 'field', field_name: 'status', operator: 'eq', value: 'done' }
    expect(encodeFilterParam(filter)).toBe('status:eq:done')
  })

  it('encodes a boolean value with String()', () => {
    const filter: ActiveFilter = { kind: 'field', field_name: 'reviewed', operator: 'eq', value: false }
    expect(encodeFilterParam(filter)).toBe('reviewed:eq:false')
  })

  it('encodes a search term through the reserved q:search field/operator pair', () => {
    const filter: ActiveFilter = { kind: 'search', term: 'acme' }
    expect(encodeFilterParam(filter)).toBe('q:search:acme')
  })

  it('decodes multiple f values, preserving order', () => {
    const decoded = decodeFilterParams(['reviewed:eq:false', 'status:eq:done'])
    expect(decoded).toEqual([
      { kind: 'field', field_name: 'reviewed', operator: 'eq', value: false },
      { kind: 'field', field_name: 'status', operator: 'eq', value: 'done' },
    ])
  })

  it('decodes the reserved q:search pair back into a search ActiveFilter', () => {
    expect(decodeFilterParams('q:search:acme')).toEqual([{ kind: 'search', term: 'acme' }])
  })

  it('round-trips a value that itself contains a colon', () => {
    const filter: ActiveFilter = { kind: 'field', field_name: 'range', operator: 'between', value: '10:00,12:00' }
    const encoded = encodeFilterParam(filter)
    expect(decodeFilterParams(encoded)).toEqual([filter])
  })

  it('round-trips a full active-filter list through encode then decode', () => {
    const filters: ActiveFilter[] = [
      { kind: 'search', term: 'acme corp' },
      { kind: 'field', field_name: 'total_amount', operator: 'gt', value: '100' },
    ]
    expect(decodeFilterParams(encodeFilterParams(filters))).toEqual(filters)
  })

  it('returns an empty array when absent, and skips malformed entries', () => {
    expect(decodeFilterParams(null)).toEqual([])
    expect(decodeFilterParams(undefined)).toEqual([])
    expect(decodeFilterParams('not-enough-parts')).toEqual([])
    expect(decodeFilterParams(['status:eq:done', 'garbage'])).toEqual([
      { kind: 'field', field_name: 'status', operator: 'eq', value: 'done' },
    ])
  })
})

describe('urlState — cursor', () => {
  it('passes an opaque cursor value through verbatim', () => {
    expect(decodeCursorParam('eyJ0cyI6...')).toBe('eyJ0cyI6...')
  })

  it('returns undefined when absent', () => {
    expect(decodeCursorParam(null)).toBeUndefined()
    expect(decodeCursorParam(undefined)).toBeUndefined()
  })

  it('takes the first value when handed an array', () => {
    expect(decodeCursorParam(['first', 'second'])).toBe('first')
  })
})
