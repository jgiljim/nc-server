<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { listen } from '@nextcloud/notify_push'
import { getCurrentUser } from '@nextcloud/auth'
import { generateRemoteUrl } from '@nextcloud/router'
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import FieldEditor from '../components/FieldEditor.vue'
import { AlertCircleOutlineIcon, ArrowLeftIcon, CheckCircleIcon } from '../components/icons'
import { fetchDocument, fetchDocumentTypes, patchDocument } from '../services/documents'
import type { DocumentTypeDTO } from '../services/documents'
import { HttpError } from '../services/httpError'
import { PREVIEW_MOUNT_ID, getPreviewHost, releasePreviewHost } from '../services/previewHost'
import { fetchViewerFileInfo } from '../services/viewerFileInfo'
import type { ViewerFileInfo } from '../services/viewerFileInfo'
import { MOMENTUM_CONFIG } from '../config'

// frontend.md § Document Viewer & Field Editor. M4.9 laid down the split-
// panel shell; M4.10 fills in the right panel's document-type badge and
// mounts FieldEditor (which owns the field body, dirty tracking, and the
// Save Changes / Mark Reviewed actions). M4.11 adds the pending/processing
// spinner and the DOCUMENT_POLL_INTERVAL_MS poll fallback (frontend.md §
// Special status states). M4.18 layers the real-time `momentum_status`
// notify_push subscription on top of that poll — the poll remains the
// required fallback for everything the capped, terminal-only push
// intentionally omits (frontend.md § Processing status); needs_ocr / failed
// + Reprocess states are M4.12's. M68.4 turns the type badge into a
// dropdown (frontend.md § Type control): picking a new type PATCHes
// doc_type, which re-runs the full pipeline with classification skipped, so
// this reuses the same pending/processing spinner + poll fallback rather
// than adding a parallel one.
const route = useRoute()
const router = useRouter()

// The routed `:docId` (frontend.md § Page Routes) is the key every downstream
// milestone fetches against; surface it now so the shell is already wired to
// the route rather than hardcoded.
const docId = computed(() => String(route.params.docId ?? ''))

// docType isn't part of the route — it's only known once the document
// itself has loaded, so it's fetched once here and handed down to both the
// header badge and FieldEditor (which independently re-fetches the document
// for its own field values, per frontend.md § FieldEditor).
const docType = ref('')
// M151.9 (frontend.md, api.md § doc_type_source and the "Undefined"
// classification outcome) — the only thing that tells a pending, not-yet-
// classified document (`doc_type: null`, `doc_type_source: "ai"`) apart from
// an Undefined one (`doc_type: null`, `doc_type_source: "none"`): classification
// explicitly ran and found no registry type fits. Both states show a blank
// `docType`, so this has to be tracked alongside it wherever docType is read
// off a fetched document.
const docTypeSource = ref('')
const status = ref('')
const docPath = ref('')
const mimeType = ref('')
const previewFailed = ref(false)

// M165.2 (backlog Phase 165) — thin-A's 503 ("access re-verification
// unavailable", backend/internal/api/documents_handler.go's
// writeDocumentByInternalID) is the one failure loadDocType() must not leave
// as a mute spinner: keyed on the HTTP status alone (HttpError, not a message
// match) so a *different* fetch failure — network error, 404, 500 — falls
// through to the pre-existing blank state instead of claiming to be this one.
const accessUnavailable = ref(false)

// M139.1 (frontend.md § Document Viewer & Field Editor "Top bar") — the top
// bar's filename, derived from the same `path` docPath already holds rather
// than a second fetch: `api.documentDTO` has no dedicated filename field, so
// the last path segment IS the filename. `t('momentum', 'Document')` mirrors
// the mockup's own placeholder for the moment before the document has
// loaded.
const documentName = computed(() => {
  const segments = docPath.value.split('/').filter(Boolean)
  return segments.length ? segments[segments.length - 1] : t('momentum', 'Document')
})

// Mirrors FieldEditor's own `reviewed` state (its `update:reviewed` emit)
// rather than a second independent read — see that component's own comment
// for why. Drives the top bar's "Reviewed" pill only; FieldEditor's footer
// remains the one place that can change it.
const reviewed = ref(false)

// `router.back()` is ordinary browser-back — frontend.md's own History
// strategy already documents this as correct ("Navigate to document viewer |
// standard router push | Natural navigation; back returns to the list URL as
// it was"), since every route that opens this page does so via `router.push`.
// The one case that needs special-casing is a direct deep link with no
// in-app history to go back to (no dispatching list to return to at all) —
// vue-router's own history state exposes exactly that via `.back`, so this
// falls back to the landing page rather than leaving the app or doing
// nothing.
function goBack(): void {
  if (router.options.history.state.back) {
    router.back()
  } else {
    void router.push({ name: 'documents' })
  }
}

