import { flushPromises, mount } from '@vue/test-utils'
import {
  createMemoryHistory,
  createRouter,
  createWebHistory,
  type Router,
  type RouteRecordRaw,
} from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import DocumentViewerPage from './DocumentViewerPage.vue'
import FieldEditor from '../components/FieldEditor.vue'
import * as documentsService from '../services/documents'
import { HttpError } from '../services/httpError'
import * as notifyPush from '@nextcloud/notify_push'
import { MOMENTUM_CONFIG } from '../config'
import { getPreviewHost, releasePreviewHost } from '../services/previewHost'
import { fetchViewerFileInfo } from '../services/viewerFileInfo'

vi.mock('../services/viewerFileInfo')

vi.mock('@nextcloud/notify_push', () => ({ listen: vi.fn() }))
vi.mock('@nextcloud/auth', () => ({ getCurrentUser: () => ({ uid: 'momentum-demo-user' }) }))
vi.mock('@nextcloud/router', () => ({
  generateRemoteUrl: (path: string) => `/remote.php/${path}`,
  // `services/documents` builds its API base from generateUrl at import time.
  generateUrl: (path: string) => `/index.php${path}`,
}))

// M68.4 (frontend.md § Type control) — every test in this file mounts a page
// whose header now includes the type dropdown, so its data source is mocked
// unconditionally here rather than per-describe.
beforeEach(() => {
  vi.mocked(documentsService.fetchDocumentTypes).mockResolvedValue([
    { type_name: 'invoice', display_name: 'invoice' },
    { type_name: 'contract', display_name: 'contract' },
  ] as never)
  vi.mocked(documentsService.patchDocument).mockResolvedValue(undefined as never)
})

function typeSelect(wrapper: ReturnType<typeof mount>) {
  return wrapper.findComponent(NcSelect)
}

// @nextcloud/vue's typed prop signatures don't expose `options`/`modelValue`/
// `disabled` as known keys to `.props(key)` (see FilterPicker.unit.test.ts's
// identical note), so read them off the untyped props bag.
function typeSelectProps(wrapper: ReturnType<typeof mount>): Record<string, unknown> {
  return typeSelect(wrapper).props() as Record<string, unknown>
}

// FieldEditor's own props ARE typed (unlike @nextcloud/vue's), so this reads
// them directly rather than through an untyped bag.
function fieldEditorProps(wrapper: ReturnType<typeof mount>) {
  return wrapper.findComponent(FieldEditor).props()
}

// frontend.md § Document Viewer & Field Editor — M4.9 built the page *shell*
// (the split-panel layout, the right-panel header/body/footer regions, and
// reading the routed doc id); M4.10 fills in the document-type badge and
// mounts FieldEditor, which owns the field body and action footer. M4.11
// adds the pending/processing spinner + DOCUMENT_POLL_INTERVAL_MS polling
// fallback (frontend.md § DOCUMENT_POLL_INTERVAL_MS). Reprocess / needs_ocr
// and failed states (M4.12) are still out of scope here.

vi.mock('../services/documents')

