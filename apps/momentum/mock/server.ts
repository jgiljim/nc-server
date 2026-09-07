// The mock backend: a Vite dev-server middleware standing in for both the
// Glue App's PHP-proxied `/apps/momentum/api/*` routes (services/documents.ts)
// and Nextcloud's own WebDAV endpoint (services/viewerFileInfo.ts's PROPFIND,
// the Document Viewer's download-link fallback). Wired up by
// `vite.mock.config.ts` via `configureServer` — see README.md for why this
// lives here instead of MSW/a service worker (no build step, works with the
// app's plain `fetch` calls exactly as written, and can hold mutable
// in-memory state for PATCH/reprocess across requests within one dev-server
// session).
//
// Scope: only what `DocumentsListPage`/`DocumentViewerPage`/`FieldEditor`
// actually call (see services/documents.ts). Not implemented: `/search/*`
// full-text ranking beyond a substring match, and the Files-app View bundle's
// own endpoints (`files-entry.ts` is a separate, Nextcloud-Files-app-hosted
// bundle this harness doesn't mount — see README.md's "Not covered" section).
import type { Connect } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  DOCUMENTS,
  DOCUMENT_TYPES,
  findDocument,
  findDocumentType,
  type MockDocument,
} from './fixtures'
import { getMockFile } from './files'

export const MOCK_UID = 'mock-user'
const API_PREFIX = '/apps/momentum/api'
const DAV_PREFIX = `/remote.php/dav/files/${MOCK_UID}`

// Mutable in-memory copy — PATCH/reprocess requests mutate this, not the
// imported fixture constants, so a page reload during one `npm run mock`
// session keeps whatever state the last save/reprocess left behind.
const documents: MockDocument[] = DOCUMENTS.map((doc) => ({ ...doc, fields: { ...doc.fields } }))

function findMutable(publicId: string): MockDocument | undefined {
  return documents.find((doc) => doc.public_id === publicId)
}

// Same per-data_type deterministic fallback backend/internal/modelhub's
// MockExtractor uses, so a reprocessed document ends up looking like a real
// mock-pipeline run rather than empty fields.
function mockExtractedValue(dataType: string, fieldName: string): unknown {
  switch (dataType) {
    case 'string':
      return `mock-${fieldName}`
    case 'boolean':
      return fieldName.length % 2 === 0
    case 'int64':
      return 1
    case 'double':
      return 1.5
    case 'date':
      return '2000-01-01'
    default:
      return undefined
  }
}

function scheduleAutoProgress(publicId: string, delayMs: number): void {
  setTimeout(() => {
    const doc = findMutable(publicId)
    if (!doc || doc.status !== 'processing') return
    const type = findDocumentType(doc.doc_type)
    if (type) {
      for (const fieldDef of type.fields) {
        if (doc.fields[fieldDef.field_name] === undefined) {
          doc.fields[fieldDef.field_name] = mockExtractedValue(fieldDef.data_type, fieldDef.field_name)
        }
      }
    }
    doc.status = 'done'
    doc.updated_at = new Date().toISOString()
  }, delayMs)
}

// Demo the pending -> processing -> done poll path (frontend.md § Special
// status states) without needing a Reprocess click: whatever started
// 'processing' when the dev server booted finishes a few seconds into the
// session.
for (const doc of documents) {
  if (doc.status === 'processing') scheduleAutoProgress(doc.public_id, 8_000)
}

function toSearchItem(doc: MockDocument, snippet?: string) {
  return {
    public_id: doc.public_id,
    path: doc.path,
    mime_type: doc.mime_type,
    doc_type: doc.doc_type,
    direction: doc.direction,
    status: doc.status,
    reviewed: doc.reviewed,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    fields: doc.fields,
    ...(snippet ? { snippet } : {}),
  }
}

