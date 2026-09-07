import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import NcChip from '@nextcloud/vue/components/NcChip'
import FilterPill from './FilterPill.vue'

// Component tests for FilterPill (frontend.md § FilterPill): a compact
// dismissible chip representing one active constraint. The component is
// deliberately dumb — the caller composes the human-readable `label`
// ("search: invoice", "Vendor eq ACME") and reacts to the dismiss; FilterPill
// only renders the text and surfaces the × click.

function mountPill(label = 'search: invoice') {
  return mount(FilterPill, { props: { label } })
}

describe('FilterPill', () => {
  it('renders the label text via NcChip', () => {
    const w = mountPill('Vendor eq ACME')
    // NcChip exposes its text through the `text` prop; the label flows through
    // verbatim so the caller owns the render format.
    expect(w.findComponent(NcChip).props('text')).toBe('Vendor eq ACME')
  })

  it('forwards a caller-supplied class to the single NcChip root', () => {
    // FilterPill is single-root (just NcChip), so Vue auto-merges class onto
    // the chip root — the multi-root forwarding pitfall does not apply here,
    // and this asserts it stays that way.
    const w = mount(FilterPill, { props: { label: 'x' }, attrs: { class: 'extra' } })
    expect(w.classes()).toContain('extra')
  })

  it('emits remove when the chip close (×) is triggered', async () => {
    const w = mountPill()
    w.findComponent(NcChip).vm.$emit('close')
    await w.vm.$nextTick()
    expect(w.emitted('remove')).toHaveLength(1)
    // The dismiss carries no payload — the parent knows which pill this is.
    expect(w.emitted('remove')?.[0]).toEqual([])
  })

  it('keeps the close button enabled (a pill is always dismissible)', () => {
    const w = mountPill()
    expect(w.findComponent(NcChip).props('noClose')).toBeFalsy()
  })
})
