// Backend-agnostic data-plane types for the VirtualTable primitive (frontend.md
// § VirtualTable) and the DocumentList that composes it (M4.4). VirtualTable and
// ColumnPicker both take `columns: ColumnDef[]` (frontend.md § VirtualTable /
// § ColumnPicker), so the column contract and its cell-type union live here as
// the single source of truth; this module adds the row and page shapes that
// describe the *data* flowing through the table. Nothing here imports from the
// generated `schema.d.ts` or any Vue/DOM API — callers map API rows
// (api.searchItemDTO) into `TableRow` and the cursor envelope
// (api.searchDocumentsResponse) into `Page` at the edge, keeping these
// primitives testable without mounting and reusable across surfaces.

// The cell/column value type union VirtualTable keys its typed cell rendering
// off: `string` rendered as-is, `boolean` as a checkmark/cross icon,
// `int64`/`double` right-aligned and locale-formatted, `date` formatted
// locale-aware (frontend.md § VirtualTable). Mirrors api.fieldDefinitionDTO's
// data_type — the closed set of data types a document field can carry.
export type FieldDataType = 'string' | 'boolean' | 'int64' | 'double' | 'date'

// One selectable/toggleable column in a table. `key` is the stable identifier
// ColumnPicker toggles by and TableRow.cells is keyed on (matches the document
// field_name); `label` is the already-localized header text. `dataType` is the
// cell type VirtualTable renders/formats by; it is optional because ColumnPicker
// only needs `key`/`label` (frontend.md § ColumnPicker), while VirtualTable
// supplies it to drive typed cell rendering. `sortable` gates the header's
// sort affordance.
export interface ColumnDef {
  key: string
  label: string
  dataType?: FieldDataType
  sortable?: boolean
  // Whether this column is part of the page's default visible set (frontend.md
  // § DocumentList: "DocumentList defines a default visible set per instance").
  // ColumnPicker/columnVisibility.ts fall back to this when persistKey is unset
  // or nothing valid is persisted yet.
  defaultVisible?: boolean
  // Renders the cell value inside a pill badge rather than as plain text
  // (frontend.md § Recent Documents / § By-Type Document List: "doc id
  // (pill; click → Document Viewer)"). Purely presentational — VirtualTable's
  // row click already navigates to the Document Viewer regardless of column.
  pill?: boolean
  // Renders the cell as a human-readable file size (`54 KB`, `1 MB`, via
  // `formatByteSize`) instead of `formatCellValue`'s locale-grouped raw byte
  // count (Phase 146: the Files view's `size` column). Only meaningful on an
  // `int64` column.
  byteSize?: boolean
  // Renders the cell as a relative time (`3 hours ago`, `yesterday`, via
  // `formatRelativeDate`) instead of `formatCellValue`'s absolute
  // `Intl.DateTimeFormat` rendering (Phase 146: the Files view's `mtime`
  // column). Only meaningful on a `date` column.
  relativeDate?: boolean
  // Whether sorting by this column keeps a working keyset cursor beyond the
  // first page. `created_at` is the only column that does today — api.md §
  // Sort parameter (M32.1): an extracted-field sort implicitly caps the
  // response to its first page (`next_cursor` always `null`), and M33.3's
  // built-in-column sort (`status`/`reviewed`/`doc_type`) hasn't landed yet
  // either. Defaults to `false` (not cursor-paginated) when unset, so a
  // column has to opt in rather than silently be assumed safe to
  // infinite-scroll past page 1. VirtualTable uses this — not a hardcoded
  // field-name check — to decide when to show the M33.6 first-page-only
  // notice and stop scroll-prefetching.
  cursorPaginated?: boolean
}

// The active sort a DocumentList (M4.4) instance applies — one column, one
// direction (frontend.md § api.md "one sort expression per request"). Owned by
// DocumentList, passed down to VirtualTable purely for header-arrow rendering;
// VirtualTable emits `sortChange` on a sortable header click but never mutates
// this itself (frontend.md § VirtualTable: "Does not own ... sort state").
export interface SortState {
  column: string
  direction: 'asc' | 'desc'
}

// One table cell's raw, pre-format value. `null`/`undefined` render as an empty
// string (see formatCellValue). Strings, numbers, bigints, booleans, and
// date-strings arrive in their JS-native form; formatCellValue turns them into
// display text according to the owning column's `dataType`.
export type CellValue = string | number | bigint | boolean | null | undefined

// One row of table data, keyed by ColumnDef.key. Backend-agnostic: callers map
// an api.searchItemDTO (id + system fields + its extracted `fields` map) into
// this flat key→value shape before handing rows to VirtualTable. `id` is the
// stable row identity used for keying and row-click navigation to the document
// viewer.
export interface TableRow {
  id: string
  cells: Record<string, CellValue>
}

// Alias for call sites that read more naturally as `Row`.
export type Row = TableRow

// One page of rows plus the opaque cursor to fetch the next page, mirroring the
// API's cursor envelope (api.searchDocumentsResponse: items + next_cursor +
// limit). Field names match the wire envelope so the fetch adapter maps it with
// minimal reshaping. `next_cursor` is absent once the last page is reached —
// VirtualTable stops prefetching when it's absent.
export interface Page {
  items: TableRow[]
  next_cursor?: string
  limit?: number
}
