// Column-visibility persistence for DocumentList (frontend.md § DocumentList,
// "When persistKey is set, ColumnPicker visibility state is persisted to
// localStorage under COLUMN_PICKER_STORAGE_PREFIX + persistKey").
//
// This is deliberately a standalone helper rather than a side effect inside
// ColumnPicker: frontend.md § ColumnPicker states persistence is
// `DocumentList`'s responsibility via `persistKey`, and ColumnPicker itself is
// a pure controlled component (props in, `change` out). DocumentList (M4.4)
// resolves the initial visible set with `loadColumnVisibility` — falling back
// to the default set it supplies (frontend.md line 541) — and writes the new
// set with `saveColumnVisibility` whenever ColumnPicker emits `change`.
import { MOMENTUM_CONFIG } from '../config'

// The full localStorage key for a given DocumentList instance's persistKey.
export function columnStorageKey(persistKey: string): string {
  return MOMENTUM_CONFIG.COLUMN_PICKER_STORAGE_PREFIX + persistKey
}

// Reads the persisted visible-column set, intersected with the columns that
// currently exist (`knownKeys`) so a stale persisted key for a column that no
// longer exists is dropped. Returns `defaults` when nothing valid is stored —
// a missing key, malformed JSON, a non-array payload, or a persisted set that
// no longer intersects any known column. `defaults` is the caller-supplied
// default visible set.
export function loadColumnVisibility(
  persistKey: string,
  defaults: string[],
  knownKeys: string[],
): string[] {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(columnStorageKey(persistKey))
  } catch {
    // localStorage can throw (private mode, disabled storage) — treat as absent.
    return defaults
  }
  if (raw === null) return defaults

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return defaults
  }
  if (!Array.isArray(parsed)) return defaults

  const known = new Set(knownKeys)
  const filtered = parsed.filter(
    (k): k is string => typeof k === 'string' && known.has(k),
  )
  return filtered.length > 0 ? filtered : defaults
}

// Persists the visible-column set. Swallows storage errors (quota, disabled
// storage) — persistence is a convenience, never a correctness requirement.
export function saveColumnVisibility(persistKey: string, selected: string[]): void {
  try {
    window.localStorage.setItem(columnStorageKey(persistKey), JSON.stringify(selected))
  } catch {
    // Ignore — the in-memory selection remains authoritative for this session.
  }
}
