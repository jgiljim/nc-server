// Module-scoped (not per-component — a `let` inside a `<script setup>` block
// is per-component-instance, since that block compiles into `setup()`) home
// for the host previewer's mount node. `DocumentViewerPage`'s own `v-if`/
// unmount churn was destroying and recreating
// `#momentum-document-viewer-preview-mount` on every document navigation;
// the `viewer` app mounts its own Vue instance into that node exactly once
// and exposes no re-mount, so once the node was gone the previewer was gone
// with it (backlog Phase 66). Owning the node's lifetime here — created
// lazily, once, for the lifetime of the page load — means Vue never creates
// or destroys it, so the previewer instance survives every navigation.
export const PREVIEW_MOUNT_ID = 'momentum-document-viewer-preview-mount'

let host: HTMLDivElement | undefined

// Returns the single preview host element, creating it on first call. The
// same element is returned on every subsequent call for the lifetime of the
// page load — callers adopt it into their own subtree with `appendChild`
// (a move, not a clone) rather than letting Vue render/destroy it.
export function getPreviewHost(): HTMLDivElement {
  if (!host) {
    host = document.createElement('div')
    host.id = PREVIEW_MOUNT_ID
    host.className = 'momentum-document-viewer__preview-mount'
    host.style.width = '100%'
    host.style.height = '100%'
  }
  return host
}

// Detaches the host from whatever parent it's currently adopted into,
// without destroying it, so it can be re-adopted by the next page instance
// (or the same page after a document -> document navigation) with the
// previewer instance mounted inside it left intact.
export function releasePreviewHost(): void {
  host?.parentElement?.removeChild(host)
}
