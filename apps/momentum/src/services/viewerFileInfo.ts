import { getRequestToken } from '@nextcloud/auth'

// Phase 121 / M121.1 — the fileInfo object `OCA.Viewer.open({ fileInfo })`
// takes, built by the same DAV PROPFIND the `viewer` app runs itself when it
// is handed a bare path instead (its `src/services/FileInfo.ts` ->
// `genFileInfo()`, whose output is webdav's own `FileStat` top-level fields
// plus the camelCased DAV props).
//
// Why we build it ourselves rather than keep passing `{ path }`: the `viewer`
// app renders the handler component with `v-bind="currentFile"`, and
// `currentFile` is `Object.assign({}, fileInfo, …)` — so **every** key of the
// fileInfo we pass becomes a prop on the component that renders the file.
// That is the one supported seam for telling richdocuments' handler
// (`isEmbedded`) to open Collabora read-only. `open({ path })` gives us no
// such seam: the fileInfo is then fetched internally and we never see it.
export interface ViewerFileInfo {
  /** Nextcloud file id — richdocuments declares this prop as `Number`. */
  fileid: number
  /** Path relative to the acting user's own DAV root, as the viewer expects. */
  filename: string
  basename: string
  mime: string
  /** Nextcloud's own permission letters (e.g. `RGDNVW`), not a bitmask. */
  permissions: string
  hasPreview: boolean
  size: number
  etag: string
  lastmod: string
  type: 'file'
}

const DAV_NS = 'DAV:'
const OC_NS = 'http://owncloud.org/ns'
const NC_NS = 'http://nextcloud.org/ns'

// Only the properties a handler component actually reads off the fileInfo.
// Deliberately not the viewer app's full property list: everything we do not
// send is a property no consumer of this object looks at, and a shorter
// PROPFIND is cheaper for the server than the default one.
const PROPFIND_BODY = `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
  <d:prop>
    <d:getcontenttype/>
    <d:getcontentlength/>
    <d:getetag/>
    <d:getlastmodified/>
    <oc:fileid/>
    <oc:permissions/>
    <nc:has-preview/>
  </d:prop>
</d:propfind>`

// Per-segment encoding: the separators must stay separators. Encoding the
// whole path turns `/` into `%2F`, which names a single collection whose name
// contains a slash — the live upload 404 that
// scripts/tests/dav-path-segment-encoding-test.sh exists to guard.
function encodeDavPath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function propText(response: Element, namespace: string, localName: string): string | undefined {
  const node = response.getElementsByTagNameNS(namespace, localName)[0]
  const text = node?.textContent ?? undefined
  return text === undefined || text === '' ? undefined : text
}

/**
 * PROPFIND `homeRelativePath` under `davRootUrl` and reshape the result into
 * the fileInfo object `OCA.Viewer.open({ fileInfo })` expects.
 *
 * Rejects (rather than returning a half-populated object) whenever the file
 * id is missing, so callers can fall back to `open({ path })` and still show
 * a working preview.
 */
export async function fetchViewerFileInfo(
  davRootUrl: string,
  homeRelativePath: string,
): Promise<ViewerFileInfo> {
  const url = `${davRootUrl}${encodeDavPath(homeRelativePath)}`
  const response = await fetch(url, {
    method: 'PROPFIND',
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      Depth: '0',
      // Same reason services/documents.ts attaches it by hand: this module
      // uses plain `fetch`, which sends no `requesttoken` of its own.
      requesttoken: getRequestToken() ?? '',
    },
    body: PROPFIND_BODY,
  })
  if (!response.ok) {
    throw new Error(`PROPFIND ${url} responded with ${response.status}`)
  }

  const document = new DOMParser().parseFromString(await response.text(), 'application/xml')
  const davResponse = document.getElementsByTagNameNS(DAV_NS, 'response')[0]
  if (!davResponse) {
    throw new Error(`PROPFIND ${url} returned no DAV response element`)
  }

  const fileid = Number(propText(davResponse, OC_NS, 'fileid'))
  if (!Number.isFinite(fileid)) {
    throw new Error(`PROPFIND ${url} returned no usable file id`)
  }

  return {
    fileid,
    filename: homeRelativePath,
    basename: homeRelativePath.split('/').pop() ?? homeRelativePath,
    mime: propText(davResponse, DAV_NS, 'getcontenttype') ?? '',
    permissions: propText(davResponse, OC_NS, 'permissions') ?? '',
    hasPreview: propText(davResponse, NC_NS, 'has-preview') === 'true',
    size: Number(propText(davResponse, DAV_NS, 'getcontentlength') ?? 0),
    // Sabre quotes the ETag; the viewer app's own fileInfo carries it
    // unquoted (webdav strips them), so match that rather than the wire form.
    etag: (propText(davResponse, DAV_NS, 'getetag') ?? '').replace(/^"|"$/g, ''),
    lastmod: propText(davResponse, DAV_NS, 'getlastmodified') ?? '',
    type: 'file',
  }
}
