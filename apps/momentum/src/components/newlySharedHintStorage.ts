// Dismiss-state persistence for NewlySharedHint (frontend.md § Newly-shared
// items: eventual-consistency affordance). A standalone helper — same
// separation columnVisibility.ts uses for ColumnPicker — so the component
// stays a thin render of this state rather than owning localStorage access
// itself.
import { MOMENTUM_CONFIG } from '../config'

// Reads whether the user has already dismissed the hint. Storage errors
// (private mode, disabled storage) are treated as "not dismissed" — the hint
// reappearing is harmless, unlike a correctness dependency on storage.
export function isNewlySharedHintDismissed(): boolean {
  try {
    return window.localStorage.getItem(MOMENTUM_CONFIG.NEWLY_SHARED_HINT_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

// Persists the dismissal. Swallows storage errors — dismissing is a
// convenience, never a correctness requirement, so a failed write must not
// throw back into the caller's click handler.
export function dismissNewlySharedHint(): void {
  try {
    window.localStorage.setItem(MOMENTUM_CONFIG.NEWLY_SHARED_HINT_STORAGE_KEY, '1')
  } catch {
    // Ignore — the hint simply reappears next reload.
  }
}