function toDocumentDTO(doc: MockDocument) {
  return {
    public_id: doc.public_id,
    path: doc.path,
    mime_type: doc.mime_type,
    doc_type: doc.doc_type,
    direction: doc.direction,
    status: doc.status,
    reviewed: doc.reviewed,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    fields: doc.fields,
    // api.md § field_quality — always present (empty for a document with no
    // tags yet), matching the real API rather than an absent key FieldEditor
    // would have to special-case.
    field_quality: doc.field_quality ?? {},
    content_hash: `mock-${doc.public_id}`,
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(payload)
}

function notFound(res: ServerResponse, message = 'not found'): void {
  sendJson(res, 404, { message })
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'))
  } catch {
    return {}
  }
}

function parseSort(value: string | null): { column: string; direction: 'asc' | 'desc' } {
  const [column, direction] = (value ?? 'created_at:desc').split(':')
  return { column: column || 'created_at', direction: direction === 'asc' ? 'asc' : 'desc' }
}

function compareBy(column: string, direction: 'asc' | 'desc') {
  return (a: MockDocument, b: MockDocument): number => {
    const av = String((a as unknown as Record<string, unknown>)[column] ?? '')
    const bv = String((b as unknown as Record<string, unknown>)[column] ?? '')
    const cmp = av < bv ? -1 : av > bv ? 1 : 0
    return direction === 'asc' ? cmp : -cmp
  }
}

function matchesFieldFilter(doc: MockDocument, filter: string): boolean {
  const [fieldName, operator, ...rest] = filter.split(':')
  const value = rest.join(':')
  const actual =
    fieldName === 'type_name'
      ? doc.doc_type
      : ((doc as unknown as Record<string, unknown>)[fieldName] ?? doc.fields[fieldName])
  switch (operator) {
    case 'eq':
      return String(actual ?? '') === value
    case 'not_eq':
      return String(actual ?? '') !== value
    case 'is_null':
      return actual === undefined || actual === null || actual === ''
    case 'is_not_null':
      return !(actual === undefined || actual === null || actual === '')
    default:
      return true
  }
}

function handleSearchDocuments(url: URL, res: ServerResponse): void {
  const typeName = url.searchParams.get('type_name')
  const q = url.searchParams.get('q')
  const filters = url.searchParams.getAll('f')

  let items = documents.slice()
  if (typeName) items = items.filter((doc) => doc.doc_type === typeName)
  for (const filter of filters) items = items.filter((doc) => matchesFieldFilter(doc, filter))

  let itemsWithSnippet: { doc: MockDocument; snippet?: string }[]
  if (q) {
    const needle = q.toLowerCase()
    itemsWithSnippet = items
      .map((doc) => {
        const haystack = [doc.path, doc.doc_type, ...Object.values(doc.fields).map(String)]
          .join(' ')
          .toLowerCase()
        return haystack.includes(needle) ? { doc, snippet: `…matched "${q}"…` } : undefined
      })
      .filter((entry): entry is { doc: MockDocument; snippet: string } => entry !== undefined)
  } else {
    const { column, direction } = parseSort(url.searchParams.get('sort'))
    items = items.sort(compareBy(column, direction))
    itemsWithSnippet = items.map((doc) => ({ doc }))
  }

  sendJson(res, 200, {
    items: itemsWithSnippet.map(({ doc, snippet }) => toSearchItem(doc, snippet)),
    limit: itemsWithSnippet.length,
    degraded: false,
  })
}