// The left panel's preview (frontend.md § Document Viewer & Field Editor —
// "Doc-Mgr implements no renderer of its own"): mounts NC's own real,
// interactive previewer (the `viewer` app's public `window.OCA.Viewer`
// surface — `@nextcloud/files` itself exposes no preview API as of the
// version this app depends on) into the `#PREVIEW_MOUNT_ID` container below
// via `setRootElement()`, rather than pointing an `<img>` at NC Core's
// `/core/preview.png` thumbnail endpoint (M21.11): on a default NC install
// with preview providers disabled, that endpoint's `forceIcon`/`mimeFallback`
// params make it return a 200-OK generic glyph instead of 404ing, so the
// `<img>`'s `@error` fallback never fired and a glyph silently stood in for
// the real document. The host previewer owns all rendering, zoom, scroll,
// and page navigation from here — Doc-Mgr implements none of it.
//
// Phase 66: the `viewer` app mounts its own Vue instance into whatever node
// `setRootElement()` names, exactly once, with no re-mount API — so the
// mount node's lifetime can't be tied to this page's own render (Vue
// destroying/recreating it on document -> document's `docPath` clear or on
// document -> list -> document's page unmount both silently kill the
// previewer for good). `previewHost.ts` owns that node at module scope
// instead; this component only adopts/releases it into an always-rendered
// wrapper element via `previewWrapperEl`.
const previewWrapperEl = ref<HTMLElement>()

// `documentDTO.path` is Nextcloud's own internal storage path
// (`Node::getPath()`'s `/<uid>/files/<relative-path>`), not a path relative
// to the user's own home the way the `viewer` app's `open({ path })` expects
// (it resolves against the acting user's own DAV root) — confirmed live,
// 2026-07-28: a real `GET /documents/{id}` returned `path:
// "/momentum-demo-user/files/Momentum Demo/acme-q1.pdf"`. The leading
// segment is always the acting user's own uid (a per-user-filtered result),
// so a generic strip works without needing the uid separately.
function toHomeRelativePath(path: string): string {
  return path.replace(/^\/[^/]+\/files(?=\/|$)/, '') || '/'
}

// M33.12: when the host previewer isn't available (the `viewer` app absent —
// the same deploy-environment-optional shape as `notify_push` — or a throw
// from setRootElement()/open()), fall back to a direct WebDAV download link
// rather than a blank pane. Reuses the exact `davRootUrl` +
// toHomeRelativePath() construction `files-entry.ts`/`momentumFilesView.ts`
// already use for the Files-app View's `File.source`, rather than the
// `/core/preview.png` thumbnail endpoint frontend.md's DocumentViewer section
// documents as unreliable (a default install with preview providers disabled
// returns a 200-OK generic glyph instead of 404ing).
const davRootUrl = generateRemoteUrl(`dav/files/${encodeURIComponent(getCurrentUser()?.uid ?? '')}`)

const downloadUrl = computed(() =>
  docPath.value ? `${davRootUrl}${toHomeRelativePath(docPath.value)}` : '',
)

// Structural type for the `viewer` app's public `window.OCA.Viewer` service
// (`nextcloud/viewer`'s `src/services/Viewer.js`) — deliberately narrower
// than its real surface (only the members this component calls), the same
// dependency-free-injection approach `files-view/momentumFilesView.ts` takes
// for `@nextcloud/files`, so this module has nothing to import/mock beyond
// the ambient `window` global.
// `mimetypes` (the flattened list of every registered handler's supported
// mime types) is undocumented in the `viewer` app's public README but is a
// real reactive property on the mounted `Viewer.vue` instance the service
// object mixes in — the same one `mimetypesRatio`-consuming apps (e.g.
// Photos) read. Optional here: if a future/older `viewer` version lacks it,
// mountPreview() below just skips the pre-check and attempts open() as
// before, so this can only add a fallback path, never remove the existing
// one.
// `availableHandlers` (Phase 121 / M121.1) is the `viewer` app's public
// getter over its registered handlers — it is what tells us *which* handler
// will render a given mime type, and therefore whether this document is
// about to be handed to richdocuments/Collabora. Optional for the same
// reason `mimetypes` is: on a `viewer` version that doesn't expose it,
// mountPreview() below just keeps the plain path-based open it used before.
// The handler id richdocuments registers itself under (its
// `src/init-viewer.js`: `{ id: 'richdocuments', … }`) — stable across every
// Nextcloud release in this app's supported range.
const RICHDOCUMENTS_HANDLER_ID = 'richdocuments'

interface NcViewerHandler {
  id: string
  mimes?: string[]
  mimesAliases?: Record<string, string>
}

interface NcViewerService {
  setRootElement(el: string): void
  open(options: { path: string } | { fileInfo: ViewerFileInfo & { isEmbedded: boolean } }): void
  close(): void
  mimetypes?: string[]
  availableHandlers?: NcViewerHandler[]
}

function getNcViewer(): NcViewerService | undefined {
  return (window as unknown as { OCA?: { Viewer?: NcViewerService } }).OCA?.Viewer
}

// Adopts (`appendChild` — a move, not a clone) the module-scoped preview
// host into this page's own always-rendered wrapper element. Idempotent:
// re-adopting an already-adopted host is a no-op DOM-wise.
function showPreviewHost(): void {
  const wrapper = previewWrapperEl.value
  if (!wrapper) return
  const preview = getPreviewHost()
  if (preview.parentElement !== wrapper) wrapper.appendChild(preview)
}

// Detaches the host from this page's wrapper without destroying it, so the
// mounted previewer instance inside it survives to be re-adopted next time
// (frontend.md § Document Viewer & Field Editor; Phase 66).
function hidePreviewHost(): void {
  releasePreviewHost()
}

