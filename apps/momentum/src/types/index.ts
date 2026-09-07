// Shared frontend types for the DocumentList family of components
// (frontend.md § Reusable Components). Request/response shapes that mirror the
// Go API come from the generated `schema.d.ts` (M4.1); the types here are the
// UI-side view models the toolbar/table components pass between each other.
//
// The VirtualTable data-plane contract — `FieldDataType`, `ColumnDef`, the
// row/cell shapes, and the `Page` cursor envelope — lives in `./table` (M4.2)
// and is re-exported here so existing importers keep using `../types` as the
// single entry point.
import type { FieldDataType } from './table'

export * from './table'

// One field the FilterPicker can build a constraint against. Built-in system
// fields (`status`, `reviewed`, `direction`) and type-specific extracted
// fields alike arrive through the same shape — the distinction is the caller's
// concern, not FilterPicker's (frontend.md § FilterPicker). Mirrors
// api.fieldDefinitionDTO's filter-relevant subset.
export interface FilterableField {
  field_name: string
  display_name: string
  data_type: FieldDataType
  operators: string[]
  // Optional chosen-from list for the value step (M125.1, frontend.md §
  // FilterPicker). When present, FilterPicker renders a select of exactly these
  // options instead of a text input — the treatment `status` already had from
  // its five hardcoded values, made data-driven so a caller can offer a list
  // (document type, from GET /document-types) without FilterPicker learning
  // that field's name. Fields without it are unchanged.
  values?: Array<{ value: string; label: string }>
}

// A single composed filter constraint emitted by FilterPicker's `filterAdd`.
export interface FilterValue {
  field_name: string
  operator: string
  value: string | boolean
}

// The five known document pipeline statuses (see the Document glossary entry
// in CLAUDE.md). FilterPicker renders a select of exactly these when the
// chosen field is `status` (frontend.md § FilterPicker step 3).
export const DOCUMENT_STATUS_VALUES = [
  'pending',
  'processing',
  'done',
  'needs_ocr',
  'failed',
] as const

export type DocumentStatus = (typeof DOCUMENT_STATUS_VALUES)[number]

// Field names FilterPicker special-cases for their value widget, per
// frontend.md § FilterPicker step 3.
export const FIELD_NAME_STATUS = 'status'
export const FIELD_NAME_REVIEWED = 'reviewed'
export const FIELD_NAME_DIRECTION = 'direction'

// One constraint DocumentList (M4.4) holds in its active filter set — either a
// FilterPicker-composed field constraint or a TypeaheadSearch-committed search
// term (frontend.md § DocumentList toolbar item 2 / § FilterPill render
// formats). Both render as a FilterPill and both are handed to the page's
// `fetchPage` so it can map them onto the actual `f=`/query params it needs;
// DocumentList itself is agnostic to how a search term maps to a request.
export type ActiveFilter =
  | ({ kind: 'field' } & FilterValue)
  | { kind: 'search'; term: string }