async function mountAtDoc(docId: string): Promise<ReturnType<typeof mount>> {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/document/:docId', name: 'document-viewer', component: DocumentViewerPage },
    ],
  })
  router.push(`/document/${docId}`)
  // resolve the pushed route before mounting so useRoute() sees the params
  await router.isReady()
  const wrapper = mount(DocumentViewerPage, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

// M139.1's top-bar Back button needs a router that also knows the
// `documents` route (goBack()'s fallback target) and, unlike mountAtDoc
// above, control over the navigation history BEFORE the page mounts — a
// history-empty deep link and "arrived via a list page" both start from a
// clean stack, and the difference is entirely in what got pushed first.
//
// This deliberately uses `createWebHistory`, not `createMemoryHistory`, even
// though every other test in this file uses the latter: goBack() reads
// `router.options.history.state.back`, and that field is only ever populated
// by vue-router's HTML5-history state-building (`useHistoryStateNavigation`,
// gated on `isBrowser`) — `createMemoryHistory`'s own `push`/`replace` just
// stores whatever `data` the caller passed (normally `{}`), so `state.back`
// stays `undefined` no matter how many entries were pushed. Production
// (`src/router/index.ts`) uses `createWebHistory`, so exercising the same
// history implementation here — jsdom supports real `window.history` — is
// what makes this test assert real behaviour instead of an artifact of the
// test double.
async function mountWithHistory(
  priorPaths: string[],
  docId: string,
): Promise<{ wrapper: ReturnType<typeof mount>; router: Router }> {
  window.history.replaceState(null, '', '/')
  const routes: RouteRecordRaw[] = [
    { path: '/', name: 'documents', component: { template: '<div data-testid="documents-page" />' } },
    {
      path: '/type/:typeName',
      name: 'by-type-document-list',
      component: { template: '<div data-testid="by-type-page" />' },
    },
    { path: '/document/:docId', name: 'document-viewer', component: DocumentViewerPage },
  ]
  const router: Router = createRouter({ history: createWebHistory('/'), routes })
  for (const path of priorPaths) {
    await router.push(path)
  }
  await router.push(`/document/${docId}`)
  await router.isReady()
  const wrapper = mount(DocumentViewerPage, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

describe('DocumentViewerPage', () => {
  let wrapper: ReturnType<typeof mount>

  beforeEach(async () => {
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      reviewed: false,
      fields: {},
    } as never)
    vi.mocked(documentsService.fetchDocumentTypeSchema).mockResolvedValue({
      type_name: 'invoice',
      display_name: 'Invoice',
      fields: [],
    } as never)

    wrapper = await mountAtDoc('doc-123')
  })

  it('renders a two-panel split: a left previewer panel and a right editor panel', () => {
    expect(wrapper.find('.momentum-document-viewer__preview').exists()).toBe(true)
    expect(wrapper.find('.momentum-document-viewer__editor').exists()).toBe(true)
  })

  it('exposes the routed doc id so later milestones can key their fetches off it', () => {
    expect(wrapper.find('.momentum-document-viewer__editor').attributes('data-doc-id')).toBe(
      'doc-123',
    )
  })

  it('gives the right panel a header showing the resolved type as a dropdown, a scrollable field body, and a sticky action footer', () => {
    const editor = wrapper.find('.momentum-document-viewer__editor')
    expect(typeSelectProps(wrapper).modelValue).toBe('invoice')
    expect(editor.find('.momentum-document-viewer__fields').exists()).toBe(true)
    expect(editor.find('.momentum-document-viewer__actions').exists()).toBe(true)
  })

  it('reflects whichever doc id the route carries', async () => {
    const other = await mountAtDoc('another-doc')

    expect(other.find('.momentum-document-viewer__editor').attributes('data-doc-id')).toBe(
      'another-doc',
    )
  })
})

describe('DocumentViewerPage type control (M68.4)', () => {
  beforeEach(() => {
    vi.mocked(documentsService.fetchDocumentTypeSchema).mockResolvedValue({
      type_name: 'invoice',
      display_name: 'Invoice',
      fields: [],
    } as never)
  })

  it('is populated from GET /document-types and shows the current type selected', async () => {
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      status: 'done',
      reviewed: false,
      fields: {},
    } as never)

    const wrapper = await mountAtDoc('doc-type-control')

    // M83.2 (frontend.md § Type control) — the correction control must ask for
    // the full global catalog, not the tenant-usage-scoped default, or the type
    // the user came here to pick is missing precisely when it is needed.
    expect(documentsService.fetchDocumentTypes).toHaveBeenCalledWith('all')
    expect(typeSelectProps(wrapper).modelValue).toBe('invoice')
    expect(typeSelectProps(wrapper).options).toEqual([
      { id: 'invoice', label: 'invoice' },
      { id: 'contract', label: 'contract' },
    ])
  })

  it('PATCHes doc_type on selection and re-fetches the document', async () => {
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      status: 'done',
      reviewed: false,
      fields: {},
    } as never)

    const wrapper = await mountAtDoc('doc-type-change')
    vi.mocked(documentsService.fetchDocument).mockClear()
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'contract',
      status: 'pending',
      reviewed: false,
      fields: {},
    } as never)

    typeSelect(wrapper).vm.$emit('update:modelValue', 'contract')
    await flushPromises()

    expect(documentsService.patchDocument).toHaveBeenCalledWith('doc-type-change', {
      doc_type: 'contract',
    })
    expect(documentsService.fetchDocument).toHaveBeenCalled()
    expect(typeSelectProps(wrapper).modelValue).toBe('contract')
    expect(wrapper.find('[data-testid="processing-spinner"]').exists()).toBe(true)
  })

  // M129.2 — on a real install the page briefly settled back to the OLD type
  // with the OLD field values right after the PATCH, which reads as "the
  // change was applied and then reverted". A 202 means the re-run is queued,
  // so that is what the page must show from the moment the PATCH returns,
  // whatever a re-read that races the write happens to say.
  it('shows the new type as in-flight straight after the PATCH, even if the re-read still says otherwise', async () => {
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      status: 'done',
      reviewed: false,
      fields: {},
    } as never)

    const wrapper = await mountAtDoc('doc-no-flash')
    const tokenBefore = fieldEditorProps(wrapper).refreshToken

    // The re-read races the write and still reports the pre-change state.
    typeSelect(wrapper).vm.$emit('update:modelValue', 'contract')
    await flushPromises()

    expect(typeSelectProps(wrapper).modelValue).toBe('contract')
    expect(fieldEditorProps(wrapper).docType).toBe('contract')
    expect(wrapper.find('[data-testid="processing-spinner"]').exists()).toBe(true)
    // and the panel is told to re-read, so it cannot keep showing the old
    // run's values as if they were the new type's.
    expect(fieldEditorProps(wrapper).refreshToken).not.toBe(tokenBefore)
  })

  it('disables the dropdown while status is pending/processing', async () => {
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      status: 'processing',
      reviewed: false,
      fields: {},
    } as never)

    const wrapper = await mountAtDoc('doc-type-processing')

    expect(typeSelectProps(wrapper).disabled).toBe(true)
    expect(wrapper.find('[data-testid="doc-type-hint"]').exists()).toBe(true)
  })

  it('disables the dropdown while the field panel has unsaved edits, with a hint', async () => {
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      status: 'done',
      reviewed: false,
      fields: { vendor_name: 'Acme' },
    } as never)
    vi.mocked(documentsService.fetchDocumentTypeSchema).mockResolvedValue({
      type_name: 'invoice',
      display_name: 'Invoice',
      fields: [{ field_name: 'vendor_name', display_name: 'Vendor', data_type: 'string', sort_order: 1 }],
    } as never)

    const wrapper = await mountAtDoc('doc-type-dirty')
    expect(typeSelectProps(wrapper).disabled).toBe(false)

    const vendorInput = wrapper.get('[data-field-name="vendor_name"] input')
    await vendorInput.setValue('Acme Corp')
    await flushPromises()

    expect(typeSelectProps(wrapper).disabled).toBe(true)
    expect(wrapper.find('[data-testid="doc-type-hint"]').text()).toContain(
      'Save or discard your changes',
    )

    await wrapper.get('[data-testid="discard-changes"]').trigger('click')
    await flushPromises()

    expect(typeSelectProps(wrapper).disabled).toBe(false)
  })
})

// M151.9 (api.md § doc_type_source and the "Undefined" classification
// outcome): a `done` document with `doc_type: null, doc_type_source: "none"`
// is a document classification explicitly found no registry type fits —
// distinct from the pending case, which shares the same null `doc_type`.
describe('DocumentViewerPage Undefined-type display (M151.9)', () => {
  it('shows an Undefined placeholder in the type control instead of hiding it, and hands docTypeSource to FieldEditor', async () => {
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: null,
      doc_type_source: 'none',
      status: 'done',
      reviewed: false,
    } as never)

    const wrapper = await mountAtDoc('doc-undefined-type')

    expect(typeSelectProps(wrapper).modelValue).toBe('')
    expect(typeSelectProps(wrapper).placeholder).toBe('Undefined')
    expect(fieldEditorProps(wrapper).docTypeSource).toBe('none')
    expect(wrapper.find('[data-testid="doc-type-hint"]').text()).toContain(
      'No document type matched this document',
    )
  })

  it('still hides the type control while a not-yet-classified (pending) document has the same null doc_type', async () => {
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: null,
      doc_type_source: 'ai',
      status: 'pending',
      reviewed: false,
    } as never)

    const wrapper = await mountAtDoc('doc-pending')

    expect(wrapper.find('[data-testid="doc-type-select"]').exists()).toBe(false)
    expect(fieldEditorProps(wrapper).docTypeSource).toBe('ai')
  })

  it('lets a user assign a real type from the Undefined placeholder, same as an ordinary correction', async () => {
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: null,
      doc_type_source: 'none',
      status: 'done',
      reviewed: false,
    } as never)
    vi.mocked(documentsService.fetchDocumentTypeSchema).mockResolvedValue({
      type_name: 'invoice',
      display_name: 'Invoice',
      fields: [],
    } as never)

    const wrapper = await mountAtDoc('doc-undefined-assign')

    typeSelect(wrapper).vm.$emit('update:modelValue', 'invoice')
    await flushPromises()

    expect(documentsService.patchDocument).toHaveBeenCalledWith('doc-undefined-assign', {
      doc_type: 'invoice',
    })
    expect(typeSelectProps(wrapper).modelValue).toBe('invoice')
    expect(typeSelectProps(wrapper).placeholder).toBeFalsy()
  })
})

