// Host-side half of the IonosGPT sidepanel/NL-query embed (frontend.md §
// AI Chat Integration; requirements.md F9). The IonosGPT-side embed-mode
// layout and MCP client are an external dependency (the IonosGPT team's
// deliverable) — this module only mounts the iframe on our side and injects
// navigation context into it, both via the URL (frontend.md § Iframe
// Embedding) and via postMessage after load (frontend.md § Context
// injection via postMessage), so IonosGPT has context on first paint and on
// every subsequent navigation without a remount.

export const GPT_BASE_URL = 'https://gpt.ionos.com'
export const GPT_ORIGIN = new URL(GPT_BASE_URL).origin

const CONTEXT_MESSAGE_TYPE = 'momentum:context'

export type EmbedContextMode = 'document' | 'folder' | 'corpus'

export interface EmbedContext {
  mode: EmbedContextMode
  doc_id?: string
  doc_type?: string
  file_name?: string
  folder_path?: string
  tenant_id?: string
}

export function buildEmbedUrl(context?: EmbedContext): string {
  const url = new URL('/chat', GPT_BASE_URL)
  url.searchParams.set('agent', 'filo')
  url.searchParams.set('embed', 'true')
  if (context) {
    url.searchParams.set('context', JSON.stringify(context))
  }
  return url.toString()
}

export function postEmbedContext(iframe: HTMLIFrameElement, context: EmbedContext): void {
  iframe.contentWindow?.postMessage({ type: CONTEXT_MESSAGE_TYPE, payload: context }, GPT_ORIGIN)
}

export interface IonosGptEmbedHandle {
  iframe: HTMLIFrameElement
  updateContext(context: EmbedContext): void
  destroy(): void
}

/**
 * Mounts the IonosGPT iframe into `container` and, once it loads, injects
 * `context` via postMessage (frontend.md's `registerSidebarTab` example).
 * `updateContext` re-injects without remounting — for callers (e.g. the
 * Ask AI sidebar tab, M4.16) that keep one iframe alive across navigation.
 */
export function mountIonosGptEmbed(
  container: HTMLElement,
  context?: EmbedContext,
): IonosGptEmbedHandle {
  const iframe = document.createElement('iframe')
  iframe.className = 'momentum-ionosgpt-embed'
  iframe.setAttribute('allow', 'clipboard-write')
  iframe.src = buildEmbedUrl(context)

  const handleLoad = () => {
    if (context) postEmbedContext(iframe, context)
  }
  iframe.addEventListener('load', handleLoad)

  container.appendChild(iframe)

  return {
    iframe,
    updateContext(nextContext: EmbedContext) {
      postEmbedContext(iframe, nextContext)
    },
    destroy() {
      iframe.removeEventListener('load', handleLoad)
      iframe.remove()
    },
  }
}
