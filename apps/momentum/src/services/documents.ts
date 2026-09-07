import { getRequestToken } from '@nextcloud/auth'
import { generateUrl } from '@nextcloud/router'
import type { components } from '../../../frontend/src/api/schema'
import type { ActiveFilter, SortState } from '../types'

// M4.1 note (backlog/v1.md): API calls go through the app's own PHP-proxied
// `/apps/momentum/api/*` routes, not a direct cross-origin client to the Go
// backend — but the generated schema.d.ts request/response shapes are still
// reused for typing (frontend.md § API Bindings Summary).
//
// `generateUrl`, not a bare path: without mod_rewrite the routes live under
// `/index.php/apps/momentum/api/*`, so every plain-path fetch here 404'd
// (`/apps/momentum/api/document-types responded with 404`, seen live in the
// browser console). `momentumFilesView.ts` already routes its own calls to
// the same API through `generateUrl`.
const API_BASE = generateUrl('/apps/momentum/api')

export type DocumentTypeSchema = components['schemas']['api.documentTypeSchemaResponse']
export type DocumentDTO = components['schemas']['api.documentDTO']
export type PatchFieldsResponse = components['schemas']['api.patchFieldsResponse']
export type DocumentPatchRequest = components['schemas']['documents.PatchRequest']
export type DocumentTypeDTO = components['schemas']['api.documentTypeDTO']
export type StatsOverviewResponse = components['schemas']['api.statsOverviewResponse']
export type TypeStatsDTO = components['schemas']['api.typeStatsDTO']
export type MostRecentDocumentDTO = components['schemas']['api.mostRecentDocumentDTO']
export type MostRecentlyUpdatedDocumentDTO = components['schemas']['api.mostRecentlyUpdatedDocumentDTO']
export type SearchItemDTO = components['schemas']['api.searchItemDTO']
export type SearchDocumentsResponse = components['schemas']['api.searchDocumentsResponse']

// Not re-exported from here on purpose — see httpError.ts's own comment:
// callers that `vi.mock('../services/documents')` would get an automocked,
// constructor-stripped `HttpError` if it were, so both production code and
// tests import it from `./httpError` directly.
import { HttpError } from './httpError'

// ApiProxyController::patchDocument()/patchDocumentFields()/reprocessDocument()
// deliberately leave NC's CSRF protection enabled, on the assumption every
// caller goes through `@nextcloud/axios` (which attaches `requesttoken`
// automatically, `client.js`'s `getCancelableClient()`) — but this module
// uses plain `fetch`, which sends no such header. Every mutating call was
// failing CSRF validation with a 412 ("CSRF check failed") that surfaced as
// an unhandled promise rejection (e.g. the Document Viewer's type dropdown).
// Attaching the same header `@nextcloud/axios` would have is the fix; GET
// requests (all `#[NoCSRFRequired]`) ignore it harmlessly.
async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      requesttoken: getRequestToken() ?? '',
      ...(init?.headers ?? {}),
    },
  })
  if (!response.ok) {
    throw new HttpError(response.status, path)
  }
  if (response.status === 204 || response.status === 202) {
    return undefined as T
  }
  return (await response.json()) as T
}

// frontend.md § Opening a file (M127.3) — resolve a Nextcloud fileId to its
// document, so a click on a row in the file browser can open the document split
// view. `undefined` means "this file has no document", which is the ordinary
// answer for most files in an account (never ingested, or still pending) and is
// NOT an error: only a 404 maps to it, so a network failure or a 5xx still
// throws and the page can say so rather than silently degrading.
export async function fetchDocumentByFileId(fileId: number): Promise<DocumentDTO | undefined> {
  const response = await fetch(`${API_BASE}/documents/by-file/${encodeURIComponent(String(fileId))}`, {
    headers: { 'Content-Type': 'application/json', requesttoken: getRequestToken() ?? '' },
  })
  if (response.status === 404) return undefined
  if (!response.ok) {
    throw new Error(`documents/by-file responded with ${response.status}`)
  }
  return (await response.json()) as DocumentDTO
}

export function fetchDocumentTypeSchema(typeName: string): Promise<DocumentTypeSchema> {
  return requestJson(`${API_BASE}/document-types/${encodeURIComponent(typeName)}/schema`)
}

// M177.1 (backlog/v1.md) — DocumentViewerPage's own loadDocType() and
// FieldEditor's load() each independently call fetchDocument() on mount, and
// Vue mounts a child (FieldEditor) before its parent's onMounted runs, so
// both fire before either's fetch resolves — measured live as two identical
// `GET .../documents/<id>` requests, 66 ms apart, not the serial pair an
// earlier reading of this phase assumed. Coalescing concurrent calls for the
// same docId into the one in-flight request removes the duplicate without
// either caller needing to know about the other. Once the shared promise
// settles (success or failure) it is removed from the map, so a later call —
// the processing poll's next tick, or FieldEditor's refreshToken-triggered
// refetch — still issues a fresh request rather than replaying a stale one.
const inFlightDocumentFetches = new Map<string, Promise<DocumentDTO>>()