// Mounts (or re-mounts, on document navigation) the host previewer into the
// long-lived preview host once `docPath` is known. `close()` first resets
// the service's internal state — `setRootElement()` throws if a file is
// already open (`Viewer.open()`'s error case in the panel below) — and
// `await nextTick()` ensures the wrapper element actually exists in the DOM
// before the host is adopted into it.
async function mountPreview(): Promise<void> {
  if (!docPath.value) {
    teardownPreview()
    return
  }
  const viewer = getNcViewer()
  if (!viewer) {
    // `viewer` may not be installed/enabled on a given NC instance — no
    // different in kind from the `notify_push` app being absent. M33.12
    // covers a richer fallback; for now this mirrors the prior "preview
    // unavailable" state rather than a blank pane.
    hidePreviewHost()
    previewFailed.value = true
    return
  }
  // Office formats (XLSX/DOCX/PPTX/ODF, etc.) have no bundled `viewer`
  // handler on a default NC install (only Collabora/OnlyOffice register
  // one) — `open()` for an unsupported mime type doesn't throw, it shows
  // its own "There is no plugin available to display this file type" toast
  // and leaves the mount container empty, so the try/catch below never
  // fires. Checking `mimetypes` up front routes that case into the same
  // "Preview unavailable" fallback as an absent/throwing viewer instead of a
  // blank pane plus a stray toast.
  if (viewer.mimetypes && mimeType.value && !viewer.mimetypes.includes(mimeType.value)) {
    hidePreviewHost()
    previewFailed.value = true
    return
  }
  // Phase 121 / M121.1 — Office documents go through the fileInfo-based open
  // so richdocuments starts Collabora in read-only "Viewing" mode; everything
  // else keeps the plain path-based open. The lookup happens before the
  // close()/setRootElement()/open() sequence so that sequence stays
  // synchronous (an `await` in the middle of it would let a fast document ->
  // document navigation interleave two half-finished opens).
  const path = toHomeRelativePath(docPath.value)
  const fileInfo = isOfficeHandled(viewer, mimeType.value)
    ? await loadReadOnlyFileInfo(path)
    : undefined
  await nextTick()
  showPreviewHost()
  try {
    viewer.close()
    viewer.setRootElement(`#${PREVIEW_MOUNT_ID}`)
    viewer.open(fileInfo ? { fileInfo } : { path })
  } catch {
    hidePreviewHost()
    previewFailed.value = true
  }
}

// Would this mime type be rendered by richdocuments' (Nextcloud Office /
// Collabora) viewer handler? Only that handler understands `isEmbedded`, and
// only it opens in an editor by default — for every other handler the extra
// prop would be meaningless, so the criterion is the handler's identity, not
// "does the mime look like an Office format".
function isOfficeHandled(viewer: NcViewerService, mime: string): boolean {
  if (!mime) return false
  const handler = viewer.availableHandlers?.find((candidate) => candidate.id === RICHDOCUMENTS_HANDLER_ID)
  if (!handler) return false
  return (
    (handler.mimes?.includes(mime) ?? false)
    || Object.keys(handler.mimesAliases ?? {}).includes(mime)
  )
}

// `isEmbedded: true` is richdocuments' own switch for "render this as an
// embedded preview": its handler passes it straight to the Office component,
// which sets the WOPI `permission=readonly` parameter from it (`forceReadOnly
// = isEmbedded && !hasWidgetEditingEnabled`) and renders a Preview/Edit
// toggle button, so a user who does want to edit is one click away rather
// than blocked. It reaches the handler because the `viewer` app renders it
// with `v-bind="currentFile"`, and `currentFile` is the fileInfo we pass
// here plus the app's own derived keys — which is why this path needs a real
// fileInfo instead of a bare path.
//
// A failed lookup is deliberately non-fatal: an editable preview is a much
// smaller defect than no preview at all, so we fall back to the path-based
// open rather than to the "Preview unavailable" pane.
async function loadReadOnlyFileInfo(
  path: string,
): Promise<(ViewerFileInfo & { isEmbedded: boolean }) | undefined> {
  try {
    return { ...(await fetchViewerFileInfo(davRootUrl, path)), isEmbedded: true }
  } catch {
    return undefined
  }
}

function teardownPreview(): void {
  getNcViewer()?.close()
  hidePreviewHost()
}

// Bumped whenever a push (or poll) tells us the document changed server-side
// so FieldEditor knows to re-fetch its own fields/reviewed state — it carries
// no field data of its own (frontend.md § Processing status: the push event
// is `{ doc_id, status, reviewed, tenant_id }` only).
const refreshToken = ref(0)

const isProcessing = computed(() => status.value === 'pending' || status.value === 'processing')

// The Undefined outcome (api.md § doc_type_source and the "Undefined"
// classification outcome) reaches `status: "done"` same as any other
// classified document — it isn't a failure, classification just found no
// registry type fits — so it's distinguished from the pending case purely by
// `doc_type_source`.
const isUndefinedType = computed(
  () => !docType.value && docTypeSource.value === 'none' && status.value === 'done',
)