function handleStatsOverview(res: ServerResponse): void {
  const statusTotals = new Map<string, { total: number; unreviewed: number }>()
  const typeTotals = new Map<string, { total: number; unreviewed: number }>()
  for (const doc of documents) {
    const s = statusTotals.get(doc.status) ?? { total: 0, unreviewed: 0 }
    s.total += 1
    if (!doc.reviewed) s.unreviewed += 1
    statusTotals.set(doc.status, s)

    const t = typeTotals.get(doc.doc_type) ?? { total: 0, unreviewed: 0 }
    t.total += 1
    if (!doc.reviewed) t.unreviewed += 1
    typeTotals.set(doc.doc_type, t)
  }
  const mostRecent = documents.slice().sort(compareBy('created_at', 'desc'))[0]
  const mostRecentlyUpdated = documents.slice().sort(compareBy('updated_at', 'desc'))[0]

  sendJson(res, 200, {
    total: documents.length,
    unreviewed: documents.filter((doc) => !doc.reviewed).length,
    statuses: [...statusTotals.entries()].map(([status, v]) => ({ status, ...v })),
    types: [...typeTotals.entries()].map(([typeName, v]) => ({
      type_name: typeName,
      display_name: findDocumentType(typeName)?.display_name ?? typeName,
      ...v,
    })),
    most_recent_document: mostRecent && {
      public_id: mostRecent.public_id,
      path: mostRecent.path,
      doc_type: mostRecent.doc_type,
      date: mostRecent.created_at,
    },
    most_recently_updated: mostRecentlyUpdated && {
      public_id: mostRecentlyUpdated.public_id,
      path: mostRecentlyUpdated.path,
      doc_type: mostRecentlyUpdated.doc_type,
      updated_at: mostRecentlyUpdated.updated_at,
    },
  })
}

async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string, url: URL): Promise<boolean> {
  const method = req.method ?? 'GET'
  const rel = pathname.slice(API_PREFIX.length)

  if (method === 'GET' && rel === '/document-types') {
    sendJson(res, 200, {
      types: DOCUMENT_TYPES.map(({ type_name, display_name, direction, description }) => ({
        type_name,
        display_name,
        direction,
        description,
      })),
    })
    return true
  }

  const schemaMatch = rel.match(/^\/document-types\/([^/]+)\/schema$/)
  if (method === 'GET' && schemaMatch) {
    const type = findDocumentType(decodeURIComponent(schemaMatch[1]))
    if (!type) {
      notFound(res)
      return true
    }
    sendJson(res, 200, type)
    return true
  }

  if (method === 'GET' && rel === '/search/documents') {
    handleSearchDocuments(url, res)
    return true
  }

  if (method === 'GET' && rel === '/stats/overview') {
    handleStatsOverview(res)
    return true
  }

  const byFileMatch = rel.match(/^\/documents\/by-file\/([^/]+)$/)
  if (method === 'GET' && byFileMatch) {
    // `host.ts`'s mock "files" View puts the matching `MockDocument.file_id`
    // on each `File` node it constructs, so this mirrors the real
    // fileid -> document resolution `FileBrowserPage.vue`'s row click does.
    const fileId = Number(decodeURIComponent(byFileMatch[1]))
    const doc = documents.find((candidate) => candidate.file_id === fileId)
    if (!doc) {
      // Not every file has a document (the ordinary case — see
      // services/documents.ts's fetchDocumentByFileId), so this is not
      // necessarily a bug: it also covers a real 404 for an unknown id.
      notFound(res)
      return true
    }
    sendJson(res, 200, toDocumentDTO(doc))
    return true
  }

  const fieldsMatch = rel.match(/^\/documents\/([^/]+)\/fields$/)
  if (method === 'PATCH' && fieldsMatch) {
    const doc = findMutable(decodeURIComponent(fieldsMatch[1]))
    if (!doc) {
      notFound(res)
      return true
    }
    const body = await readJsonBody(req)
    Object.assign(doc.fields, body)
    doc.reviewed = true
    doc.updated_at = new Date().toISOString()
    // A hand-correction's own quality tag isn't recomputed here — this mock
    // doesn't run multi-run extraction — so the pre-edit tags are kept as-is,
    // same fallback FieldEditor.saveChanges() already has for a response with
    // no field_quality at all.
    sendJson(res, 200, { fields: doc.fields, reviewed: doc.reviewed, field_quality: doc.field_quality ?? {} })
    return true
  }

  const reprocessMatch = rel.match(/^\/documents\/([^/]+)\/reprocess$/)
  if (method === 'POST' && reprocessMatch) {
    const doc = findMutable(decodeURIComponent(reprocessMatch[1]))
    if (!doc) {
      notFound(res)
      return true
    }
    doc.status = 'processing'
    doc.updated_at = new Date().toISOString()
    scheduleAutoProgress(doc.public_id, 6_000)
    res.statusCode = 202
    res.end()
    return true
  }

  const docMatch = rel.match(/^\/documents\/([^/]+)$/)
  if (method === 'GET' && docMatch) {
    const doc = findDocument(decodeURIComponent(docMatch[1]))
    if (!doc) {
      notFound(res)
      return true
    }
    // Reads the mutable copy so GETs after a PATCH see the update.
    sendJson(res, 200, toDocumentDTO(findMutable(doc.public_id) ?? doc))
    return true
  }

  if (method === 'PATCH' && docMatch) {
    const doc = findMutable(decodeURIComponent(docMatch[1]))
    if (!doc) {
      notFound(res)
      return true
    }
    const body = await readJsonBody(req)
    if (typeof body.reviewed === 'boolean') doc.reviewed = body.reviewed
    if (typeof body.direction === 'string') doc.direction = body.direction
    if (typeof body.doc_type === 'string' && body.doc_type !== doc.doc_type) {
      doc.doc_type = body.doc_type
      doc.fields = {}
      doc.status = 'processing'
      scheduleAutoProgress(doc.public_id, 6_000)
    }
    doc.updated_at = new Date().toISOString()
    res.statusCode = 202
    res.end()
    return true
  }

  return false
}

