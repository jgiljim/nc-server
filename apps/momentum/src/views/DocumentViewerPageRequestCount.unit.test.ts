import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DocumentViewerPage from './DocumentViewerPage.vue'
import { fetchViewerFileInfo } from '../services/viewerFileInfo'

// M177.1 (backlog/v1.md) — unlike DocumentViewerPage.unit.test.ts, this suite
// deliberately does NOT `vi.mock('../services/documents')`: the defect this
// phase measured (two `GET /apps/momentum/api/documents/<id>` requests per
// view open, 66 ms apart) is DocumentViewerPage's own loadDocType() and the
// real (unmocked) FieldEditor's load() each calling the real fetchDocument(),
// which a fully-mocked documents service can't observe — the mock has no
// notion of "the same in-flight request". Mocking `fetch` instead and
// counting calls to it is what actually exercises the fix.
vi.mock('../services/viewerFileInfo')
vi.mock('@nextcloud/notify_push', () => ({ listen: vi.fn() }))
vi.mock('@nextcloud/auth', () => ({
  getCurrentUser: () => ({ uid: 'momentum-demo-user' }),
  getRequestToken: () => 'the-csrf-token',
}))
vi.mock('@nextcloud/router', () => ({
  generateRemoteUrl: (path: string) => `/remote.php/${path}`,
  generateUrl: (path: string) => `/index.php${path}`,
}))

const DOCUMENTS_PATH = '/index.php/apps/momentum/api/documents/'

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as Response
}

async function mountAtDoc(docId: string): Promise<ReturnType<typeof mount>> {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/document/:docId', name: 'document-viewer', component: DocumentViewerPage }],
  })
  router.push(`/document/${docId}`)
  await router.isReady()
  const wrapper = mount(DocumentViewerPage, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('DocumentViewerPage — real fetchDocument, network mocked (M177.1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('issues exactly one GET /apps/momentum/api/documents/<id> per view open, for a done document', async () => {
    vi.mocked(fetchViewerFileInfo).mockResolvedValue({
      fileid: 1,
      filename: '/file.pdf',
      basename: 'file.pdf',
      mime: 'application/pdf',
      permissions: 'RGDNVW',
      hasPreview: true,
      size: 10,
      etag: 'etag',
      lastmod: '',
      type: 'file',
    })

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith(DOCUMENTS_PATH)) {
        // The document is `done` when measured — a `processing` document
        // legitimately polls again, which is not the defect this asserts.
        return Promise.resolve(
          jsonResponse({
            id: 1,
            doc_type: 'invoice',
            status: 'done',
            reviewed: false,
            fields: {},
            path: '/file.pdf',
            mime_type: 'application/pdf',
          }),
        )
      }
      if (url.includes('/document-types/invoice/schema')) {
        return Promise.resolve(jsonResponse({ type_name: 'invoice', display_name: 'Invoice', fields: [] }))
      }
      if (url.includes('/document-types')) {
        return Promise.resolve(jsonResponse({ types: [{ type_name: 'invoice', display_name: 'invoice' }] }))
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await mountAtDoc('doc-done-single-fetch')

    const documentRequests = fetchMock.mock.calls.filter(([url]) => String(url).startsWith(DOCUMENTS_PATH))
    expect(documentRequests).toHaveLength(1)
  })
})
