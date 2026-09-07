import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import AiStatusStrip from './AiStatusStrip.vue'

// Mounts a MediaQueryList stub for `window.matchMedia` so the component's
// reduced-motion detection (M164.1) can be driven deterministically —
// jsdom implements no `matchMedia` of its own.
function stubMatchMedia(matches: boolean) {
  const mql = {
    matches,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue(mql),
  )
  return mql
}

// Component tests for AiStatusStrip (frontend.md § Processing progress: the
// AI status strip). This milestone (M149.1) is the presentational half only
// — props in, markup out, no fetch/timer logic — so these tests assert only
// on rendered message/count text for a couple of {total, done} prop pairs.
describe('AiStatusStrip', () => {
  it('renders the plural message and count for total=5, done=0', () => {
    const w = mount(AiStatusStrip, { props: { total: 5, done: 0 } })
    expect(w.text()).toContain('Reading 5 documents…')
    expect(w.text()).toContain('0 of 5')
  })

  it('renders the singular message for total=1', () => {
    const w = mount(AiStatusStrip, { props: { total: 1, done: 0 } })
    expect(w.text()).toContain('Reading 1 document…')
    expect(w.text()).toContain('0 of 1')
  })

  it('renders the count reflecting progress', () => {
    const w = mount(AiStatusStrip, { props: { total: 5, done: 3 } })
    expect(w.text()).toContain('3 of 5')
  })
})

// M164.1: the three dots are the strip's only "still working" signal
// (aria-hidden, since the adjacent text already says the same thing), and
// they are the worst of Phase 164's three unguarded animations — infinite,
// and on screen for as long as the user is waiting. These mount the strip
// with real total/done props (never an idle/empty tenant) so the dots are
// actually rendered, not vacuously absent — the distinction the milestone
// exists to make.
describe('AiStatusStrip reduced-motion guard', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the dots pulsing when the user has no reduced-motion preference', () => {
    stubMatchMedia(false)
    const w = mount(AiStatusStrip, { props: { total: 5, done: 2 } })
    const dot = w.find('.momentum-ai-status-strip__dot').element as HTMLElement
    // Vue's scoped-style compiler suffixes keyframe names with a per-
    // component hash, so match the un-scoped name rather than an exact string.
    expect(getComputedStyle(dot).animationName).toContain('momentum-ai-status-strip-pulse')
  })

  it('freezes the dots to a static, still-visible equivalent under prefers-reduced-motion', async () => {
    stubMatchMedia(true)
    const w = mount(AiStatusStrip, { props: { total: 5, done: 2 } })
    await nextTick()
    const dot = w.find('.momentum-ai-status-strip__dot').element as HTMLElement
    const style = getComputedStyle(dot)
    expect(style.animationName).toBe('none')
    // Static equivalent, not a removal: the dot must still be visible.
    expect(style.opacity).toBe('1')
  })
})
