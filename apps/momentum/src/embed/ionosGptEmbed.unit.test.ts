import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildEmbedUrl,
  GPT_ORIGIN,
  mountIonosGptEmbed,
  postEmbedContext,
} from './ionosGptEmbed'

// frontend.md § Iframe Embedding + § Context injection via postMessage;
// requirements.md F9 ("Context injection at mount time").

describe('buildEmbedUrl', () => {
  it('pre-selects the Filo agent and enables embed mode with no context', () => {
    const url = new URL(buildEmbedUrl())

    expect(url.origin).toBe(GPT_ORIGIN)
    expect(url.pathname).toBe('/chat')
    expect(url.searchParams.get('agent')).toBe('filo')
    expect(url.searchParams.get('embed')).toBe('true')
    expect(url.searchParams.has('context')).toBe(false)
  })

  it('JSON-encodes the context object into the context param', () => {
    const context = { mode: 'document' as const, doc_id: '12345', file_name: 'acme.pdf' }
    const url = new URL(buildEmbedUrl(context))

    expect(JSON.parse(url.searchParams.get('context') ?? '')).toEqual(context)
  })
})

describe('postEmbedContext', () => {
  it('posts a momentum:context message to the iframe window scoped to the GPT origin', () => {
    const postMessage = vi.fn()
    const iframe = { contentWindow: { postMessage } } as unknown as HTMLIFrameElement
    const context = { mode: 'folder' as const, folder_path: '/Documents/Invoices' }

    postEmbedContext(iframe, context)

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'momentum:context', payload: context },
      GPT_ORIGIN,
    )
  })

  it('does nothing when the iframe has no contentWindow yet', () => {
    const iframe = { contentWindow: null } as unknown as HTMLIFrameElement

    expect(() => postEmbedContext(iframe, { mode: 'corpus' })).not.toThrow()
  })
})

describe('mountIonosGptEmbed', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('appends a single iframe into the container with the embed URL', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const handle = mountIonosGptEmbed(container, { mode: 'document', doc_id: '42' })

    const iframes = container.querySelectorAll('iframe')
    expect(iframes).toHaveLength(1)
    expect(handle.iframe).toBe(iframes[0])
    expect(handle.iframe.getAttribute('allow')).toBe('clipboard-write')
    expect(new URL(handle.iframe.src).searchParams.get('context')).toContain('"doc_id":"42"')
  })

  it('injects context via postMessage once the iframe loads', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const context = { mode: 'document' as const, doc_id: '42' }

    const handle = mountIonosGptEmbed(container, context)
    const postMessage = vi.fn()
    Object.defineProperty(handle.iframe, 'contentWindow', {
      value: { postMessage },
      configurable: true,
    })

    handle.iframe.dispatchEvent(new Event('load'))

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'momentum:context', payload: context },
      GPT_ORIGIN,
    )
  })

  it('does not postMessage on load when mounted without context (corpus-wide chat)', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const handle = mountIonosGptEmbed(container)
    const postMessage = vi.fn()
    Object.defineProperty(handle.iframe, 'contentWindow', {
      value: { postMessage },
      configurable: true,
    })

    handle.iframe.dispatchEvent(new Event('load'))

    expect(postMessage).not.toHaveBeenCalled()
  })

  it('updateContext re-injects context without remounting the iframe', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const handle = mountIonosGptEmbed(container, { mode: 'folder', folder_path: '/a' })
    const postMessage = vi.fn()
    Object.defineProperty(handle.iframe, 'contentWindow', {
      value: { postMessage },
      configurable: true,
    })

    handle.updateContext({ mode: 'document', doc_id: '99' })

    expect(container.querySelectorAll('iframe')).toHaveLength(1)
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'momentum:context', payload: { mode: 'document', doc_id: '99' } },
      GPT_ORIGIN,
    )
  })

  it('destroy removes the iframe and stops further load-triggered postMessages', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const handle = mountIonosGptEmbed(container, { mode: 'document', doc_id: '1' })
    handle.destroy()

    expect(container.querySelectorAll('iframe')).toHaveLength(0)
  })
})