describe('DocumentViewerPage preview pane', () => {
  const PREVIEW_MOUNT_SELECTOR = '#momentum-document-viewer-preview-mount'

  let ncViewer: {
    setRootElement: ReturnType<typeof vi.fn>
    open: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    mimetypes?: string[]
    availableHandlers?: Array<{
      id: string
      mimes?: string[]
      mimesAliases?: Record<string, string>
    }>
  }

  beforeEach(() => {
    vi.mocked(documentsService.fetchDocumentTypeSchema).mockResolvedValue({
      type_name: 'invoice',
      display_name: 'Invoice',
      fields: [],
    } as never)

    ncViewer = { setRootElement: vi.fn(), open: vi.fn(), close: vi.fn() }
    ;(window as unknown as { OCA?: unknown }).OCA = { Viewer: ncViewer }
  })

  afterEach(() => {
    delete (window as unknown as { OCA?: unknown }).OCA
    // `previewHost.ts` holds its host in a module-level `let` with no reset
    // export — the same element is shared by every test in this file. Detach
    // it and wipe any sentinel content so a leaked host from one test can't
    // make a later `toBe`/content assertion pass for the wrong reason.
    releasePreviewHost()
    getPreviewHost().replaceChildren()
  })

  it('mounts the host NC previewer into the preview container once the document path is loaded', async () => {
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      path: '/Invoices/acme-q1.pdf',
      reviewed: false,
      fields: {},
    } as never)

    const wrapper = await mountAtDoc('doc-preview')

    expect(wrapper.find(PREVIEW_MOUNT_SELECTOR).exists()).toBe(true)
    expect(ncViewer.setRootElement).toHaveBeenCalledWith(PREVIEW_MOUNT_SELECTOR)
    expect(ncViewer.open).toHaveBeenCalledWith({ path: '/Invoices/acme-q1.pdf' })
  })

  it('strips the API\'s /<uid>/files/ internal-storage prefix before handing the path to the previewer', async () => {
    // Confirmed live, 2026-07-28: GET /documents/{id} returns `path` as
    // Nextcloud's own Node::getPath() ("/<uid>/files/<relative>"), not a
    // path relative to the user's own home the way the viewer app expects.
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      path: '/momentum-demo-user/files/Invoices/acme-q1.pdf',
      reviewed: false,
      fields: {},
    } as never)

    await mountAtDoc('doc-preview-prefixed')

    expect(ncViewer.open).toHaveBeenCalledWith({ path: '/Invoices/acme-q1.pdf' })
  })

  it('does not mount the previewer before the document path is known', async () => {
    let resolveDoc!: (value: documentsService.DocumentDTO) => void
    vi.mocked(documentsService.fetchDocument).mockReturnValue(
      new Promise((resolve) => {
        resolveDoc = resolve
      }),
    )

    const router: Router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/document/:docId', name: 'document-viewer', component: DocumentViewerPage }],
    })
    router.push('/document/doc-loading')
    await router.isReady()
    const wrapper = mount(DocumentViewerPage, { global: { plugins: [router] } })

    expect(wrapper.find(PREVIEW_MOUNT_SELECTOR).exists()).toBe(false)
    expect(ncViewer.open).not.toHaveBeenCalled()

    resolveDoc({ public_id: 'doc-loading', doc_type: 'invoice', path: '/x.pdf', reviewed: false, fields: {} } as never)
    await flushPromises()

    expect(wrapper.find(PREVIEW_MOUNT_SELECTOR).exists()).toBe(true)
    expect(ncViewer.open).toHaveBeenCalledWith({ path: '/x.pdf' })
  })

  it('shows a fallback message when the host previewer is unavailable', async () => {
    delete (window as unknown as { OCA?: unknown }).OCA

    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      path: '/Invoices/acme-q1.pdf',
      reviewed: false,
      fields: {},
    } as never)

    const wrapper = await mountAtDoc('doc-preview-no-viewer')

    expect(wrapper.find(PREVIEW_MOUNT_SELECTOR).exists()).toBe(false)
    expect(wrapper.find('[data-testid="preview-unavailable"]').exists()).toBe(true)
    const downloadLink = wrapper.find('[data-testid="preview-download-link"]')
    expect(downloadLink.exists()).toBe(true)
    expect(downloadLink.attributes('href')).toBe(
      '/remote.php/dav/files/momentum-demo-user/Invoices/acme-q1.pdf',
    )
  })

  it('falls back to a message when mounting the previewer throws', async () => {
    ncViewer.setRootElement.mockImplementation(() => {
      throw new Error('Please set root element before calling Viewer.open().')
    })
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      path: '/Invoices/acme-q1.pdf',
      reviewed: false,
      fields: {},
    } as never)

    const wrapper = await mountAtDoc('doc-preview-error')

    expect(wrapper.find(PREVIEW_MOUNT_SELECTOR).exists()).toBe(false)
    expect(wrapper.find('[data-testid="preview-unavailable"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="preview-download-link"]').exists()).toBe(true)
  })

  it('falls back to a message instead of opening the viewer when the mime type has no registered handler', async () => {
    ncViewer.mimetypes = ['application/pdf', 'image/png']
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      path: '/Invoices/acme-q1.xlsx',
      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      reviewed: false,
      fields: {},
    } as never)

    const wrapper = await mountAtDoc('doc-preview-xlsx')

    expect(ncViewer.open).not.toHaveBeenCalled()
    expect(wrapper.find(PREVIEW_MOUNT_SELECTOR).exists()).toBe(false)
    expect(wrapper.find('[data-testid="preview-unavailable"]').exists()).toBe(true)
    const downloadLink = wrapper.find('[data-testid="preview-download-link"]')
    expect(downloadLink.exists()).toBe(true)
    expect(downloadLink.attributes('href')).toBe(
      '/remote.php/dav/files/momentum-demo-user/Invoices/acme-q1.xlsx',
    )
  })

  it('still opens the viewer for a mime type present in its registered handler list', async () => {
    ncViewer.mimetypes = ['application/pdf', 'image/png']
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      path: '/Invoices/acme-q1.pdf',
      mime_type: 'application/pdf',
      reviewed: false,
      fields: {},
    } as never)

    const wrapper = await mountAtDoc('doc-preview-pdf-mimetypes')

    expect(ncViewer.open).toHaveBeenCalledWith({ path: '/Invoices/acme-q1.pdf' })
    expect(wrapper.find(PREVIEW_MOUNT_SELECTOR).exists()).toBe(true)
  })

  it('still attempts to open the viewer when mimetypes is unavailable on the service', async () => {
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      path: '/Invoices/acme-q1.xlsx',
      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      reviewed: false,
      fields: {},
    } as never)

    await mountAtDoc('doc-preview-xlsx-no-mimetypes-list')

    expect(ncViewer.open).toHaveBeenCalledWith({ path: '/Invoices/acme-q1.xlsx' })
  })

  it('closes the previewer when navigating to a different document', async () => {
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      path: '/Invoices/acme-q1.pdf',
      reviewed: false,
      fields: {},
    } as never)

    const wrapper = await mountAtDoc('doc-preview-a')
    ncViewer.close.mockClear()

    const router = wrapper.vm.$router as Router
    await router.push('/document/doc-preview-b')
    await flushPromises()

    expect(ncViewer.close).toHaveBeenCalled()
  })

  it('closes the previewer when the component unmounts', async () => {
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      path: '/Invoices/acme-q1.pdf',
      reviewed: false,
      fields: {},
    } as never)

    const wrapper = await mountAtDoc('doc-preview-unmount')
    ncViewer.close.mockClear()
    wrapper.unmount()

    expect(ncViewer.close).toHaveBeenCalled()
  })

  // Regression guard for Phase 66/M66.1: the host `viewer` app mounts its own
  // Vue instance into the preview container exactly once and exposes no
  // re-mount API, so the property that matters is object identity and
  // instance survival across an unmount/remount cycle — not mere `.exists()`
  // of a (possibly freshly recreated, previewer-less) container. A sentinel
  // child node stands in for the previewer instance: it catches both a
  // different element (identity loss) and the same element emptied out
  // (contents loss), which `.exists()` cannot express at all.
  describe('previewer survival across navigation (Phase 66 regression guard)', () => {
    function markWithSentinel(host: Element, testId: string): void {
      const sentinel = document.createElement('span')
      sentinel.setAttribute('data-testid', testId)
      host.appendChild(sentinel)
    }

    it('keeps the same previewer host element, contents intact, across document -> list -> document (full unmount/remount)', async () => {
      vi.mocked(documentsService.fetchDocument).mockResolvedValue({
        id: 1,
        doc_type: 'invoice',
        path: '/Invoices/acme-q1.pdf',
        reviewed: false,
        fields: {},
      } as never)

      const wrapper = await mountAtDoc('doc-preview-remount-a')
      const hostBefore = wrapper.find(PREVIEW_MOUNT_SELECTOR).element
      markWithSentinel(hostBefore, 'previewer-sentinel-remount')

      // document -> list: the page component itself unmounts entirely.
      wrapper.unmount()

      // list -> document: a fresh page instance mounts for the next document.
      const wrapper2 = await mountAtDoc('doc-preview-remount-b')
      const hostAfter = wrapper2.find(PREVIEW_MOUNT_SELECTOR).element

      expect(hostAfter).toBe(hostBefore)
      expect(hostAfter.querySelector('[data-testid="previewer-sentinel-remount"]')).not.toBeNull()
    })

    it('keeps the same previewer host element, contents intact, across a document -> document navigation on the same page instance', async () => {
      vi.mocked(documentsService.fetchDocument).mockResolvedValue({
        id: 1,
        doc_type: 'invoice',
        path: '/Invoices/acme-q1.pdf',
        reviewed: false,
        fields: {},
      } as never)

      const wrapper = await mountAtDoc('doc-preview-nav-a')
      const hostBefore = wrapper.find(PREVIEW_MOUNT_SELECTOR).element
      markWithSentinel(hostBefore, 'previewer-sentinel-nav')

      // Same mounted page component, navigated to a different docId —
      // exercises loadDocType()'s docPath clear/refill cycle rather than a
      // page unmount.
      const router = wrapper.vm.$router as Router
      await router.push('/document/doc-preview-nav-b')
      await flushPromises()

      const hostAfter = wrapper.find(PREVIEW_MOUNT_SELECTOR).element

      expect(hostAfter).toBe(hostBefore)
      expect(hostAfter.querySelector('[data-testid="previewer-sentinel-nav"]')).not.toBeNull()
    })
  })

  // Phase 121 / M121.1 — an Office document (XLSX/DOCX/…) opened here used to
  // land in Collabora's *editing* UI, because that is what richdocuments'
  // viewer handler does by default. The handler's own `isEmbedded` prop is
  // what forces its read-only ("Viewing") mode, and the only supported way to
  // set a prop on the handler component is `open({ fileInfo })`: the `viewer`
  // app renders it with `v-bind="currentFile"`, where `currentFile` is the
  // fileInfo object we passed plus its own derived keys. `open({ path })`
  // fetches the fileInfo internally, so it offers no such seam.
  describe('read-only Office preview (Phase 121 / M121.1)', () => {
    const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    const FILE_INFO = {
      fileid: 4711,
      filename: '/Invoices/acme-q1.xlsx',
      basename: 'acme-q1.xlsx',
      mime: XLSX_MIME,
      permissions: 'RGDNVW',
      hasPreview: true,
      size: 18342,
      etag: '6a1f0c9d',
      lastmod: 'Mon, 24 Aug 2026 06:11:02 GMT',
      type: 'file' as const,
    }

    beforeEach(() => {
      ncViewer.mimetypes = ['application/pdf', XLSX_MIME]
      ncViewer.availableHandlers = [
        { id: 'images', mimes: ['image/png'] },
        { id: 'richdocuments', mimes: [XLSX_MIME] },
      ]
      // `vi.mock`'d module functions keep their call log across tests in this
      // file (no global mock reset here), so clear it explicitly — a
      // `not.toHaveBeenCalled()` assertion below would otherwise see a
      // previous test's call.
      vi.mocked(fetchViewerFileInfo).mockReset()
      vi.mocked(fetchViewerFileInfo).mockResolvedValue(FILE_INFO)
    })

    it('opens an Office document by fileInfo with isEmbedded set, so Collabora starts in Viewing mode', async () => {
      vi.mocked(documentsService.fetchDocument).mockResolvedValue({
        id: 1,
        doc_type: 'invoice',
        path: '/momentum-demo-user/files/Invoices/acme-q1.xlsx',
        mime_type: XLSX_MIME,
        reviewed: false,
        fields: {},
      } as never)

      const wrapper = await mountAtDoc('doc-preview-xlsx-readonly')

      expect(fetchViewerFileInfo).toHaveBeenCalledWith(
        '/remote.php/dav/files/momentum-demo-user',
        '/Invoices/acme-q1.xlsx',
      )
      expect(ncViewer.open).toHaveBeenCalledWith({
        fileInfo: { ...FILE_INFO, isEmbedded: true },
      })
      expect(wrapper.find(PREVIEW_MOUNT_SELECTOR).exists()).toBe(true)
      expect(wrapper.find('[data-testid="preview-unavailable"]').exists()).toBe(false)
    })

    it('leaves every other mime type on the plain path-based open', async () => {
      vi.mocked(documentsService.fetchDocument).mockResolvedValue({
        id: 1,
        doc_type: 'invoice',
        path: '/Invoices/acme-q1.pdf',
        mime_type: 'application/pdf',
        reviewed: false,
        fields: {},
      } as never)

      await mountAtDoc('doc-preview-pdf-not-office')

      expect(fetchViewerFileInfo).not.toHaveBeenCalled()
      expect(ncViewer.open).toHaveBeenCalledWith({ path: '/Invoices/acme-q1.pdf' })
    })

    it('falls back to the path-based open when the fileInfo lookup fails, rather than losing the preview', async () => {
      vi.mocked(fetchViewerFileInfo).mockRejectedValue(new Error('PROPFIND /x responded with 503'))
      vi.mocked(documentsService.fetchDocument).mockResolvedValue({
        id: 1,
        doc_type: 'invoice',
        path: '/Invoices/acme-q1.xlsx',
        mime_type: XLSX_MIME,
        reviewed: false,
        fields: {},
      } as never)

      const wrapper = await mountAtDoc('doc-preview-xlsx-propfind-failed')

      expect(ncViewer.open).toHaveBeenCalledWith({ path: '/Invoices/acme-q1.xlsx' })
      expect(wrapper.find('[data-testid="preview-unavailable"]').exists()).toBe(false)
    })

    it('keeps the path-based open on a viewer version that exposes no handler list', async () => {
      delete ncViewer.availableHandlers
      vi.mocked(documentsService.fetchDocument).mockResolvedValue({
        id: 1,
        doc_type: 'invoice',
        path: '/Invoices/acme-q1.xlsx',
        mime_type: XLSX_MIME,
        reviewed: false,
        fields: {},
      } as never)

      await mountAtDoc('doc-preview-xlsx-no-handler-list')

      expect(fetchViewerFileInfo).not.toHaveBeenCalled()
      expect(ncViewer.open).toHaveBeenCalledWith({ path: '/Invoices/acme-q1.xlsx' })
    })

    it('opens by fileInfo for a mime the richdocuments handler registers as an alias', async () => {
      ncViewer.availableHandlers = [
        { id: 'richdocuments', mimes: [], mimesAliases: { 'application/vnd.ms-excel': XLSX_MIME } },
      ]
      ncViewer.mimetypes = ['application/vnd.ms-excel']
      vi.mocked(fetchViewerFileInfo).mockResolvedValue({
        ...FILE_INFO,
        mime: 'application/vnd.ms-excel',
      })
      vi.mocked(documentsService.fetchDocument).mockResolvedValue({
        id: 1,
        doc_type: 'invoice',
        path: '/Invoices/legacy.xls',
        mime_type: 'application/vnd.ms-excel',
        reviewed: false,
        fields: {},
      } as never)

      await mountAtDoc('doc-preview-xls-alias')

      expect(ncViewer.open).toHaveBeenCalledWith({
        fileInfo: { ...FILE_INFO, mime: 'application/vnd.ms-excel', isEmbedded: true },
      })
    })
  })

  // Phase 67 / M67.1: the `viewer` app's own stylesheet ships
  // `body:has(#viewer) #header{visibility:hidden}` for its full-screen
  // overlay mode; this page counters it (in a scoped, global `<style>`
  // block DocumentViewerPage.vue owns) with `body.momentum-embedded-preview
  // :has(#viewer) #header{visibility:visible!important}`. jsdom implements
  // neither `:has()`-driven computed style nor the `viewer` app's real CSS,
  // so the counter-rule's *effect* can't be observed here — only its
  // trigger can: that this page adds the scoping class to `document.body`
  // for exactly its own mounted lifetime, and no other page does. Real-
  // browser verification of the header actually being visible/clickable
  // with a document open is called out in the MR description instead (see
  // backlog Phase 67's testing note: a jsdom assertion on
  // `getComputedStyle(header).visibility` would prove nothing here).
  describe('embedded-preview body class (Phase 67 / M67.1 header-visibility fix)', () => {
    it('adds the scoping class to <body> while mounted and removes it on unmount', async () => {
      const wrapper = await mountAtDoc('doc-body-class')

      expect(document.body.classList.contains('momentum-embedded-preview')).toBe(true)

      wrapper.unmount()

      expect(document.body.classList.contains('momentum-embedded-preview')).toBe(false)
    })
  })

  // Phase 174 / M174.1: the nav-toggle offset rule
  // (`body.momentum-embedded-preview .app-navigation-toggle-wrapper`) used to
  // be a bare `.app-navigation-toggle-wrapper` selector that, because this
  // app's `iife` build has no route-level CSS (vite.config.ts), applied on
  // every route rather than just the viewer. Unlike the `:has()`-driven
  // M67.1 rule above, this is a plain descendant selector — jsdom's
  // `getComputedStyle` CAN resolve it (see VirtualTable.unit.test.ts's
  // `getComputedStyle(el).flex` and FileBrowserPage.unit.test.ts's
  // `getComputedStyle(toolbar).flexWrap` for existing precedent), so this
  // test proves the actual scoping mechanism: the toggle only picks up the
  // offset while `body.momentum-embedded-preview` — and therefore this
  // page — is mounted, not unconditionally. `NcAppNavigation` renders the
  // real `.app-navigation-toggle-wrapper` element as an ancestor outside
  // this component's own template (same reasoning as the M139.1 comment
  // gives for why the rule can't be `scoped`), so this test simulates that
  // by appending a synthetic one directly to `document.body`. Whether the
  // toggle actually *lands inside the toolbar band* on each of the five
  // routes, in both nav states, is real layout geometry jsdom has no engine
  // for (no `rect.y`/box measurement) — that needs real-browser
  // confirmation, called out in the MR description instead, mirroring the
  // M67.1 test's own convention above.
  describe('nav-toggle offset scoping (Phase 174 / M174.1)', () => {
    it('applies the offset only while the viewer owns document.body, not before mount or after unmount', async () => {
      const toggle = document.createElement('div')
      toggle.className = 'app-navigation-toggle-wrapper'
      // `NcAppNavigation.vue` itself sets `position: absolute` on the real
      // element; jsdom only resolves a `top` computed value for a
      // positioned element, same as a real browser, so replicate that one
      // upstream declaration to observe this rule's effect.
      toggle.style.position = 'absolute'
      document.body.appendChild(toggle)

      const offset = 'calc(1rem + var(--default-clickable-area, 44px))'
      expect(getComputedStyle(toggle).top).not.toBe(offset)

      const wrapper = await mountAtDoc('doc-nav-toggle-offset')
      expect(getComputedStyle(toggle).top).toBe(offset)

      wrapper.unmount()
      expect(getComputedStyle(toggle).top).not.toBe(offset)

      toggle.remove()
    })
  })
})

