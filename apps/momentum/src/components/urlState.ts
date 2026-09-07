// URL state encode/decode for DocumentList (frontend.md § URL State
// Management, M4.5). Pure functions only — DocumentList owns reading these
// from the current route on mount and writing them back via
// router.push/replace per the History strategy table; this module just
// defines the bijective string<->state mapping so that logic isn't
// duplicated or drifted between the two directions.
import type { ActiveFilter, SortState } from '../types'

export const URL_PARAM_SORT = 'sort'
export const URL_PARAM_COLS = 'cols'
export const URL_PARAM_FILTER = 'f'
export const URL_PARAM_CURSOR = 'cursor'

// vue-router query values arrive as this shape (LocationQueryValue[Raw]) —
// declared locally so this module has no dependency on vue-router itself.
export type QueryParamValue = string | null | undefined | Array<string | null>

function firstValue(value: QueryParamValue): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  return raw ?? null
}

// --- sort: `column_name:asc` or `column_name:desc` ---

export function encodeSortParam(sort: SortState): string {
  return `${sort.column}:${sort.direction}`
}

export function decodeSortParam(value: QueryParamValue): SortState | null {
  const raw = firstValue(value)
  if (raw === null) return null
  const separatorIndex = raw.lastIndexOf(':')
  if (separatorIndex <= 0) return null
  const column = raw.slice(0, separatorIndex)
  const direction = raw.slice(separatorIndex + 1)
  if (direction !== 'asc' && direction !== 'desc') return null
  return { column, direction }
}

// --- cols: comma-separated column keys (frontend-only — never forwarded to
// fetchPage / the API; see the note on ActiveFilter's search encoding below
// for the parallel "URL state != request params" split) ---

export function encodeColsParam(cols: string[]): string {
  return cols.join(',')
}

export function decodeColsParam(value: QueryParamValue): string[] | null {
  const raw = firstValue(value)
  if (raw === null) return null
  const cols = raw
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
  return cols.length > 0 ? cols : null
}

// --- f: repeatable `field_name:operator:value` (api.md § Filter parameter) ---
//
// ActiveFilter also holds `{ kind: 'search', term }` for TypeaheadSearch
// commits (frontend.md § DocumentList toolbar item 2), which has no
// dedicated slot in api.md's `f` grammar — a reserved field_name/operator
// pair round-trips it through the same `f=` param rather than inventing a
// second URL parameter. How a search term is ultimately turned into a real
// `GET /search/documents` request param is the page's `fetchPage`
// implementation's concern (M4.7/M4.8); this module only needs a bijective
// URL encoding for DocumentList's own active-filter state.
export const SEARCH_FILTER_FIELD_NAME = 'q'
export const SEARCH_FILTER_OPERATOR = 'search'

export function encodeFilterParam(filter: ActiveFilter): string {
  if (filter.kind === 'search') {
    return `${SEARCH_FILTER_FIELD_NAME}:${SEARCH_FILTER_OPERATOR}:${filter.term}`
  }
  return `${filter.field_name}:${filter.operator}:${String(filter.value)}`
}

export function encodeFilterParams(filters: ActiveFilter[]): string[] {
  return filters.map(encodeFilterParam)
}

function decodeFilterEntry(raw: string): ActiveFilter | null {
  const parts = raw.split(':')
  if (parts.length < 3) return null
  const [fieldName, operator, ...rest] = parts
  const value = rest.join(':')
  if (fieldName === SEARCH_FILTER_FIELD_NAME && operator === SEARCH_FILTER_OPERATOR) {
    return { kind: 'search', term: value }
  }
  if (value === 'true') return { kind: 'field', field_name: fieldName, operator, value: true }
  if (value === 'false') return { kind: 'field', field_name: fieldName, operator, value: false }
  return { kind: 'field', field_name: fieldName, operator, value }
}

export function decodeFilterParams(value: QueryParamValue): ActiveFilter[] {
  if (value === null || value === undefined) return []
  const list = Array.isArray(value) ? value : [value]
  const filters: ActiveFilter[] = []
  for (const raw of list) {
    if (raw === null) continue
    const decoded = decodeFilterEntry(raw)
    if (decoded !== null) filters.push(decoded)
  }
  return filters
}

// --- cursor: opaque, passed through verbatim ---

export function decodeCursorParam(value: QueryParamValue): string | undefined {
  return firstValue(value) ?? undefined
}
