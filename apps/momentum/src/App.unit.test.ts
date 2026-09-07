import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import * as documentsService from './services/documents'

// frontend.md § Integration Model — the app shell hosts the NcAppNavigation
// sidebar (§ Navigation Tree Additions) alongside the router outlet, not just
// a bare <router-view/>.

vi.mock('./services/documents')
// The nav reads Nextcloud's file registry through the runtime bridge; mocked
// with a factory so importing it does not pull `@nextcloud/files` in here.
vi.mock('./services/ncFilesBridgeRuntime', () => ({
  ncFilesBridge: () => ({ navTree: () => [], onViewsChanged: () => () => {} }),
  setNcFilesBridgeForTesting: vi.fn(),
}))

describe('App', () => {
  // `NcContent` teleports its "skip to content/navigation" links to a
  // `#skip-actions` element that real Nextcloud page templates always
  // provide; without it here, `Teleport`'s target resolves to nothing and a
  // later reactive update (e.g. `isMobile` toggling `NcIconSvgWrapper`'s
  // `v-show`) tries to patch a node that was never actually mounted,
  // throwing "Cannot set properties of null (setting '__vnode')" as an
  // unhandled rejection once the test's own assertions have already passed.
  beforeEach(() => {
    document.body.innerHTML = '<div id="skip-actions"></div>'
  })

  it('renders the app navigation alongside the routed page', async () => {
    vi.mocked(documentsService.fetchDocumentTypes).mockResolvedValue([])

    const router: Router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'documents', component: { template: '<div data-testid="page" />' } },
        { path: '/ai-filing', name: 'ai-filing', component: { template: '<div />' } },
        { path: '/type/:typeName', name: 'by-type-document-list', component: { template: '<div />' } },
        { path: '/recent', name: 'recent-documents', component: { template: '<div />' } },
        { path: '/chat', name: 'nl-query', component: { template: '<div />' } },
        { path: '/browse/:viewId', name: 'file-browser', component: { template: '<div />' } },
      ],
    })
    router.push('/')
    await router.isReady()
    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()

    // The nav is present (its own entries are covered by AppNavigation's
    // tests) alongside the routed page — that pairing is what this shell test
    // is about.
    expect(wrapper.find('[data-testid="nav-documents"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="page"]').exists()).toBe(true)
  })
})