describe('DocumentViewerPage status polling', () => {
  beforeEach(() => {
    vi.mocked(documentsService.fetchDocumentTypeSchema).mockResolvedValue({
      type_name: 'invoice',
      display_name: 'Invoice',
      fields: [],
    } as never)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows a spinner and does not poll while the document is done', async () => {
    vi.useFakeTimers()
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      status: 'done',
      reviewed: false,
      fields: {},
    } as never)

    const wrapper = await mountAtDoc('doc-done')

    expect(wrapper.find('[data-testid="processing-spinner"]').exists()).toBe(false)

    vi.mocked(documentsService.fetchDocument).mockClear()
    await vi.advanceTimersByTimeAsync(MOMENTUM_CONFIG.DOCUMENT_POLL_INTERVAL_MS * 2)

    expect(documentsService.fetchDocument).not.toHaveBeenCalled()
  })

  it('shows a spinner and polls GET /documents/:doc_id every DOCUMENT_POLL_INTERVAL_MS while pending/processing', async () => {
    vi.useFakeTimers()
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      status: 'processing',
      reviewed: false,
      fields: {},
    } as never)

    const wrapper = await mountAtDoc('doc-processing')

    expect(wrapper.find('[data-testid="processing-spinner"]').exists()).toBe(true)

    vi.mocked(documentsService.fetchDocument).mockClear()
    await vi.advanceTimersByTimeAsync(MOMENTUM_CONFIG.DOCUMENT_POLL_INTERVAL_MS)
    expect(documentsService.fetchDocument).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(MOMENTUM_CONFIG.DOCUMENT_POLL_INTERVAL_MS)
    expect(documentsService.fetchDocument).toHaveBeenCalledTimes(2)
  })

  it('stops polling once a poll response reports a terminal status', async () => {
    vi.useFakeTimers()
    // A plain mockResolvedValueOnce()/mockResolvedValue() sequence assumes a
    // specific single caller consumes the "once" value first — but
    // DocumentViewerPage and FieldEditor each independently call
    // fetchDocument (FieldEditor's own call no longer waits on docType, see
    // M158.1), so a fixed call-count queue is brittle to their relative
    // order. Keying off a mutable "current server status" instead mirrors
    // how a real endpoint behaves: every caller sees the same status at any
    // given moment, regardless of which of them asks first.
    let currentStatus: 'processing' | 'done' = 'processing'
    vi.mocked(documentsService.fetchDocument).mockImplementation(
      async () =>
        ({
          id: 1,
          doc_type: 'invoice',
          status: currentStatus,
          reviewed: false,
          fields: {},
        }) as never,
    )

    const wrapper = await mountAtDoc('doc-terminal')
    expect(wrapper.find('[data-testid="processing-spinner"]').exists()).toBe(true)

    currentStatus = 'done'
    vi.mocked(documentsService.fetchDocument).mockClear()
    await vi.advanceTimersByTimeAsync(MOMENTUM_CONFIG.DOCUMENT_POLL_INTERVAL_MS)
    await flushPromises()
    expect(wrapper.find('[data-testid="processing-spinner"]').exists()).toBe(false)

    vi.mocked(documentsService.fetchDocument).mockClear()
    await vi.advanceTimersByTimeAsync(MOMENTUM_CONFIG.DOCUMENT_POLL_INTERVAL_MS * 3)
    expect(documentsService.fetchDocument).not.toHaveBeenCalled()
  })

  it('triggers FieldEditor to refetch once a poll response reports a terminal status', async () => {
    vi.useFakeTimers()
    // See the mutable-status note in the previous test — the "once" queue
    // pattern is brittle to which of DocumentViewerPage's/FieldEditor's own
    // independent fetchDocument calls consumes it first.
    let currentStatus: 'processing' | 'done' = 'processing'
    vi.mocked(documentsService.fetchDocument).mockImplementation(
      async () =>
        ({
          id: 1,
          doc_type: 'invoice',
          status: currentStatus,
          reviewed: false,
          fields: {},
        }) as never,
    )

    await mountAtDoc('doc-terminal-refresh')
    await flushPromises()

    currentStatus = 'done'
    const callsBefore = vi.mocked(documentsService.fetchDocument).mock.calls.length

    await vi.advanceTimersByTimeAsync(MOMENTUM_CONFIG.DOCUMENT_POLL_INTERVAL_MS)
    await flushPromises()

    // One call from DocumentViewerPage's own poll tick, and (the bug this
    // guards) a second from FieldEditor re-fetching in response to the
    // refreshToken bump — without it, FieldEditor stays stuck showing its
    // "Reprocessing this document…" state forever whenever notify_push
    // misses/never delivers the terminal event.
    expect(vi.mocked(documentsService.fetchDocument).mock.calls.length).toBeGreaterThan(
      callsBefore + 1,
    )
  })

  // M129.2 (frontend.md § Special status states) — the poll had no budget: a
  // document whose re-run job dead-letters stays `pending` for ever, and the
  // page polled it for ever, spinner and all. Found by changing a document's
  // type on a real install (Phase 129) where the re-enqueued job could never
  // fetch its content.
  describe('a wait that cannot end (M129.2)', () => {
    const TICKS = Math.ceil(
      MOMENTUM_CONFIG.DOCUMENT_PROCESSING_TIMEOUT_MS / MOMENTUM_CONFIG.DOCUMENT_POLL_INTERVAL_MS,
    )

    function stillPending() {
      vi.mocked(documentsService.fetchDocument).mockResolvedValue({
        id: 1,
        doc_type: 'invoice',
        status: 'pending',
        reviewed: false,
        fields: {},
      } as never)
    }

    it('gives up polling after DOCUMENT_PROCESSING_TIMEOUT_MS and tells the panel the wait stalled', async () => {
      vi.useFakeTimers()
      stillPending()

      const wrapper = await mountAtDoc('doc-stalled')
      expect(fieldEditorProps(wrapper).processingStalled).toBe(false)

      await vi.advanceTimersByTimeAsync(MOMENTUM_CONFIG.DOCUMENT_PROCESSING_TIMEOUT_MS)
      await flushPromises()

      expect(fieldEditorProps(wrapper).processingStalled).toBe(true)
      // The indefinite header spinner goes with it — it is the other half of
      // the "still working on it" reading.
      expect(wrapper.find('[data-testid="processing-spinner"]').exists()).toBe(false)

      vi.mocked(documentsService.fetchDocument).mockClear()
      await vi.advanceTimersByTimeAsync(MOMENTUM_CONFIG.DOCUMENT_POLL_INTERVAL_MS * 3)
      expect(documentsService.fetchDocument).not.toHaveBeenCalled()
    })

    it('does not stall a wait that ends in time', async () => {
      vi.useFakeTimers()
      stillPending()

      const wrapper = await mountAtDoc('doc-in-time')

      // One tick short of the budget, then a terminal status arrives.
      await vi.advanceTimersByTimeAsync(
        MOMENTUM_CONFIG.DOCUMENT_PROCESSING_TIMEOUT_MS - MOMENTUM_CONFIG.DOCUMENT_POLL_INTERVAL_MS,
      )
      vi.mocked(documentsService.fetchDocument).mockResolvedValue({
        id: 1,
        doc_type: 'invoice',
        status: 'done',
        reviewed: false,
        fields: {},
      } as never)
      await vi.advanceTimersByTimeAsync(MOMENTUM_CONFIG.DOCUMENT_POLL_INTERVAL_MS)
      await flushPromises()

      expect(fieldEditorProps(wrapper).processingStalled).toBe(false)
      expect(wrapper.find('[data-testid="processing-spinner"]').exists()).toBe(false)
    })

    it('resumes the wait with a fresh budget when the panel asks to recheck', async () => {
      vi.useFakeTimers()
      stillPending()

      const wrapper = await mountAtDoc('doc-recheck')
      await vi.advanceTimersByTimeAsync(MOMENTUM_CONFIG.DOCUMENT_PROCESSING_TIMEOUT_MS)
      await flushPromises()
      expect(fieldEditorProps(wrapper).processingStalled).toBe(true)

      vi.mocked(documentsService.fetchDocument).mockClear()
      wrapper.findComponent(FieldEditor).vm.$emit('recheck')
      await flushPromises()

      expect(fieldEditorProps(wrapper).processingStalled).toBe(false)
      // Rechecking is worth nothing if it only restarts the timer: it has to
      // read the document now, and keep polling afterwards.
      expect(documentsService.fetchDocument).toHaveBeenCalled()

      vi.mocked(documentsService.fetchDocument).mockClear()
      await vi.advanceTimersByTimeAsync(MOMENTUM_CONFIG.DOCUMENT_POLL_INTERVAL_MS)
      expect(documentsService.fetchDocument).toHaveBeenCalled()
    })
  })

  it('stops polling when the component unmounts', async () => {
    vi.useFakeTimers()
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      status: 'pending',
      reviewed: false,
      fields: {},
    } as never)

    const wrapper = await mountAtDoc('doc-unmount')
    wrapper.unmount()

    vi.mocked(documentsService.fetchDocument).mockClear()
    await vi.advanceTimersByTimeAsync(MOMENTUM_CONFIG.DOCUMENT_POLL_INTERVAL_MS * 2)
    expect(documentsService.fetchDocument).not.toHaveBeenCalled()
  })
})

