import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import FilesSidebar from './FilesSidebar.vue'
import type { BridgeSidebarTab } from '../services/ncFilesBridge'

// M177.3 (backlog/v1.md Phase 177): `M174.7` reached the shared Files sidebar
// STORE, but nothing rendered it — "no console error" is explicitly NOT an
// acceptance criterion for this milestone (that silence is what made M174.7
// look done). These assert POSITIVE evidence: a rendered sidebar element on a
// named file, and `momentum-nl` selectable as a tab, both on the real DOM.

// A tiny custom element standing in for the real `@nextcloud/files@4.0.0`
// Web Components tab contract (same shape `momentumAskAiSidebar.ts` defines
// for `momentum-nl`) — registered once, module-wide, like a real tab's own
// `onInit()` would be.
class FakeTabElement extends HTMLElement {
  node: unknown
}
if (!customElements.get('momentum-fake-tab')) {
  customElements.define('momentum-fake-tab', FakeTabElement)
}

const TABS: BridgeSidebarTab[] = [
  { id: 'sharing', displayName: 'Sharing', iconSvgInline: '<svg />', order: 1, tagName: 'momentum-fake-tab' },
  { id: 'momentum-nl', displayName: 'Ask AI', iconSvgInline: '<svg />', order: 2, tagName: 'momentum-fake-tab' },
]

let mounted: ReturnType<typeof mount> | undefined

afterEach(() => {
  mounted?.unmount()
  mounted = undefined
})

describe('FilesSidebar', () => {
  it('renders nothing when no node is open', () => {
    mounted = mount(FilesSidebar, { props: { node: undefined, tabs: [], activeTab: '' } })
    expect(mounted.find('[data-testid="files-sidebar"]').exists()).toBe(false)
  })

  it('renders a sidebar element named after the open file, with momentum-nl selectable as a tab', async () => {
    mounted = mount(FilesSidebar, {
      props: {
        node: { basename: 'invoice.pdf', raw: { fileid: 42 } },
        tabs: TABS,
        activeTab: 'momentum-nl',
      },
      attachTo: document.body,
    })
    // The two child `NcAppSidebarTab`s register themselves with the parent's
    // tab list from their own `mounted()` hook — one Vue tick after the
    // sidebar itself first renders.
    await flushPromises()

    const sidebar = mounted.find('[data-testid="files-sidebar"]')
    expect(sidebar.exists()).toBe(true)
    expect(sidebar.text()).toContain('invoice.pdf')

    // The real `NcAppSidebarTabs` renders one `role="tab"` button per tab,
    // `id="tab-button-<tab.id>"` — this is what "selectable" means on the DOM.
    const tabButton = mounted.find('#tab-button-momentum-nl')
    expect(tabButton.exists()).toBe(true)
    expect(tabButton.attributes('role')).toBe('tab')
  })

  it('mounts the active tab as its own custom element, with the open node set on it', async () => {
    mounted = mount(FilesSidebar, {
      props: {
        node: { basename: 'invoice.pdf', raw: { fileid: 42 } },
        tabs: TABS,
        activeTab: 'momentum-nl',
      },
      attachTo: document.body,
    })
    await flushPromises()

    const el = mounted.element.querySelector('momentum-fake-tab') as FakeTabElement | null
    expect(el).not.toBeNull()
    expect((el as FakeTabElement).node).toEqual({ fileid: 42 })
  })

  it('emits close when the sidebar close button is used', async () => {
    mounted = mount(FilesSidebar, {
      props: {
        node: { basename: 'invoice.pdf', raw: {} },
        tabs: TABS,
        activeTab: 'momentum-nl',
      },
      attachTo: document.body,
    })
    await flushPromises()

    await mounted.find('[data-testid="files-sidebar"] button[aria-label="Close sidebar"]').trigger('click')

    expect(mounted.emitted('close')).toBeTruthy()
  })
})
