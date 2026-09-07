import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchViewerFileInfo } from './viewerFileInfo'

vi.mock('@nextcloud/auth', () => ({ getRequestToken: () => 'test-request-token' }))

// Phase 121 / M121.1 — `OCA.Viewer.open({ fileInfo })` is the only opening
// mode that lets Doc-Mgr hand extra props to the handler component that
// renders the file (the `viewer` app `v-bind`s the whole fileInfo object onto
// it), which is what forces Collabora into read-only "Viewing" mode. That
// mode needs a real fileInfo, so this module reproduces the same DAV PROPFIND
// the `viewer` app runs itself for `open({ path })`.
const PROPFIND_XML = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
  <d:response>
    <d:href>/remote.php/dav/files/momentum-demo-user/Momentum%20Demo/acme-q1.xlsx</d:href>
    <d:propstat>
      <d:prop>
        <d:getcontenttype>application/vnd.openxmlformats-officedocument.spreadsheetml.sheet</d:getcontenttype>
        <d:getcontentlength>18342</d:getcontentlength>
        <d:getetag>&quot;6a1f0c9d&quot;</d:getetag>
        <d:getlastmodified>Mon, 24 Aug 2026 06:11:02 GMT</d:getlastmodified>
        <oc:fileid>4711</oc:fileid>
        <oc:permissions>RGDNVW</oc:permissions>
        <nc:has-preview>true</nc:has-preview>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

function stubFetch(response: Partial<Response> & { text?: () => Promise<string> }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 207,
    text: async () => PROPFIND_XML,
    ...response,
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('fetchViewerFileInfo', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    stubFetch({})
  })

  it('PROPFINDs the file at Depth 0 under the DAV root, encoding each path segment separately', async () => {
    const fetchMock = stubFetch({})

    await fetchViewerFileInfo(
      '/remote.php/dav/files/momentum-demo-user',
      '/Momentum Demo/acme-q1.xlsx',
    )

    const [url, init] = fetchMock.mock.calls[0]
    // The separators stay separators and only the segments are encoded — a
    // whole-path encodeURIComponent would produce `%2F` and name one
    // collection whose name contains a slash (scripts/tests/
    // dav-path-segment-encoding-test.sh records the live 404 that caused).
    expect(url).toBe(
      '/remote.php/dav/files/momentum-demo-user/Momentum%20Demo/acme-q1.xlsx',
    )
    expect(init.method).toBe('PROPFIND')
    expect(init.headers.Depth).toBe('0')
    expect(init.headers.requesttoken).toBe('test-request-token')
    // The requested properties are the ones the handler components actually
    // read off the fileInfo (richdocuments' Office.vue: fileid, mime,
    // permissions, hasPreview).
    expect(init.body).toContain('<oc:fileid/>')
    expect(init.body).toContain('<oc:permissions/>')
    expect(init.body).toContain('<nc:has-preview/>')
    expect(init.body).toContain('<d:getcontenttype/>')
  })

  it('returns a fileInfo shaped like the one the viewer app builds for open({ path })', async () => {
    const fileInfo = await fetchViewerFileInfo(
      '/remote.php/dav/files/momentum-demo-user',
      '/Momentum Demo/acme-q1.xlsx',
    )

    expect(fileInfo).toEqual({
      fileid: 4711,
      filename: '/Momentum Demo/acme-q1.xlsx',
      basename: 'acme-q1.xlsx',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      permissions: 'RGDNVW',
      hasPreview: true,
      size: 18342,
      etag: '6a1f0c9d',
      lastmod: 'Mon, 24 Aug 2026 06:11:02 GMT',
      type: 'file',
    })
    // `fileid` must be a real number: richdocuments' handler declares it as
    // `type: Number`, and its WOPI token request keys off it.
    expect(typeof fileInfo.fileid).toBe('number')
  })

  it('reads has-preview as false when the server says false', async () => {
    stubFetch({ text: async () => PROPFIND_XML.replace('>true<', '>false<') })

    const fileInfo = await fetchViewerFileInfo('/dav', '/x.xlsx')

    expect(fileInfo.hasPreview).toBe(false)
  })

  it('throws when the PROPFIND fails, so the caller can fall back to open({ path })', async () => {
    stubFetch({ ok: false, status: 404 })

    await expect(fetchViewerFileInfo('/dav', '/gone.xlsx')).rejects.toThrow('404')
  })

  it('throws when the response carries no usable file id', async () => {
    stubFetch({ text: async () => PROPFIND_XML.replace(/<oc:fileid>.*<\/oc:fileid>/, '') })

    await expect(fetchViewerFileInfo('/dav', '/x.xlsx')).rejects.toThrow(/file id/i)
  })

  it('throws when the response is not parseable DAV XML', async () => {
    stubFetch({ text: async () => 'not xml at all' })

    await expect(fetchViewerFileInfo('/dav', '/x.xlsx')).rejects.toThrow()
  })
})
