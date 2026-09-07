import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FileListFilters from './FileListFilters.vue'
import type { BridgeFilter, BridgeFilterChip } from '../services/ncFilesBridge'

// frontend.md § Files-app parity — this component renders one popover per
// filter (the Files app's own arrangement, read from its shipped source) and
// mounts CORE's filter web component inside it, handing over the filter
// instance. What it must never do is reimplement their UI, so these tests cover
// the mounting contract and the event wiring, not any filter's behaviour.
//
// NcPopover is stubbed to render trigger and content: whether a popover opens
// on click is @nextcloud/vue's behaviour, and the live check (M124.4) exercises
// the real one in a browser. The elements are mounted eagerly (the real
// NcPopover renders its content immediately and emits no event we could hook),
// so no "open" step is needed here.
const POPOVER_STUB = {
  NcPopover: {
    inheritAttrs: false,
    template: '<div class="stub-popover"><slot name="trigger" /><slot /></div>',
  },
}

// The component mounts the elements on its own `mounted` hook, so a test only
// has to let the tick after mount run.
async function settle(wrapper: ReturnType<typeof mount>): Promise<void> {
  await wrapper.vm.$nextTick()
  await wrapper.vm.$nextTick()
}

function fakeFilter(overrides: Partial<BridgeFilter> & { id: string }): BridgeFilter & {
  emitFilter: () => void
  emitChips: (chips: BridgeFilterChip[]) => void
} {
  let onFilter: (() => void) | undefined
  let onChips: (() => void) | undefined
  let chips: BridgeFilterChip[] = []
  return {
    order: 0,
    apply: (nodes) => nodes,
    chips: () => chips,
    subscribe: (filterChanged, chipsChanged) => {
      onFilter = filterChanged
      onChips = chipsChanged
      return () => {
        onFilter = undefined
        onChips = undefined
      }
    },
    attachTo: () => {},
    ...overrides,
    emitFilter: () => onFilter?.(),
    emitChips: (next) => {
      chips = next
      onChips?.()
    },
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('FileListFilters', () => {
  it('mounts each filter\'s own web component and hands it the filter instance', async () => {
    // The contract IFileListFilterWithUi documents: `el.filter = filter`.
    customElements.define(
      'test-type-filter',
      class extends HTMLElement {
        filter?: unknown
      },
    )
    const attachTo = vi.fn()
    const filter = fakeFilter({ id: 'files:type', displayName: 'Type', tagName: 'test-type-filter', attachTo })

    const wrapper = mount(FileListFilters, {
      props: { filters: [filter] },
      global: { stubs: POPOVER_STUB },
      attachTo: document.body,
    })
    await settle(wrapper)

    const host = wrapper.find('[data-filter-id="files:type"]')
    expect(host.element.children).toHaveLength(1)
    expect(host.element.children[0].tagName.toLowerCase()).toBe('test-type-filter')
    expect(attachTo).toHaveBeenCalledWith(host.element.children[0])
  })


  it('renders one trigger per filter with UI, labelled by the filter itself', () => {
    const wrapper = mount(FileListFilters, {
      props: {
        filters: [
          fakeFilter({ id: 'files:type', displayName: 'Type', tagName: 'test-type-filter' }),
          fakeFilter({ id: 'files:modified', displayName: 'Modified', tagName: 'test-modified-filter' }),
          fakeFilter({ id: 'files:hidden' }),
        ],
      },
      global: { stubs: POPOVER_STUB },
      attachTo: document.body,
    })

    expect(wrapper.find('[data-testid="file-list-filter-files:type"]').text()).toContain('Type')
    expect(wrapper.find('[data-testid="file-list-filter-files:modified"]').text()).toContain('Modified')
    // No trigger for the UI-less one.
    expect(wrapper.find('[data-testid="file-list-filter-files:hidden"]').exists()).toBe(false)
  })

  it('mounts a filter element only once, even when the filter set is re-set', async () => {
    customElements.define('test-once-filter', class extends HTMLElement {})
    const filter = fakeFilter({ id: 'files:type', tagName: 'test-once-filter' })
    const wrapper = mount(FileListFilters, {
      props: { filters: [filter] },
      global: { stubs: POPOVER_STUB },
      attachTo: document.body,
    })
    await settle(wrapper)

    // The page re-reads `bridge.filters()` on every listing, so the same filter
    // arrives again; a second element would mean two live UIs on one filter.
    await wrapper.setProps({ filters: [filter] })
    await settle(wrapper)

    expect(wrapper.find('[data-filter-id="files:type"]').element.children).toHaveLength(1)
  })

  it('renders nothing for a filter without UI, which is still part of the chain', () => {
    // `files:hidden` and `files:filename` have no UI by design — the PAGE
    // still applies them, and rendering an empty host for them would leave
    // stray gaps in the toolbar.
    const wrapper = mount(FileListFilters, {
      props: { filters: [fakeFilter({ id: 'files:hidden' })] },
      global: { stubs: POPOVER_STUB },
      attachTo: document.body,
    })

    expect(wrapper.findAll('[data-filter-id]')).toHaveLength(0)
  })

  it('skips a filter whose element was never defined instead of rendering an unknown tag', async () => {
    // An app can register a filter whose defining bundle failed to load; an
    // unknown tag renders as a silent empty inline element.
    const wrapper = mount(FileListFilters, {
      props: { filters: [fakeFilter({ id: 'files:ghost', tagName: 'never-defined-filter' })] },
      global: { stubs: POPOVER_STUB },
      attachTo: document.body,
    })
    await settle(wrapper)

    expect(wrapper.find('[data-filter-id="files:ghost"]').element.children).toHaveLength(0)
  })

  it('asks the page to re-apply when a filter changes, and re-renders its chips', async () => {
    const filter = fakeFilter({ id: 'files:type', tagName: 'test-type-filter' })
    const wrapper = mount(FileListFilters, {
      props: { filters: [filter] },
      global: { stubs: POPOVER_STUB },
      attachTo: document.body,
    })

    filter.emitFilter()
    expect(wrapper.emitted('filterChanged')).toHaveLength(1)

    filter.emitChips([{ text: 'PDF', onclick: () => {} }])
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('[data-testid="file-list-filter-chip"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('PDF')
  })

  it('unsubscribes on unmount, so a later filter change does not reach a dead page', () => {
    const filter = fakeFilter({ id: 'files:type', tagName: 'test-type-filter' })
    const wrapper = mount(FileListFilters, {
      props: { filters: [filter] },
      global: { stubs: POPOVER_STUB },
      attachTo: document.body,
    })

    wrapper.unmount()
    filter.emitFilter()

    expect(wrapper.emitted('filterChanged')).toBeUndefined()
  })
})