// M68.4 (frontend.md § Type control) — the type badge becomes a dropdown,
// populated from GET /document-types?scope=all: the full global catalog, not
// the usage-scoped default the nav tree and Files-app View use (M83.2). A
// misclassified document usually needs correcting *to* a type the tenant has
// no documents of yet, which the usage-scoped list omits entirely.
const documentTypes = ref<DocumentTypeDTO[]>([])
const typeOptions = computed(() =>
  documentTypes.value
    .filter((type): type is DocumentTypeDTO & { type_name: string } => Boolean(type.type_name))
    .map((type) => ({ id: type.type_name, label: type.display_name ?? type.type_name })),
)
const reduceTypeOption = (option: { id: string }): string => option.id

// FieldEditor is the source of truth for its own dirty state; it re-emits so
// the dropdown here can be disabled by it (frontend.md § Type control
// "Unsaved edits block the type change" — DIRTY-STATE = BLOCK, 2026-08-11).
const fieldsDirty = ref(false)
const changingType = ref(false)

// Disabled while a re-run is already in flight (bounds how many full-pipeline
// re-runs one user can queue with no server-side rate limiter), while the
// field panel is dirty (a type change can't ride along with an unsaved field
// edit — PATCH refuses doc_type combined with reviewed/direction), or while
// this page's own change request is in flight.
const typeDropdownDisabled = computed(
  () => isProcessing.value || fieldsDirty.value || changingType.value,
)

const typeDropdownHint = computed(() => {
  if (changingType.value) return ''
  if (fieldsDirty.value) {
    return t('momentum', 'Save or discard your changes before changing the document type.')
  }
  if (isProcessing.value) {
    return t('momentum', 'Wait for the current processing run to finish before changing the type.')
  }
  if (isUndefinedType.value) {
    return t('momentum', 'No document type matched this document. Pick one to file it correctly.')
  }
  return ''
})

async function loadDocumentTypes(): Promise<void> {
  try {
    documentTypes.value = (await fetchDocumentTypes('all')) ?? []
  } catch {
    documentTypes.value = []
  }
}

// Changing the type re-runs the full pipeline with classification skipped
// (architecture.md § ⑦ step 7) — a 202, not a 204 — so this re-fetches the
// document rather than assuming the response body, and lets the existing
// pending/processing spinner + poll fallback (frontend.md § Special status
// states) carry the page through to the re-run's fields landing.
async function changeDocType(newDocType: string): Promise<void> {
  if (!docId.value || !newDocType || newDocType === docType.value || changingType.value) return
  changingType.value = true
  try {
    await patchDocument(docId.value, { doc_type: newDocType })
    // M129.2 — a 202 means the re-run is queued, so show that from the moment
    // the PATCH returns. This used to call loadDocType(), which blanks the
    // type/status and re-reads: for as long as that read was in flight the
    // page rendered the OLD type with the OLD field values and no processing
    // state, which reads as "the change was applied and then reverted" (seen
    // on a real install, Phase 129). A re-read that races the write can also
    // legitimately still report the pre-change row, so the accepted change is
    // asserted here rather than inferred from whatever comes back.
    docType.value = newDocType
    docTypeSource.value = 'user'
    status.value = 'pending'
    refreshToken.value += 1
    startPolling()
    // Re-read anyway — the row may already have moved on (the pipeline is
    // fast, and a same-type no-op PATCH leaves it `done`) — but only believe a
    // read that can see the write we just made.
    await refreshDocumentMeta(newDocType)
  } finally {
    changingType.value = false
  }
}

// loadDocType() without the reset-and-remount: same read, but it leaves the
// preview mounted (the file's bytes did not change) and never blanks the type
// or status on the way through.
async function refreshDocumentMeta(expectedDocType: string): Promise<void> {
  if (!docId.value) return
  try {
    const document = await fetchDocument(docId.value)
    // A read that still reports the pre-change type raced the write, so it
    // says nothing about the accepted change and its status is from before it
    // too. Discarding it is the whole point: applying it is what made the page
    // flash back to the old type as though the change had been reverted. The
    // poll re-reads on its own tick, by which time the write is visible.
    if (document.doc_type !== expectedDocType) return
    status.value = document.status ?? status.value
  } catch {
    // Keep what the accepted PATCH already told us; the poll will correct it.
  }
}

// `@nextcloud/notify_push`'s `listen()` has no unsubscribe — this flag makes
// the handler a no-op after unmount instead of updating a torn-down view's
// refs (see onUnmounted below).
let disposed = false

let pollTimer: ReturnType<typeof setInterval> | undefined

// M129.2 (frontend.md § Special status states) — the wait for a terminal
// status is bounded. A re-run whose job dead-letters leaves the document
// `pending` for ever (Phase 129), and the poll had no budget: it kept asking,
// and the panel kept showing "Reprocessing this document…", with nothing able
// to end either. When the budget runs out the poll stops and the panel is told,
// which is all the client can honestly say — it never sees the job's outcome.
// Counted in ticks rather than against a wall clock so it cannot drift with the
// interval or depend on Date under a test's fake timers.
const processingStalled = ref(false)
const POLL_TICKS_BEFORE_STALLED = Math.max(
  1,
  Math.ceil(
    MOMENTUM_CONFIG.DOCUMENT_PROCESSING_TIMEOUT_MS / MOMENTUM_CONFIG.DOCUMENT_POLL_INTERVAL_MS,
  ),
)
let pollTicks = 0

