import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'
import AiFilingDashboardPage from './AiFilingDashboardPage.vue'
import ByTypeDocumentListPage from './ByTypeDocumentListPage.vue'
import * as documentsService from '../services/documents'

// frontend.md § AI Filing (M4.6). GET /stats/overview's per-type breakdown
// only lists types that already have at least one document (backend/internal
// /documents/stats.go groups by doc_type on existing rows) — the dashboard
// merges it with the full GET /document-types registry so a type with zero
// documents still renders as a zero-count row (frontend.md § AI Filing
// "Empty state").

vi.mock('../services/documents')

async function mountPage(): Promise<ReturnType<typeof mount>> {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'ai-filing', component: AiFilingDashboardPage },
      { path: '/type/:typeName', name: 'by-type-document-list', component: ByTypeDocumentListPage },
    ],
  })
  router.push('/')
  await router.isReady()
  const wrapper = mount(AiFilingDashboardPage, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('AiFilingDashboardPage', () => {
  it('shows a loading indicator while stats/overview and document-types are in flight', async () => {
    let resolveTypes!: (value: documentsService.DocumentTypeDTO[]) => void
    vi.mocked(documentsService.fetchDocumentTypes).mockReturnValue(
      new Promise((resolve) => {
        resolveTypes = resolve
      }),
    )
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue({ types: [], total: 0, unreviewed: 0 })

    const router: Router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', name: 'ai-filing', component: AiFilingDashboardPage }],
    })
    router.push('/')
    await router.isReady()
    const wrapper = mount(AiFilingDashboardPage, { global: { plugins: [router] } })

    expect(wrapper.find('[data-testid="loading"]').exists()).toBe(true)

    resolveTypes([])
    await flushPromises()
    expect(wrapper.find('[data-testid="loading"]').exists()).toBe(false)
  })

  it('renders one row per registered type with its total and unreviewed counts', async () => {
    vi.mocked(documentsService.fetchDocumentTypes).mockResolvedValue([
      { type_name: 'invoice', display_name: 'Invoice' },
      { type_name: 'purchase_order', display_name: 'Purchase Order' },
    ])
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue({
      types: [{ type_name: 'invoice', display_name: 'Invoice', total: 1247, unreviewed: 89 }],
      total: 1247,
      unreviewed: 89,
    })

    const wrapper = await mountPage()

    const rows = wrapper.findAll('[data-testid="type-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('Invoice')
    expect(rows[0].text()).toContain('1247')
    expect(rows[0].text()).toContain('89')
  })

  it('shows a zero-count row for a registered type with no documents yet', async () => {
    vi.mocked(documentsService.fetchDocumentTypes).mockResolvedValue([
      { type_name: 'invoice', display_name: 'Invoice' },
      { type_name: 'contract', display_name: 'Contract' },
    ])
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue({
      types: [{ type_name: 'invoice', display_name: 'Invoice', total: 5, unreviewed: 1 }],
      total: 5,
      unreviewed: 1,
    })

    const wrapper = await mountPage()

    const contractRow = wrapper
      .findAll('[data-testid="type-row"]')
      .find((row) => row.text().includes('Contract'))
    expect(contractRow?.find('[data-testid="total-cell"]').text()).toBe('0')
    expect(contractRow?.find('[data-testid="unreviewed-cell"]').text()).toBe('0')
  })

  it('visually emphasises the unreviewed count when it is greater than zero', async () => {
    vi.mocked(documentsService.fetchDocumentTypes).mockResolvedValue([
      { type_name: 'invoice', display_name: 'Invoice' },
      { type_name: 'contract', display_name: 'Contract' },
    ])
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue({
      types: [{ type_name: 'invoice', display_name: 'Invoice', total: 5, unreviewed: 2 }],
      total: 5,
      unreviewed: 2,
    })

    const wrapper = await mountPage()

    const invoiceRow = wrapper
      .findAll('[data-testid="type-row"]')
      .find((row) => row.text().includes('Invoice'))
    const contractRow = wrapper
      .findAll('[data-testid="type-row"]')
      .find((row) => row.text().includes('Contract'))
    expect(invoiceRow?.find('[data-testid="unreviewed-cell"]').classes()).toContain(
      'momentum-ai-filing__unreviewed--flagged',
    )
    expect(contractRow?.find('[data-testid="unreviewed-cell"]').classes()).not.toContain(
      'momentum-ai-filing__unreviewed--flagged',
    )
  })

  it('navigates to the By-Type List when a row is clicked', async () => {
    vi.mocked(documentsService.fetchDocumentTypes).mockResolvedValue([
      { type_name: 'invoice', display_name: 'Invoice' },
    ])
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue({
      types: [{ type_name: 'invoice', display_name: 'Invoice', total: 5, unreviewed: 2 }],
      total: 5,
      unreviewed: 2,
    })

    const wrapper = await mountPage()
    await wrapper.find('[data-testid="type-row"]').trigger('click')
    await flushPromises()

    const router = wrapper.vm.$.appContext.config.globalProperties.$router
    expect(router.currentRoute.value.fullPath).toBe('/type/invoice')
  })

  it('navigates to the By-Type List pre-filtered to unreviewed when the unreviewed cell is clicked', async () => {
    vi.mocked(documentsService.fetchDocumentTypes).mockResolvedValue([
      { type_name: 'invoice', display_name: 'Invoice' },
    ])
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue({
      types: [{ type_name: 'invoice', display_name: 'Invoice', total: 5, unreviewed: 2 }],
      total: 5,
      unreviewed: 2,
    })

    const wrapper = await mountPage()
    await wrapper.find('[data-testid="unreviewed-cell"]').trigger('click')
    await flushPromises()

    const router = wrapper.vm.$.appContext.config.globalProperties.$router
    expect(router.currentRoute.value.fullPath).toBe('/type/invoice?f=reviewed:eq:false')
  })

  it('shows an upload prompt when the tenant has no documents at all', async () => {
    vi.mocked(documentsService.fetchDocumentTypes).mockResolvedValue([
      { type_name: 'invoice', display_name: 'Invoice' },
    ])
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue({ types: [], total: 0, unreviewed: 0 })

    const wrapper = await mountPage()

    expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="type-row"]').exists()).toBe(false)
  })

  // M36.9 — most_recent_document (M32.4) has been in GET /stats/overview since
  // Phase 32 but was never rendered; this closes that pre-existing gap.
  it('renders most_recent_document labelled by the document\'s own date', async () => {
    vi.mocked(documentsService.fetchDocumentTypes).mockResolvedValue([
      { type_name: 'invoice', display_name: 'Invoice' },
    ])
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue({
      types: [{ type_name: 'invoice', display_name: 'Invoice', total: 5, unreviewed: 2 }],
      total: 5,
      unreviewed: 2,
      most_recent_document: {
        public_id: '42424242-4242-4242-4242-424242424242',
        path: '/Invoices/2026/acme-q1.pdf',
        doc_type: 'commercial_invoice',
        date: '2026-07-20',
      },
    })

    const wrapper = await mountPage()

    const mostRecent = wrapper.find('[data-testid="most-recent-document"]')
    expect(mostRecent.exists()).toBe(true)
    expect(mostRecent.text()).toContain('/Invoices/2026/acme-q1.pdf')
    expect(mostRecent.text()).toContain('2026-07-20')
    expect(mostRecent.text().toLowerCase()).toContain('document')
  })

  it('does not render most_recent_document when GET /stats/overview has no resolvable date', async () => {
    vi.mocked(documentsService.fetchDocumentTypes).mockResolvedValue([
      { type_name: 'invoice', display_name: 'Invoice' },
    ])
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue({
      types: [{ type_name: 'invoice', display_name: 'Invoice', total: 5, unreviewed: 2 }],
      total: 5,
      unreviewed: 2,
    })

    const wrapper = await mountPage()

    expect(wrapper.find('[data-testid="most-recent-document"]').exists()).toBe(false)
  })

  it('navigates to the Document Viewer when most_recent_document is clicked', async () => {
    vi.mocked(documentsService.fetchDocumentTypes).mockResolvedValue([
      { type_name: 'invoice', display_name: 'Invoice' },
    ])
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue({
      types: [{ type_name: 'invoice', display_name: 'Invoice', total: 5, unreviewed: 2 }],
      total: 5,
      unreviewed: 2,
      most_recent_document: {
        public_id: '42424242-4242-4242-4242-424242424242',
        path: '/Invoices/2026/acme-q1.pdf',
        doc_type: 'commercial_invoice',
        date: '2026-07-20',
      },
    })

    const router: Router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'ai-filing', component: AiFilingDashboardPage },
        { path: '/document/:docId', name: 'document-viewer', component: ByTypeDocumentListPage },
      ],
    })
    router.push('/')
    await router.isReady()
    const wrapper = mount(AiFilingDashboardPage, { global: { plugins: [router] } })
    await flushPromises()

    await wrapper.find('[data-testid="most-recent-document"] a').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/document/42424242-4242-4242-4242-424242424242')
  })

  // M36.8 — most_recently_updated (last pipeline write, api.md § GET
  // /stats/overview) has been in the response since Phase 36 but was never
  // rendered; this closes that gap alongside most_recent_document.
  it('renders most_recently_updated labelled distinctly from most_recent_document', async () => {
    vi.mocked(documentsService.fetchDocumentTypes).mockResolvedValue([
      { type_name: 'invoice', display_name: 'Invoice' },
    ])
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue({
      types: [{ type_name: 'invoice', display_name: 'Invoice', total: 5, unreviewed: 2 }],
      total: 5,
      unreviewed: 2,
      most_recently_updated: {
        public_id: '77777777-7777-7777-7777-777777777777',
        path: '/Invoices/2026/beta-q2.pdf',
        doc_type: 'commercial_invoice',
        updated_at: '2026-07-29T10:15:00Z',
      },
    })

    const wrapper = await mountPage()

    const mostRecentlyUpdated = wrapper.find('[data-testid="most-recently-updated"]')
    expect(mostRecentlyUpdated.exists()).toBe(true)
    expect(mostRecentlyUpdated.text()).toContain('/Invoices/2026/beta-q2.pdf')
    expect(mostRecentlyUpdated.text()).toContain('2026-07-29T10:15:00Z')
    expect(mostRecentlyUpdated.text().toLowerCase()).toContain('updated')
  })

  it('does not render most_recently_updated when GET /stats/overview omits it', async () => {
    vi.mocked(documentsService.fetchDocumentTypes).mockResolvedValue([
      { type_name: 'invoice', display_name: 'Invoice' },
    ])
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue({
      types: [{ type_name: 'invoice', display_name: 'Invoice', total: 5, unreviewed: 2 }],
      total: 5,
      unreviewed: 2,
    })

    const wrapper = await mountPage()

    expect(wrapper.find('[data-testid="most-recently-updated"]').exists()).toBe(false)
  })

  it('navigates to the Document Viewer when most_recently_updated is clicked', async () => {
    vi.mocked(documentsService.fetchDocumentTypes).mockResolvedValue([
      { type_name: 'invoice', display_name: 'Invoice' },
    ])
    vi.mocked(documentsService.fetchStatsOverview).mockResolvedValue({
      types: [{ type_name: 'invoice', display_name: 'Invoice', total: 5, unreviewed: 2 }],
      total: 5,
      unreviewed: 2,
      most_recently_updated: {
        public_id: '77777777-7777-7777-7777-777777777777',
        path: '/Invoices/2026/beta-q2.pdf',
        doc_type: 'commercial_invoice',
        updated_at: '2026-07-29T10:15:00Z',
      },
    })

    const router: Router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'ai-filing', component: AiFilingDashboardPage },
        { path: '/document/:docId', name: 'document-viewer', component: ByTypeDocumentListPage },
      ],
    })
    router.push('/')
    await router.isReady()
    const wrapper = mount(AiFilingDashboardPage, { global: { plugins: [router] } })
    await flushPromises()

    await wrapper.find('[data-testid="most-recently-updated"] a').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/document/77777777-7777-7777-7777-777777777777')
  })
})