describe('DocumentViewerPage notify_push subscription', () => {
  beforeEach(() => {
    vi.mocked(notifyPush.listen).mockClear()
    vi.mocked(documentsService.fetchDocumentTypeSchema).mockResolvedValue({
      type_name: 'invoice',
      display_name: 'Invoice',
      fields: [],
    } as never)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function pushHandler(): (name: string, body: unknown) => void {
    const call = vi.mocked(notifyPush.listen).mock.calls.find(
      ([name]) => name === MOMENTUM_CONFIG.MOMENTUM_STATUS_PUSH_EVENT,
    )
    if (!call) throw new Error('momentum_status listener was never registered')
    return call[1] as (name: string, body: unknown) => void
  }

  it('subscribes to the momentum_status notify_push event on mount', async () => {
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      status: 'processing',
      reviewed: false,
      fields: {},
    } as never)

    await mountAtDoc('doc-push')

    expect(notifyPush.listen).toHaveBeenCalledWith(
      MOMENTUM_CONFIG.MOMENTUM_STATUS_PUSH_EVENT,
      expect.any(Function),
    )
  })

  it('clears the spinner and stops polling as soon as a matching terminal push arrives, ahead of the poll interval', async () => {
    vi.useFakeTimers()
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      status: 'processing',
      reviewed: false,
      fields: {},
    } as never)

    const wrapper = await mountAtDoc('doc-push-terminal')
    expect(wrapper.find('[data-testid="processing-spinner"]').exists()).toBe(true)

    pushHandler()(MOMENTUM_CONFIG.MOMENTUM_STATUS_PUSH_EVENT, {
      doc_id: 'doc-push-terminal',
      status: 'done',
      reviewed: true,
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="processing-spinner"]').exists()).toBe(false)

    vi.mocked(documentsService.fetchDocument).mockClear()
    await vi.advanceTimersByTimeAsync(MOMENTUM_CONFIG.DOCUMENT_POLL_INTERVAL_MS * 3)
    expect(documentsService.fetchDocument).not.toHaveBeenCalled()
  })

  it('ignores a push event for a different doc id', async () => {
    vi.useFakeTimers()
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      status: 'processing',
      reviewed: false,
      fields: {},
    } as never)

    const wrapper = await mountAtDoc('doc-push-other')

    pushHandler()(MOMENTUM_CONFIG.MOMENTUM_STATUS_PUSH_EVENT, {
      doc_id: 'some-other-doc',
      status: 'done',
      reviewed: true,
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="processing-spinner"]').exists()).toBe(true)
  })

  it('triggers FieldEditor to refetch so terminal fields/reviewed state show up without a manual reload', async () => {
    vi.useFakeTimers()
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      status: 'processing',
      reviewed: false,
      fields: {},
    } as never)

    await mountAtDoc('doc-push-refresh')
    await flushPromises()

    const callsBefore = vi.mocked(documentsService.fetchDocument).mock.calls.length

    pushHandler()(MOMENTUM_CONFIG.MOMENTUM_STATUS_PUSH_EVENT, {
      doc_id: 'doc-push-refresh',
      status: 'done',
      reviewed: true,
    })
    await flushPromises()

    expect(vi.mocked(documentsService.fetchDocument).mock.calls.length).toBeGreaterThan(
      callsBefore,
    )
  })
})