function stopPolling(): void {
  if (pollTimer === undefined) return
  clearInterval(pollTimer)
  pollTimer = undefined
}

function startPolling(): void {
  stopPolling()
  pollTicks = 0
  processingStalled.value = false
  pollTimer = setInterval(async () => {
    if (!docId.value) return
    try {
      const document = await fetchDocument(docId.value)
      docType.value = document.doc_type ?? ''
      docTypeSource.value = document.doc_type_source ?? ''
      status.value = document.status ?? ''
    } catch {
      // Transient fetch failures don't stop the poll — it's the fallback
      // path, so it keeps retrying on the next tick (frontend.md § Special
      // status states).
    }
    if (!isProcessing.value) {
      stopPolling()
      // Mirrors handleStatusPush()'s bump: the poll is the required fallback
      // for the terminal transition a capped/absent notify_push channel can
      // miss (frontend.md § Processing status) — without this, FieldEditor
      // never re-fetches once the poll (rather than a push) is what learns
      // the reprocess finished, and stays stuck showing "Reprocessing this
      // document…" indefinitely even though the header's own spinner clears.
      refreshToken.value += 1
      return
    }
    pollTicks += 1
    if (pollTicks >= POLL_TICKS_BEFORE_STALLED) {
      stopPolling()
      processingStalled.value = true
    }
  }, MOMENTUM_CONFIG.DOCUMENT_POLL_INTERVAL_MS)
}

// The way out of the stalled state: read the document once now, and — if it is
// still not terminal — start a fresh budget rather than leaving the user with a
// dead panel and a reload as their only option.
async function recheckProcessing(): Promise<void> {
  if (!docId.value) return
  processingStalled.value = false
  try {
    const document = await fetchDocument(docId.value)
    docType.value = document.doc_type ?? ''
    docTypeSource.value = document.doc_type_source ?? ''
    status.value = document.status ?? ''
  } catch {
    // Same reasoning as the poll's own catch: a transient failure is not an
    // answer, so fall through and let the resumed poll ask again.
  }
  refreshToken.value += 1
  if (isProcessing.value) startPolling()
}

async function loadDocType(): Promise<void> {
  stopPolling()
  teardownPreview()
  docType.value = ''
  docTypeSource.value = ''
  status.value = ''
  docPath.value = ''
  mimeType.value = ''
  previewFailed.value = false
  accessUnavailable.value = false
  if (!docId.value) return
  try {
    const document = await fetchDocument(docId.value)
    docType.value = document.doc_type ?? ''
    docTypeSource.value = document.doc_type_source ?? ''
    status.value = document.status ?? ''
    docPath.value = document.path ?? ''
    mimeType.value = document.mime_type ?? ''
  } catch (err) {
    docType.value = ''
    docTypeSource.value = ''
    status.value = ''
    if (err instanceof HttpError && err.status === 503) {
      accessUnavailable.value = true
      return
    }
  }
  if (isProcessing.value) startPolling()
  await mountPreview()
}

// Terminal transitions and reviewed toggles arrive here in real time
// (frontend.md § Processing status); non-terminal progress, viewers beyond
// the recipient cap, and push-channel outages still rely on the poll above.
function handleStatusPush(_name: string, body: unknown): void {
  if (disposed) return
  const event = body as { doc_id?: string | number; status?: string } | null | undefined
  if (!event || event.doc_id === undefined || String(event.doc_id) !== docId.value) return
  if (event.status) status.value = event.status
  if (!isProcessing.value) stopPolling()
  refreshToken.value += 1
}

// Phase 67 (M67.1): the `viewer` app's own stylesheet ships
// `body:has(#viewer) #header{visibility:hidden}` for its normal full-screen
// overlay mode (opened from the Files app) — correct there, wrong here,
// since this page embeds the same previewer in a panel instead
// (frontend.md § Document Viewer & Field Editor) rather than replacing the
// whole shell. The rule keys off the mere presence of a `#viewer` node, not
// off overlay-vs-embedded mode, so it fires here too and hides the whole NC
// header for as long as a document is open. Countering it unconditionally
// in this app's own CSS would also un-hide the header for the Files app's
// real overlay use, so the counter-rule below is additionally scoped to a
// body class this page owns the lifetime of — present only while this page
// is mounted, which is exactly when Doc-Mgr's embedded (non-overlay) case
// can apply.
const EMBEDDED_PREVIEW_BODY_CLASS = 'momentum-embedded-preview'

onMounted(() => {
  document.body.classList.add(EMBEDDED_PREVIEW_BODY_CLASS)
  listen(MOMENTUM_CONFIG.MOMENTUM_STATUS_PUSH_EVENT, handleStatusPush)
  loadDocType()
  loadDocumentTypes()
})
watch(docId, loadDocType)
onUnmounted(() => {
  disposed = true
  stopPolling()
  teardownPreview()
  document.body.classList.remove(EMBEDDED_PREVIEW_BODY_CLASS)
})
</script>

