import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchDocument,
  fetchDocumentTypes,
  fetchDocumentTypeSchema,
  fetchSearchDocuments,
  fetchStatsOverview,
  patchDocument,
  patchDocumentFields,
  reprocessDocument,
} from './documents'

vi.mock('@nextcloud/auth', () => ({ getRequestToken: () => 'the-csrf-token' }))

// Same stand-in `generateUrl` the other suites use: it stands for an instance
// without mod_rewrite, where NC prefixes every url with `/index.php` — the
// prefix the service must not hardcode away.
vi.mock('@nextcloud/router', () => ({
  generateUrl: (path: string) => `/index.php${path}`,
}))

// M4.1 note (backlog/v1.md): calls go through the app's own PHP-proxied
// `/apps/momentum/api/*` routes, typed against the generated schema.d.ts
// request/response shapes even though the transport isn't openapi-fetch.

function mockFetchOnce(response: { status: number; body?: unknown }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: () => Promise.resolve(response.body),
    }),
  )
}

describe('documents service', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches a document type schema from the proxied API path', async () => {
    mockFetchOnce({ status: 200, body: { type_name: 'invoice', fields: [] } })

    const schema = await fetchDocumentTypeSchema('invoice')

    expect(fetch).toHaveBeenCalledWith(
      '/index.php/apps/momentum/api/document-types/invoice/schema',
      expect.objectContaining({ headers: expect.objectContaining({ 'Content-Type': 'application/json' }) }),
    )
    expect(schema).toEqual({ type_name: 'invoice', fields: [] })
  })

  it('fetches a document from the proxied API path', async () => {
    mockFetchOnce({ status: 200, body: { id: 1, doc_type: 'invoice' } })

    const doc = await fetchDocument('1')

    expect(fetch).toHaveBeenCalledWith('/index.php/apps/momentum/api/documents/1', expect.anything())
    expect(doc).toEqual({ id: 1, doc_type: 'invoice' })
  })

  // M177.1 — DocumentViewerPage and FieldEditor each call fetchDocument() on
  // mount before either's request resolves (measured live: one document open
  // issued two `GET .../documents/<id>` requests, 66 ms apart, against a
  // `done` document — not a `processing` one, which legitimately polls).
  it('coalesces concurrent fetchDocument calls for the same docId into a single request', async () => {
    mockFetchOnce({ status: 200, body: { id: 1, doc_type: 'invoice' } })

    const [first, second] = await Promise.all([fetchDocument('1'), fetchDocument('1')])

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(first).toEqual({ id: 1, doc_type: 'invoice' })
    expect(second).toEqual({ id: 1, doc_type: 'invoice' })
  })

  it('does not coalesce concurrent fetchDocument calls for different docIds', async () => {
    mockFetchOnce({ status: 200, body: { id: 1, doc_type: 'invoice' } })

    await Promise.all([fetchDocument('1'), fetchDocument('2')])

    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('issues a fresh request once the in-flight one has settled', async () => {
    mockFetchOnce({ status: 200, body: { id: 1, doc_type: 'invoice' } })

    await fetchDocument('1')
    await fetchDocument('1')

    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not keep a failed request cached for the next caller', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))

    await expect(fetchDocument('1')).rejects.toThrow('network error')
    await expect(fetchDocument('1')).rejects.toThrow('network error')

    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('PATCHes corrected fields and returns the full current field set', async () => {
    mockFetchOnce({ status: 200, body: { fields: { total: 42 }, reviewed: true } })

    const result = await patchDocumentFields('1', { total: 42 })

    expect(fetch).toHaveBeenCalledWith(
      '/index.php/apps/momentum/api/documents/1/fields',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ total: 42 }) }),
    )
    expect(result).toEqual({ fields: { total: 42 }, reviewed: true })
  })

  it('PATCHes document flags and resolves with no body on 204', async () => {
    mockFetchOnce({ status: 204 })

    await expect(patchDocument('1', { reviewed: true })).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledWith(
      '/index.php/apps/momentum/api/documents/1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ reviewed: true }) }),
    )
  })

  // ApiProxyController::patchDocument()/patchDocumentFields()/reprocessDocument()
  // leave NC's CSRF protection enabled, expecting the `requesttoken` header
  // NC's own `@nextcloud/axios` client attaches automatically — a plain
  // `fetch` call omitting it fails CSRF validation with a 412, which
  // previously surfaced as an unhandled promise rejection (e.g. the Document
  // Viewer's type dropdown, backlog "chore/document-viewer-change-type").
  it('attaches the NC CSRF request token header to every request', async () => {
    mockFetchOnce({ status: 204 })

    await patchDocument('1', { reviewed: true })

    expect(fetch).toHaveBeenCalledWith(
      '/index.php/apps/momentum/api/documents/1',
      expect.objectContaining({ headers: expect.objectContaining({ requesttoken: 'the-csrf-token' }) }),
    )
  })

  it('POSTs a reprocess request for a failed document and resolves with no body on 202', async () => {
    mockFetchOnce({ status: 202 })

    await expect(reprocessDocument('1')).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledWith(
      '/index.php/apps/momentum/api/documents/1/reprocess',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('fetches the document type registry from the proxied API path', async () => {
    mockFetchOnce({
      status: 200,
      body: { types: [{ type_name: 'invoice', display_name: 'Invoice' }] },
    })

    const types = await fetchDocumentTypes()

    expect(fetch).toHaveBeenCalledWith('/index.php/apps/momentum/api/document-types', expect.anything())
    expect(types).toEqual([{ type_name: 'invoice', display_name: 'Invoice' }])
  })

  // M83.2 (frontend.md § Type control) — the doc_type correction control is
  // the one consumer that must see the full global catalog, not the
  // usage-scoped default the nav tree gets.
  it('requests the full global catalog when asked for the "all" scope', async () => {
    mockFetchOnce({
      status: 200,
      body: { types: [{ type_name: 'invoice', display_name: 'Invoice' }] },
    })

    await fetchDocumentTypes('all')

    expect(fetch).toHaveBeenCalledWith(
      '/index.php/apps/momentum/api/document-types?scope=all',
      expect.anything(),
    )
  })

  it('defaults the document type registry to an empty list when the response omits types', async () => {
    mockFetchOnce({ status: 200, body: {} })

    await expect(fetchDocumentTypes()).resolves.toEqual([])
  })

  it('fetches the stats overview from the proxied API path', async () => {
    mockFetchOnce({
      status: 200,
      body: { types: [{ type_name: 'invoice', display_name: 'Invoice', total: 3, unreviewed: 1 }], total: 3, unreviewed: 1 },
    })

    const overview = await fetchStatsOverview()

    expect(fetch).toHaveBeenCalledWith('/index.php/apps/momentum/api/stats/overview', expect.anything())
    expect(overview).toEqual({
      types: [{ type_name: 'invoice', display_name: 'Invoice', total: 3, unreviewed: 1 }],
      total: 3,
      unreviewed: 1,
    })
  })

  it('rejects when the response is not ok', async () => {
    mockFetchOnce({ status: 404, body: { error: 'not found' } })

    await expect(fetchDocument('missing')).rejects.toThrow()
  })

  // frontend.md § Recent Documents (M4.8): `GET /search/documents` with no
  // `type_name` for the cross-type view.
  it('searches documents from the proxied API path, encoding sort and cursor', async () => {
    mockFetchOnce({ status: 200, body: { items: [], limit: 50 } })

    await fetchSearchDocuments({
      sort: { column: 'created_at', direction: 'desc' },
      filters: [],
      cursor: 'abc123',
    })

    expect(fetch).toHaveBeenCalledWith(
      '/index.php/apps/momentum/api/search/documents?sort=created_at%3Adesc&cursor=abc123',
      expect.anything(),
    )
  })

  it('includes type_name when searching a specific document type', async () => {
    mockFetchOnce({ status: 200, body: { items: [], limit: 50 } })

    await fetchSearchDocuments({
      typeName: 'invoice',
      sort: { column: 'created_at', direction: 'desc' },
      filters: [],
    })

    expect(fetch).toHaveBeenCalledWith(
      '/index.php/apps/momentum/api/search/documents?type_name=invoice&sort=created_at%3Adesc',
      expect.anything(),
    )
  })

  it('encodes field-kind filters as repeated f= params, and combines a search-kind term into q=', async () => {
    mockFetchOnce({ status: 200, body: { items: [], limit: 50 } })

    await fetchSearchDocuments({
      sort: { column: 'created_at', direction: 'desc' },
      filters: [
        { kind: 'field', field_name: 'status', operator: 'eq', value: 'done' },
        { kind: 'field', field_name: 'reviewed', operator: 'eq', value: false },
        { kind: 'search', term: 'acme' },
      ],
    })

    // q= is combined with any f= filters via AND (api.md), but never with an
    // explicit sort= or cursor — full-text results rank by relevance and are
    // first-page-only (backend/internal/documents/search.go's
    // ValidateFullTextQuery), so both are omitted whenever a search term is
    // present, regardless of the caller's requested sort/cursor.
    expect(fetch).toHaveBeenCalledWith(
      '/index.php/apps/momentum/api/search/documents?f=status%3Aeq%3Adone&f=reviewed%3Aeq%3Afalse&q=acme',
      expect.anything(),
    )
  })

  it('joins multiple committed search terms into a single q= value', async () => {
    mockFetchOnce({ status: 200, body: { items: [], limit: 50 } })

    await fetchSearchDocuments({
      sort: { column: 'created_at', direction: 'desc' },
      filters: [
        { kind: 'search', term: 'acme' },
        { kind: 'search', term: 'invoice' },
      ],
    })

    expect(fetch).toHaveBeenCalledWith(
      '/index.php/apps/momentum/api/search/documents?q=acme+invoice',
      expect.anything(),
    )
  })

  it('omits an explicit cursor from the request once a search term is active', async () => {
    mockFetchOnce({ status: 200, body: { items: [], limit: 50 } })

    await fetchSearchDocuments({
      sort: { column: 'created_at', direction: 'desc' },
      filters: [{ kind: 'search', term: 'acme' }],
      cursor: 'abc123',
    })

    expect(fetch).toHaveBeenCalledWith('/index.php/apps/momentum/api/search/documents?q=acme', expect.anything())
  })

  it('returns the search response as-is', async () => {
    const body = {
      items: [{ id: 1, path: '/Invoices/acme.pdf', doc_type: 'invoice', status: 'done', reviewed: false }],
      next_cursor: 'eyJ0cyI6xx',
      limit: 50,
    }
    mockFetchOnce({ status: 200, body })

    const result = await fetchSearchDocuments({
      sort: { column: 'created_at', direction: 'desc' },
      filters: [],
    })

    expect(result).toEqual(body)
  })
})