export function fetchDocument(docId: string): Promise<DocumentDTO> {
  const inFlight = inFlightDocumentFetches.get(docId)
  if (inFlight) return inFlight
  const request = requestJson<DocumentDTO>(`${API_BASE}/documents/${encodeURIComponent(docId)}`).finally(
    () => {
      inFlightDocumentFetches.delete(docId)
    },
  )
  inFlightDocumentFetches.set(docId, request)
  return request
}

// frontend.md § Navigation Tree Additions / § AI Filing — the type registry
// (used to render a row per type, including types with zero documents, which
// GET /stats/overview's per-type breakdown omits entirely).
//
// The default is the tenant's usage-scoped list (types at least one document
// has been classified as, db.md § Per-tenant type scoping (G14)) — what the
// nav tree, the Files-app View, and the AI Filing dashboard all want. Only
// the Document Viewer's doc_type correction control passes `'all'`, for the
// full global catalog: the type needed to fix a misclassification often has
// zero documents precisely because the classifier never picks it, so the
// usage-scoped list omits exactly the option the user came for (frontend.md §
// Type control; api.md § GET /document-types, M83.2).
export function fetchDocumentTypes(scope?: 'classified' | 'all'): Promise<DocumentTypeDTO[]> {
  const query = scope === 'all' ? '?scope=all' : ''
  return requestJson<{ types?: DocumentTypeDTO[] }>(`${API_BASE}/document-types${query}`).then(
    (response) => response.types ?? [],
  )
}

// frontend.md § AI Filing — aggregated per-type counts for the dashboard.
export function fetchStatsOverview(): Promise<StatsOverviewResponse> {
  return requestJson(`${API_BASE}/stats/overview`)
}

export function patchDocumentFields(
  docId: string,
  fields: Record<string, unknown>,
): Promise<PatchFieldsResponse> {
  return requestJson(`${API_BASE}/documents/${encodeURIComponent(docId)}/fields`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  })
}

export function patchDocument(docId: string, patch: DocumentPatchRequest): Promise<void> {
  return requestJson(`${API_BASE}/documents/${encodeURIComponent(docId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export interface SearchDocumentsParams {
  // Omit for the cross-type (Recent Documents, M4.8) view (api.md §
  // GET /search/documents: "Omit for cross-type (recent) view").
  typeName?: string
  sort: SortState
  filters: ActiveFilter[]
  cursor?: string
}

// Builds the `GET /search/documents` query string shared by the By-Type List
// (M4.7) and Recent Documents (M4.8) pages' `DocumentList.fetchPage`
// implementations. `ActiveFilter`'s `search`-kind entries (TypeaheadSearch
// commits, M34.8) map to the `q=` full-text search param (api.md); multiple
// committed search pills (frontend.md § TypeaheadSearch: "Multiple search
// terms coexist as separate pills") join into that single term with a space,
// which `websearch_to_tsquery` treats as an AND of both. `q=` is combined
// with any `f=` field filters via AND, but never with an explicit `sort=` or
// `cursor` — full-text results rank by relevance and are first-page-only
// (backend/internal/documents/search.go's ValidateFullTextQuery rejects the
// combination with a 400), so both are omitted from the request whenever a
// search term is active, regardless of the caller's requested sort/cursor.
function buildSearchQuery(params: SearchDocumentsParams): string {
  const query = new URLSearchParams()
  if (params.typeName) query.set('type_name', params.typeName)
  for (const filter of params.filters) {
    if (filter.kind !== 'field') continue
    query.append('f', `${filter.field_name}:${filter.operator}:${String(filter.value)}`)
  }
  const searchTerm = params.filters
    .filter((filter) => filter.kind === 'search')
    .map((filter) => filter.term)
    .join(' ')
  if (searchTerm) {
    query.set('q', searchTerm)
  } else {
    query.set('sort', `${params.sort.column}:${params.sort.direction}`)
    if (params.cursor) query.set('cursor', params.cursor)
  }
  return query.toString()
}

export function fetchSearchDocuments(params: SearchDocumentsParams): Promise<SearchDocumentsResponse> {
  return requestJson(`${API_BASE}/search/documents?${buildSearchQuery(params)}`)
}

// frontend.md § Special status states — `failed` documents offer a Reprocess
// button that hits M2.10's endpoint; it's rate-limited server-side and
// rejects needs_ocr documents (known v1 limitation), not something the
// client needs to pre-check.
export function reprocessDocument(docId: string): Promise<void> {
  return requestJson(`${API_BASE}/documents/${encodeURIComponent(docId)}/reprocess`, {
    method: 'POST',
  })
}