// M139.1 (frontend.md § Document Viewer & Field Editor "Top bar") —
// specs/mockup-ai-document-manager.html's `.viewer-topbar`: Back + filename +
// Reviewed pill above the split panel.
describe('DocumentViewerPage top bar (M139.1)', () => {
  beforeEach(() => {
    vi.mocked(documentsService.fetchDocumentTypeSchema).mockResolvedValue({
      type_name: 'invoice',
      display_name: 'Invoice',
      fields: [],
    } as never)
  })

  it('shows the placeholder title before the document path is known', async () => {
    let resolveDoc!: (value: documentsService.DocumentDTO) => void
    vi.mocked(documentsService.fetchDocument).mockReturnValue(
      new Promise((resolve) => {
        resolveDoc = resolve
      }),
    )

    const wrapper = await mountAtDoc('doc-title-loading')

    expect(wrapper.get('[data-testid="document-viewer-title"]').text()).toBe('Document')

    resolveDoc({
      public_id: 'doc-title-loading',
      doc_type: 'invoice',
      path: '/momentum-demo-user/files/Invoices/acme-q1.pdf',
      reviewed: false,
      fields: {},
    } as never)
    await flushPromises()

    expect(wrapper.get('[data-testid="document-viewer-title"]').text()).toBe('acme-q1.pdf')
  })

  it('derives the title from the last segment of the document path', async () => {
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      path: '/momentum-demo-user/files/Momentum Demo/Lieferschein_Rexel_2026-01-17.pdf',
      reviewed: false,
      fields: {},
    } as never)

    const wrapper = await mountAtDoc('doc-title-basename')

    expect(wrapper.get('[data-testid="document-viewer-title"]').text()).toBe(
      'Lieferschein_Rexel_2026-01-17.pdf',
    )
  })

  it('shows no Reviewed pill for an unreviewed document, and shows one once FieldEditor reports reviewed', async () => {
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      path: '/Invoices/acme-q1.pdf',
      reviewed: false,
      fields: {},
    } as never)

    const wrapper = await mountAtDoc('doc-reviewed-pill')

    expect(wrapper.find('[data-testid="document-viewer-reviewed-pill"]').exists()).toBe(false)

    wrapper.findComponent(FieldEditor).vm.$emit('update:reviewed', true)
    await flushPromises()

    const pill = wrapper.get('[data-testid="document-viewer-reviewed-pill"]')
    expect(pill.text()).toContain('Reviewed')
  })

  it('hides the Reviewed pill again if FieldEditor reports the document as unreviewed', async () => {
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      path: '/Invoices/acme-q1.pdf',
      reviewed: true,
      fields: {},
    } as never)

    const wrapper = await mountAtDoc('doc-unreviewed-pill')
    await wrapper.vm.$nextTick()

    wrapper.findComponent(FieldEditor).vm.$emit('update:reviewed', false)
    await flushPromises()

    expect(wrapper.find('[data-testid="document-viewer-reviewed-pill"]').exists()).toBe(false)
  })

  it('goes back to the page that dispatched the navigation (frontend.md § History strategy)', async () => {
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      path: '/Invoices/acme-q1.pdf',
      reviewed: false,
      fields: {},
    } as never)

    // Arrived at the document viewer via a normal router.push from a
    // by-type list — exactly the pattern every real dispatcher (DocumentList,
    // AiFilingDashboardPage, FileBrowserPage) uses. Deliberately NOT the
    // `documents` route: goBack()'s no-history fallback also lands there, so
    // asserting a DIFFERENT route here is what actually proves this is real
    // history navigation and not the fallback firing unconditionally.
    const { wrapper, router } = await mountWithHistory(['/type/invoice'], 'doc-back-normal')

    await wrapper.get('[data-testid="document-viewer-back"]').trigger('click')

    // goBack() calls `router.back()`, which delegates to `history.go(-1)` —
    // real browser (and jsdom) navigation via `popstate`, an async task the
    // router only reacts to once the event fires, so `flushPromises()` alone
    // doesn't cover it.
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('by-type-document-list')
    })
  })

  it('falls back to the documents list on a direct deep link with no in-app history to go back to', async () => {
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      path: '/Invoices/acme-q1.pdf',
      reviewed: false,
      fields: {},
    } as never)

    // No prior path pushed — the very first navigation in this router's
    // history is straight to the document, as a bookmarked/shared link would
    // produce.
    const { wrapper, router } = await mountWithHistory([], 'doc-back-deep-link')

    await wrapper.get('[data-testid="document-viewer-back"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('documents')
  })
})