<template>
  <div class="momentum-page momentum-document-viewer">
    <!-- Top bar (M139.1, frontend.md § Document Viewer & Field Editor "Top
         bar"): Back + filename + Reviewed pill, spanning both panels below,
         matching specs/mockup-ai-document-manager.html's `.viewer-topbar`. -->
    <header class="momentum-document-viewer__topbar" data-testid="document-viewer-topbar">
      <NcButton
        variant="tertiary"
        :aria-label="t('momentum', 'Back')"
        data-testid="document-viewer-back"
        @click="goBack"
      >
        <template #icon>
          <ArrowLeftIcon :size="20" />
        </template>
      </NcButton>
      <h1 class="momentum-document-viewer__title" data-testid="document-viewer-title">
        {{ documentName }}
      </h1>
      <span
        v-if="reviewed"
        class="momentum-document-viewer__reviewed-pill"
        data-testid="document-viewer-reviewed-pill"
      >
        <CheckCircleIcon :size="14" />
        {{ t('momentum', 'Reviewed') }}
      </span>
    </header>

    <!-- frontend.md § getContents() already establishes the pattern for a
         Doc-Mgr API failure: an inline banner, not a mute spinner. thin-A's
         503 gets the same treatment here (M165.2) — the spinner is gone
         entirely (this replaces the whole content area, it doesn't sit
         alongside a still-running one), and the reason is specific to this
         failure so it isn't mistaken for a missing document or a generic
         network error. -->
    <NcEmptyContent
      v-if="accessUnavailable"
      data-testid="access-unavailable-message"
      :name="t('momentum', 'Document access could not be re-verified')"
      :description="
        t(
          'momentum',
          'Nextcloud did not confirm access to this document in time. Try again in a moment.',
        )
      "
    >
      <template #icon>
        <AlertCircleOutlineIcon :size="64" />
      </template>
      <template #action>
        <NcButton data-testid="access-unavailable-retry" @click="loadDocType">
          {{ t('momentum', 'Retry') }}
        </NcButton>
      </template>
    </NcEmptyContent>
    <div v-else class="momentum-page--document-viewer">
      <!-- Left panel: the host NC previewer, mounted in place by
           mountPreview() (Doc-Mgr implements no renderer of its own). -->
      <section class="momentum-document-viewer__preview" aria-label="Document preview">
        <!-- Always rendered — never `v-if`-toggled — so this wrapper element
             itself is never destroyed/recreated by Vue. The actual previewer
             host node (`#momentum-document-viewer-preview-mount`, owned by
             `previewHost.ts`) is adopted into it imperatively by
             `showPreviewHost()`/`hidePreviewHost()`; toggling visibility with
             `v-show` instead of `v-if` keeps this wrapper — and therefore the
             adopted host inside it — out of any removed subtree (Phase 66). -->
        <div
          ref="previewWrapperEl"
          v-show="docPath && !previewFailed"
          class="momentum-document-viewer__preview-mount-wrapper"
        />
        <p v-if="previewFailed" data-testid="preview-unavailable" class="momentum-document-viewer__preview-fallback">
          {{ t('momentum', 'Preview unavailable.') }}
          <a
            v-if="downloadUrl"
            data-testid="preview-download-link"
            :href="downloadUrl"
            target="_blank"
            rel="noopener noreferrer"
          >{{ t('momentum', 'Download to view') }}</a>
        </p>
      </section>

      <!-- Right panel: the type-driven field editor. -->
      <section class="momentum-document-viewer__editor" :data-doc-id="docId">
        <header class="momentum-document-viewer__header">
          <NcSelect
            v-if="docType || isUndefinedType"
            data-testid="doc-type-select"
            class="momentum-document-viewer__type-select"
            :class="{ 'momentum-document-viewer__type-select--undefined': isUndefinedType }"
            :model-value="docType"
            :options="typeOptions"
            :reduce="reduceTypeOption"
            :clearable="false"
            :disabled="typeDropdownDisabled"
            :append-to-body="false"
            :input-label="t('momentum', 'Document type')"
            :placeholder="isUndefinedType ? t('momentum', 'Undefined') : undefined"
            @update:model-value="changeDocType"
          />
          <NcLoadingIcon
            v-if="isProcessing && !processingStalled"
            data-testid="processing-spinner"
            :size="20"
            class="momentum-document-viewer__status-spinner"
          />
          <p v-if="typeDropdownHint" data-testid="doc-type-hint" class="momentum-document-viewer__type-hint">
            {{ typeDropdownHint }}
          </p>
        </header>
        <p class="momentum-document-viewer__type-carryover-note">
          {{
            t(
              'momentum',
              'Changing the document type reprocesses this document. Fields you already corrected by hand are kept when the new type still has them.',
            )
          }}
        </p>

        <!-- FieldEditor owns the scrollable field body and the sticky action
             footer (frontend.md § FieldEditor). -->
        <FieldEditor
          :doc-id="docId"
          :doc-type="docType"
          :doc-type-source="docTypeSource"
          :refresh-token="refreshToken"
          :processing-stalled="processingStalled"
          @update:dirty="(value) => (fieldsDirty = value)"
          @update:reviewed="(value) => (reviewed = value)"
          @recheck="recheckProcessing"
        />
      </section>
    </div>
  </div>
</template>

<style scoped>
/* Column stack: top bar, then the 50/50 split panels below — full available
   viewport height, no wasted vertical space (frontend.md § Document Viewer &
   Field Editor). */
.momentum-document-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.momentum-document-viewer__topbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 0 0 auto;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--color-border);
}

