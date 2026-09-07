import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcButton from '@nextcloud/vue/components/NcButton'
import { MOMENTUM_CONFIG } from '../config'
import NewlySharedHint from './NewlySharedHint.vue'

// Component tests for NewlySharedHint (frontend.md § Newly-shared items:
// eventual-consistency affordance — "show a subtle, dismissible hint ...
// rather than implying the list is complete"). Reused, unmodified, across
// the Recent / By-Type / search-results surfaces once those pages exist —
// this component owns only the hint text and its own dismiss state.
describe('NewlySharedHint', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('renders the eventual-consistency hint text via NcNoteCard', () => {
    const w = mount(NewlySharedHint)
    const card = w.findComponent(NcNoteCard)
    expect(card.exists()).toBe(true)
    expect(card.props('type')).toBe('info')
    expect(w.text()).toContain('Recently shared items may take a moment to appear.')
  })

  it('hides itself and persists the dismissal when the close button is clicked', async () => {
    const w = mount(NewlySharedHint)
    await w.findComponent(NcButton).trigger('click')
    expect(w.findComponent(NcNoteCard).exists()).toBe(false)
    expect(window.localStorage.getItem(MOMENTUM_CONFIG.NEWLY_SHARED_HINT_STORAGE_KEY)).toBe('1')
  })

  it('does not render at all if already dismissed in a prior session', () => {
    window.localStorage.setItem(MOMENTUM_CONFIG.NEWLY_SHARED_HINT_STORAGE_KEY, '1')
    const w = mount(NewlySharedHint)
    expect(w.findComponent(NcNoteCard).exists()).toBe(false)
  })
})