// WebDAV: PROPFIND for services/viewerFileInfo.ts's fetchViewerFileInfo, GET
// for the Document Viewer's download-link fallback and the mock `OCA.Viewer`
// stub in host.ts. Depth:0 PROPFIND on a single resource only — this app
// never lists a DAV collection.
function davFileForPath(davPath: string): MockDocument | undefined {
  // `davPath` is home-relative (e.g. "/Momentum Demo/acme-invoice-2461.pdf");
  // fixtures store the NC-internal `/mock-user/files/...` form, matching
  // toHomeRelativePath()'s inverse.
  return documents.find((doc) => doc.path === `/${MOCK_UID}/files${davPath}`)
}

function propfindResponseXml(doc: MockDocument, href: string, mime: string, size: number): string {
  return `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
  <d:response>
    <d:href>${href}</d:href>
    <d:propstat>
      <d:prop>
        <d:getcontenttype>${mime}</d:getcontenttype>
        <d:getcontentlength>${size}</d:getcontentlength>
        <d:getetag>"mock-etag-${doc.public_id}"</d:getetag>
        <d:getlastmodified>${new Date(doc.updated_at).toUTCString()}</d:getlastmodified>
        <oc:fileid>${doc.file_id}</oc:fileid>
        <oc:permissions>RG</oc:permissions>
        <nc:has-preview>true</nc:has-preview>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`
}

async function handleDav(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  if (!pathname.startsWith(DAV_PREFIX)) return false
  const davPath = decodeURI(pathname.slice(DAV_PREFIX.length)) || '/'
  const doc = davFileForPath(davPath)
  if (!doc) {
    res.statusCode = 404
    res.end()
    return true
  }
  const file = getMockFile(doc.file_key)

  if (req.method === 'PROPFIND') {
    res.statusCode = 207
    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
    res.end(propfindResponseXml(doc, pathname, file.mime, file.bytes.length))
    return true
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    res.statusCode = 200
    res.setHeader('Content-Type', file.mime)
    res.setHeader('Content-Length', String(file.bytes.length))
    res.end(req.method === 'HEAD' ? undefined : file.bytes)
    return true
  }
  return false
}

export function mockApiMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://mock.local')
    void (async () => {
      if (url.pathname.startsWith(API_PREFIX)) {
        if (await handleApi(req, res, url.pathname, url)) return
      }
      if (url.pathname.startsWith(DAV_PREFIX)) {
        if (await handleDav(req, res, url.pathname)) return
      }
      next()
    })()
  }
}
