import { beforeEach, describe, expect, it } from 'vitest'
import {
  columnStorageKey,
  loadColumnVisibility,
  saveColumnVisibility,
} from './columnVisibility'
import { MOMENTUM_CONFIG } from '../config'

// Persistence mechanism DocumentList (M4.4) wires via `persistKey`
// (frontend.md § DocumentList — COLUMN_PICKER_STORAGE_PREFIX + persistKey).

describe('columnVisibility', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  const known = ['name', 'status', 'reviewed', 'total']
  const defaults = ['name', 'status']

  it('builds the storage key from the config prefix and persistKey', () => {
    expect(columnStorageKey('recent')).toBe(
      MOMENTUM_CONFIG.COLUMN_PICKER_STORAGE_PREFIX + 'recent',
    )
  })

  it('round-trips a saved visible set', () => {
    saveColumnVisibility('recent', ['name', 'total'])
    expect(loadColumnVisibility('recent', defaults, known)).toEqual(['name', 'total'])
  })

  it('persists under COLUMN_PICKER_STORAGE_PREFIX + persistKey', () => {
    saveColumnVisibility('invoice', ['status'])
    expect(
      window.localStorage.getItem(MOMENTUM_CONFIG.COLUMN_PICKER_STORAGE_PREFIX + 'invoice'),
    ).toBe(JSON.stringify(['status']))
  })

  it('returns the supplied defaults when nothing is stored', () => {
    expect(loadColumnVisibility('recent', defaults, known)).toBe(defaults)
  })

  it('drops persisted keys for columns that no longer exist', () => {
    saveColumnVisibility('recent', ['name', 'gone', 'total'])
    expect(loadColumnVisibility('recent', defaults, known)).toEqual(['name', 'total'])
  })

  it('falls back to defaults when the persisted set no longer intersects any known column', () => {
    saveColumnVisibility('recent', ['gone', 'also-gone'])
    expect(loadColumnVisibility('recent', defaults, known)).toBe(defaults)
  })

  it('falls back to defaults on malformed JSON', () => {
    window.localStorage.setItem(columnStorageKey('recent'), '{not json')
    expect(loadColumnVisibility('recent', defaults, known)).toBe(defaults)
  })

  it('falls back to defaults on a non-array payload', () => {
    window.localStorage.setItem(columnStorageKey('recent'), JSON.stringify({ a: 1 }))
    expect(loadColumnVisibility('recent', defaults, known)).toBe(defaults)
  })

  it('ignores non-string entries within the stored array', () => {
    window.localStorage.setItem(
      columnStorageKey('recent'),
      JSON.stringify(['name', 42, null, 'total']),
    )
    expect(loadColumnVisibility('recent', defaults, known)).toEqual(['name', 'total'])
  })
})