.momentum-document-viewer__title {
  margin: 0;
  font-size: var(--default-font-size, 1rem);
  font-weight: bold;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* specs/mockup-ai-document-manager.html's `.dd-reviewed-pill` — aliased onto
   the real NC `--color-success` token per CLAUDE.md's design-token rule,
   same reasoning FieldEditor's own `.momentum-field-editor__summary` callout
   already uses for `--color-primary-element`. */
.momentum-document-viewer__reviewed-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  flex-shrink: 0;
  padding: 0.2rem 0.6rem;
  border-radius: var(--border-radius-pill, 16px);
  background-color: color-mix(in srgb, var(--color-success) 14%, var(--color-main-background));
  color: var(--color-success);
  font-size: var(--fs-badge, 0.8rem);
  font-weight: bold;
}

.momentum-page--document-viewer {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}

.momentum-document-viewer__preview,
.momentum-document-viewer__editor {
  flex: 1 1 50%;
  min-width: 0;
  min-height: 0;
}

.momentum-document-viewer__preview {
  display: flex;
  align-items: center;
  justify-content: center;
  /* Reserve NcAppContent's collapse-navigation toggle footprint (a
     --default-clickable-area square in the content pane's top-left corner —
     backlog Phase 75 / M75.1): this panel is the page's top-left-most
     content, so the reserve goes on its corner directly rather than on the
     page container, which would also shift the editor panel beside it. */
  padding-inline-start: var(--default-clickable-area, 44px);
  padding-block-start: var(--default-clickable-area, 44px);
  /* `overflow: hidden`, not `auto` — the mounted previewer (or the `viewer`
     app's own internal PDF.js scroll area) is the only thing that should
     ever scroll here. This panel merely clips; giving it its own
     `overflow: auto` on top of the previewer's built-in scrolling produced
     two adjacent vertical scrollbars for one scroll region. */
  overflow: hidden;
  background-color: var(--color-background-dark);
  /* The `viewer` app's own modal chrome is `position: fixed` (it's built to
     be a full-viewport overlay); `setRootElement()` only changes which DOM
     node it mounts into, not that CSS. `contain: layout` makes this panel a
     containing block for fixed-position descendants (CSS Containment §2),
     so the mounted previewer fills this panel instead of the whole page and
     covering the field editor next to it. */
  contain: layout;
  position: relative;
}

.momentum-document-viewer__preview-mount-wrapper {
  width: 100%;
  height: 100%;
}

.momentum-document-viewer__preview-fallback {
  color: var(--color-text-maxcontrast);
}

/* The editor panel is a header / scrollable body / sticky footer stack. */
.momentum-document-viewer__editor {
  display: flex;
  flex-direction: column;
}

.momentum-document-viewer__header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.momentum-document-viewer__type-select {
  min-width: 200px;
}

/* M151.9 — the Undefined outcome's placeholder text reads as a state, not a
   choice: same tokened warning color the type-hint paragraph below already
   uses for "something needs your attention" copy, applied here to the
   vue-select placeholder rather than to disabled/muted grey. */