// M165.2 (backlog Phase 165) — thin-A's 503 must not leave the page on a mute
// spinner. `frontend.md` § getContents() already establishes the pattern
// (an inline NcEmptyContent banner) for the equivalent Doc-Mgr-API-down case;
// this is the Document Viewer's version of it, keyed on the HTTP status
// specifically so it isn't confused with any other failure.
describe('DocumentViewerPage thin-A 503 (M165.2)', () => {
  it('shows the access-re-verification reason, with the spinner gone, on a 503', async () => {
    vi.mocked(documentsService.fetchDocument).mockRejectedValue(
      new HttpError(503, '/index.php/apps/momentum/api/documents/doc-1'),
    )

    const wrapper = await mountAtDoc('doc-1')

    const message = wrapper.find('[data-testid="access-unavailable-message"]')
    expect(message.exists()).toBe(true)
    expect(message.text()).toContain('could not be re-verified')
    expect(wrapper.find('[data-testid="processing-spinner"]').exists()).toBe(false)
    expect(wrapper.find('.momentum-page--document-viewer').exists()).toBe(false)
  })

  it('does not show the access-re-verification reason for a different failure', async () => {
    vi.mocked(documentsService.fetchDocument).mockRejectedValue(
      new HttpError(500, '/index.php/apps/momentum/api/documents/doc-1'),
    )

    const wrapper = await mountAtDoc('doc-1')

    expect(wrapper.find('[data-testid="access-unavailable-message"]').exists()).toBe(false)
  })

  it('retries the fetch when Retry is clicked', async () => {
    // Two calls reject: the initially-mounted FieldEditor's own independent
    // fetch and DocumentViewerPage's own — both fire on the same first mount,
    // in child-before-parent order (see the comment above the FieldEditor
    // fetch mock in the previous two tests for why both matter here).
    vi.mocked(documentsService.fetchDocument)
      .mockRejectedValueOnce(new HttpError(503, '/index.php/apps/momentum/api/documents/doc-1'))
      .mockRejectedValueOnce(new HttpError(503, '/index.php/apps/momentum/api/documents/doc-1'))
    vi.mocked(documentsService.fetchDocument).mockResolvedValue({
      id: 1,
      doc_type: 'invoice',
      reviewed: false,
      fields: {},
    } as never)

    const wrapper = await mountAtDoc('doc-1')
    expect(wrapper.find('[data-testid="access-unavailable-message"]').exists()).toBe(true)

    await wrapper.get('[data-testid="access-unavailable-retry"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="access-unavailable-message"]').exists()).toBe(false)
    expect(wrapper.find('.momentum-page--document-viewer').exists()).toBe(true)
  })
})
