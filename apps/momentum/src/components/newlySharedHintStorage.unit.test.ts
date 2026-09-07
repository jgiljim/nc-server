import { beforeEach, describe, expect, it } from 'vitest'
import { MOMENTUM_CONFIG } from '../config'
import { dismissNewlySharedHint, isNewlySharedHintDismissed } from './newlySharedHintStorage'

// Unit tests for the localStorage-backed dismiss state behind
// NewlySharedHint (frontend.md § Newly-shared items: eventual-consistency
// affordance). Once a user dismisses the hint it stays dismissed across page
// navigations/reloads — mirroring the persistence pattern columnVisibility.ts
// already establishes for ColumnPicker.
describe('newlySharedHint', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('is not dismissed before any dismiss call', () => {
    expect(isNewlySharedHintDismissed()).toBe(false)
  })

  it('is dismissed after dismissNewlySharedHint() is called', () => {
    dismissNewlySharedHint()
    expect(isNewlySharedHintDismissed()).toBe(true)
  })

  it('persists the dismissal under the configured storage key', () => {
    dismissNewlySharedHint()
    expect(window.localStorage.getItem(MOMENTUM_CONFIG.NEWLY_SHARED_HINT_STORAGE_KEY)).toBe('1')
  })

  it('treats a getItem/setItem throw (private mode, disabled storage) as not dismissed', () => {
    const original = window.localStorage.getItem
    window.localStorage.getItem = () => {
      throw new Error('storage disabled')
    }
    try {
      expect(isNewlySharedHintDismissed()).toBe(false)
    } finally {
      window.localStorage.getItem = original
    }
  })

  it('swallows a setItem throw so dismiss never breaks the caller', () => {
    const original = window.localStorage.setItem
    window.localStorage.setItem = () => {
      throw new Error('storage disabled')
    }
    try {
      expect(() => dismissNewlySharedHint()).not.toThrow()
    } finally {
      window.localStorage.setItem = original
    }
  })
})