.momentum-document-viewer__type-select--undefined :deep(.vs__search::placeholder) {
  color: var(--color-warning, #e9a63f);
  font-weight: bold;
  opacity: 1;
}

/* `.type-hint` is a flex item inside `.momentum-document-viewer__header`
   (row-direction flex), where `flex-basis: 100%` is along the horizontal
   main axis — it correctly forces the hint onto its own full-width wrapped
   line. `.type-carryover-note` is NOT inside that header — it's a sibling
   flex item of `.momentum-document-viewer__editor` (column-direction flex),
   where `flex-basis` is measured along the VERTICAL main axis instead, so
   the same `100%` value made this paragraph claim the full height of the
   column — the real cause of the "huge white space" report M141.1 mistook
   for `.momentum-document-viewer__fields`'s `flex-grow` (that fix was real
   but for a different element; this one was still present after it shipped,
   confirmed live via the inspector: `p.momentum-document-viewer__type
   -carryover-note` computed at 908x447px, all but a couple of those 447px
   empty). Split so `flex-basis: 100%` only applies where its axis actually
   means "full width". */
.momentum-document-viewer__type-hint {
  flex-basis: 100%;
}

.momentum-document-viewer__type-hint,
.momentum-document-viewer__type-carryover-note {
  margin: 0;
  color: var(--color-text-maxcontrast);
  font-size: 0.85em;
}

/* M132.1 wrapped the field list in a closed-by-default disclosure with its
   own self-contained scroll region (FieldEditor.vue's
   .momentum-field-editor__fields-scroll, a fixed max-height) — this panel no
   longer needs to BE the scrollable region by default, and no longer should
   be. `flex: 1 1 auto` here (flex-grow: 1) forced it to stretch and fill all
   remaining column height regardless of its (now much shorter,
   collapsed-by-default) visible content, producing a large empty gap above
   the footer that grew/shrank with the viewport's height — the "huge white
   space" bug (M141.1). `flex-grow: 0` sizes it to its own content instead —
   any leftover panel height is now just blank background below the footer,
   not a forced gap above it — while `flex-shrink: 1` plus `overflow-y: auto`
   are kept so a genuinely tall combination (a long AI summary plus an
   EXPANDED disclosure) still scrolls internally rather than pushing the
   footer off the bottom of a short viewport. */
.momentum-document-viewer__fields {
  flex: 0 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.momentum-document-viewer__actions {
  flex: 0 0 auto;
}
</style>

<!-- Deliberately global, not `scoped`: `#header` lives outside this
     component's own subtree, so a `scoped` (data-v-attributed) selector
     could never reach it. Scoping instead comes from the
     `body.momentum-embedded-preview` class this component adds/removes in
     onMounted/onUnmounted above, which is only ever present while this page
     is on screen — see the comment there for why the `viewer` app's own
     `body:has(#viewer) #header{visibility:hidden}` needs countering here
     specifically, and only here (backlog Phase 67 / M67.1). -->
<style>
body.momentum-embedded-preview:has(#viewer) #header {
  visibility: visible !important;
}

/* Phase 67 (M67.2): the `viewer` app sets its mounted iframe's `inset` to
   `0px 0px -50px` — its own header's height — because in its normal
   full-screen overlay mode (opened from the Files app) it expects to have
   hidden `#header` and offsets past the bottom of the (now header-less)
   viewport by exactly that amount. Doc-Mgr's panel never included the
   header's space to begin with (frontend.md's 50/50 split starts below it,
   same as every other Momentum view — see backlog Phase 67), so that
   compensation is wrong here regardless of whether `#header` ends up
   visible or hidden: the intended visible area is simply "fill this
   panel", nothing more. The decision is to fill the panel exactly (inset:
   0 on every side) rather than adjust the -50px to some other number.
   Deliberately not `scoped`: this iframe is created at runtime by the
   `viewer` app's own script, not rendered by this component's template, so
   it carries no `data-v-*` attribute for a scoped selector to match.
   Scoping instead comes from the ancestor class selector below, which only
   ever matches inside this page's own preview panel — no body-class gate
   needed, and no risk of leaking into the Files app's real overlay
   previewer, which never has an ancestor `.momentum-document-viewer__preview`.
   `!important` is required to beat the inline `style.inset` the `viewer`
   app sets directly on the element (same technique as the header-visibility
   rule above). */
.momentum-document-viewer__preview iframe {
  inset: 0 !important;
}

/* Phase 121 (M121.1): asking richdocuments for its embedded (read-only)
   rendering also opts into its `.office-viewer__embedding` sizing —
   `min-height: min(50vh, 100vh - 120px)` / `max-height: calc(100vh - 120px)`,
   both `!important`. Those numbers are written for its reference-widget
   embedding (a card inside a Talk/Text message, sized against the viewport),
   not for a panel that already has a height: this panel starts below the
   Nextcloud header, so a viewport-relative cap leaves a dead strip at the
   bottom of it. Neutralising the cap restores exactly the sizing every
   non-Office preview in this panel already gets — fill the panel — rather
   than substituting a different magic number. Same non-`scoped`/ancestor-
   scoped reasoning as the iframe rule above: the element is created by the
   host app's script, and `.momentum-document-viewer__preview` never matches
   inside the Files app's own overlay previewer. */
.momentum-document-viewer__preview .office-viewer__embedding {
  height: 100%;
  min-height: 0 !important;
  max-height: none !important;
}

/* M139.1's topbar Back button sits at the content area's top-left, exactly
   where `@nextcloud/vue`'s `NcAppNavigation` floats its own collapse/expand
   toggle (`.app-navigation-toggle-wrapper`, `NcAppNavigation.vue`:
   `position: absolute; top: var(--app-navigation-padding)` — pinned to the
   sidebar's top-right corner, which is the content area's top-left corner)
   — the two controls render on top of each other. Pushed down below the
   topbar's own footprint instead of hidden: collapsing the nav sidebar is
   still a real, needed control on this page (unlike `.app-menu__waffle` in
   app-chrome.css, which is safe to remove outright because it only reopens
   a menu this app already hides). The offset is topbar padding (top+bottom)
   plus the Back button's own clickable area, expressed via NC's own token
   rather than a guessed pixel value (CLAUDE.md § Design tokens) so it tracks
   the button's real rendered height instead of drifting from it. Deliberately
   not `scoped`, same reasoning as the iframe/office-viewer rules above: the
   toggle is rendered by `NcAppNavigation`, an ancestor outside this
   component's own template, so a scoped selector could never match it.
   Phase 174 (M174.1): this rule used to be a bare `.app-navigation-toggle-
   wrapper` selector, which — because this app has no route-level CSS at all
   (`vite.config.ts`'s `iife` build injects every component's `<style>` block
   globally on page load, not per-route) — pushed the toggle down on every
   route, not just this one, landing it on top of `.momentum-page__item-count`
   on the file browser and other list routes. Anchored to
   `body.momentum-embedded-preview`, the class this component's own
   onMounted/onUnmounted already own the lifetime of (see the `#header`
   counter-rule above) and which is therefore present exactly while this page,
   and only this page, is on screen — restoring NC's own unoffset position
   everywhere else. The invariant this establishes: a non-`scoped` block is
   fine, but every selector inside one must be anchored to an app-owned
   ancestor, never left bare. */
body.momentum-embedded-preview .app-navigation-toggle-wrapper {
  top: calc(1rem + var(--default-clickable-area, 44px)) !important;
}
</style>
