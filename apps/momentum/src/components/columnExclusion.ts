// Static column exclusion (frontend.md § ColumnPicker, "Static exclusion, not
// just default-off", Phase 50 / backlog/v1.md). A small, global, statically-
// configured set of column keys that must never reach ColumnPicker's
// `columns` prop — excluded at the point each page builds its `ColumnDef[]`
// list, before it's ever passed down to `DocumentList`/`ColumnPicker`. Unlike
// `defaultVisible: false`, an excluded column can't be brought back via the
// picker, the `cols=` URL param, or any other client-side path, because the
// data was never labeled as a pickable column to begin with.
//
// `doc_id` (documents.id/public_id) is the motivating case — it carries no
// information a user needs to see, since row click already navigates to the
// Document Viewer — but the mechanism itself is general, for any future
// column that must never be a table option.
import type { ColumnDef } from '../types'

export const EXCLUDED_COLUMN_KEYS: ReadonlySet<string> = new Set(['doc_id'])

export function excludeStaticColumns(columns: ColumnDef[]): ColumnDef[] {
  return columns.filter((column) => !EXCLUDED_COLUMN_KEYS.has(column.key))
}
