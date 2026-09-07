import { describe, expect, it } from 'vitest'
import { GPT_ORIGIN } from '../embed/ionosGptEmbed'
import {
  ASK_AI_TAB_ID,
  ASK_AI_TAB_ORDER,
  ASK_AI_TAB_TAG_NAME,
  MOMENTUM_CHAT_ICON,
  buildDocumentContext,
  createMomentumAskAiTabElement,
  hasClassification,
  registerAskAiSidebarTab,
  type MomentumSidebarDeps,
  type MomentumSidebarNode,
} from './momentumAskAiSidebar'

// frontend.md § Ask AI Sidebar (M4.16), adapted to the real
// `@nextcloud/files@4.0.0` Web Components sidebar-tab contract (see
// momentumAskAiSidebar.ts's header comment). `registerSidebarTab`/`t` are
// still injected (pure/injectable, same shape as momentumFilesView.ts), but
// the custom element itself is exercised directly against jsdom's real
// `HTMLElement`/`customElements` — no Nextcloud runtime packages required
// either way.

function fakeRegistry(): { get: (name: string) => unknown; define: (name: string, ctor: unknown) => void } {
  const defined = new Map<string, unknown>()
  return {
    get: (name) => defined.get(name),
    define: (name, ctor) => defined.set(name, ctor),
  }
}

function makeDeps(overrides: Partial<MomentumSidebarDeps> = {}): {
  deps: MomentumSidebarDeps
  registered: unknown[]
} {
  const registered: unknown[] = []
  const deps: MomentumSidebarDeps = {
    registerSidebarTab: (tab) => registered.push(tab),
    t: (_app, text) => text,
    customElements: fakeRegistry() as MomentumSidebarDeps['customElements'],
    ...overrides,
  }
  return { deps, registered }
}

const CLASSIFIED: MomentumSidebarNode = {
  displayname: 'acme-q1.pdf',
  attributes: { 'momentum-doc-id': '42' },
}

describe('hasClassification', () => {
  it('is true only when a non-empty momentum-doc-id attribute is present', () => {
    expect(hasClassification(CLASSIFIED)).toBe(true)
  })

  it('is false for a file the pipeline has not classified', () => {
    expect(hasClassification({ attributes: {} })).toBe(false)
    expect(hasClassification({})).toBe(false)
    expect(hasClassification({ attributes: { 'momentum-doc-id': '' } })).toBe(false)
  })
})

describe('buildDocumentContext', () => {
  it('builds a document-mode context using the Doc-Mgr doc id, not the NC node id', () => {
    // momentum-doc-id is Doc-Mgr's own id (what Filo's get_document tool
    // needs); the NC node's own id is unrelated.
    expect(buildDocumentContext(CLASSIFIED)).toEqual({
      mode: 'document',
      doc_id: '42',
      file_name: 'acme-q1.pdf',
    })
  })

  it('falls back to basename when displayname is absent', () => {
    expect(buildDocumentContext({ basename: 'lease.docx', attributes: { 'momentum-doc-id': '9' } })).toEqual({
      mode: 'document',
      doc_id: '9',
      file_name: 'lease.docx',
    })
  })

  it('omits an absent file name rather than emitting undefined', () => {
    expect(buildDocumentContext({ attributes: { 'momentum-doc-id': '7' } })).toEqual({
      mode: 'document',
      doc_id: '7',
    })
  })
})

describe('createMomentumAskAiTabElement', () => {
  function defineElement(deps: Pick<MomentumSidebarDeps, 'mountEmbed'> = {}): string {
    const tagName = `momentum-test-tab-${Math.random().toString(36).slice(2)}`
    customElements.define(tagName, createMomentumAskAiTabElement(deps))
    return tagName
  }

  it('mounts the IonosGPT embed once a node is assigned and the element is attached', () => {
    const tagName = defineElement()
    const el = document.createElement(tagName) as HTMLElement & { node: MomentumSidebarNode }
    document.body.appendChild(el)

    el.node = CLASSIFIED

    const iframe = el.querySelector('iframe')
    expect(iframe).not.toBeNull()
    const context = JSON.parse(
      new URL((iframe as HTMLIFrameElement).src).searchParams.get('context') ?? '',
    )
    expect(context).toEqual({ mode: 'document', doc_id: '42', file_name: 'acme-q1.pdf' })

    el.remove()
  })

  it('injects context via postMessage once the iframe loads', () => {
    const tagName = defineElement()
    const el = document.createElement(tagName) as HTMLElement & { node: MomentumSidebarNode }
    document.body.appendChild(el)
    el.node = CLASSIFIED

    const iframe = el.querySelector('iframe') as HTMLIFrameElement
    const postMessage = () => {}
    let called: unknown[] | undefined
    Object.defineProperty(iframe, 'contentWindow', {
      value: {
        postMessage: (...args: unknown[]) => {
          called = args
        },
      },
      configurable: true,
    })
    iframe.dispatchEvent(new Event('load'))

    expect(called).toEqual([
      { type: 'momentum:context', payload: { mode: 'document', doc_id: '42', file_name: 'acme-q1.pdf' } },
      GPT_ORIGIN,
    ])

    el.remove()
  })

  it('tears down the embed on disconnect', () => {
    const tagName = defineElement()
    const el = document.createElement(tagName) as HTMLElement & { node: MomentumSidebarNode }
    document.body.appendChild(el)
    el.node = CLASSIFIED

    expect(el.querySelectorAll('iframe')).toHaveLength(1)

    el.remove()

    expect(el.childNodes).toHaveLength(0)
  })

  it('re-renders without leaking a previous iframe when the node changes', () => {
    const tagName = defineElement()
    const el = document.createElement(tagName) as HTMLElement & { node: MomentumSidebarNode }
    document.body.appendChild(el)

    el.node = CLASSIFIED
    el.node = { basename: 'lease.docx', attributes: { 'momentum-doc-id': '99' } }

    expect(el.querySelectorAll('iframe')).toHaveLength(1)
    const context = JSON.parse(
      new URL((el.querySelector('iframe') as HTMLIFrameElement).src).searchParams.get('context') ?? '',
    )
    expect(context.doc_id).toBe('99')

    el.remove()
  })
})

describe('registerAskAiSidebarTab', () => {
  it('registers exactly one Ask AI tab with the real ISidebarTab shape', () => {
    const { deps, registered } = makeDeps()

    registerAskAiSidebarTab(deps)

    expect(registered).toHaveLength(1)
    const tab = registered[0] as {
      id: string
      displayName: string
      iconSvgInline: string
      order: number
      tagName: string
      enabled: (context: { node: MomentumSidebarNode }) => boolean
      onInit: () => Promise<void>
    }
    expect(tab.id).toBe(ASK_AI_TAB_ID)
    expect(tab.displayName).toBe('Ask AI')
    expect(tab.iconSvgInline).toBe(MOMENTUM_CHAT_ICON)
    expect(tab.order).toBe(ASK_AI_TAB_ORDER)
    expect(tab.tagName).toBe(ASK_AI_TAB_TAG_NAME)
    expect(tab.enabled({ node: CLASSIFIED })).toBe(true)
    expect(tab.enabled({ node: {} })).toBe(false)
  })

  it('defines the custom element on init, once', async () => {
    const registry = fakeRegistry()
    const { deps, registered } = makeDeps({ customElements: registry as MomentumSidebarDeps['customElements'] })

    registerAskAiSidebarTab(deps)
    const tab = registered[0] as { onInit: () => Promise<void> }

    expect(registry.get(ASK_AI_TAB_TAG_NAME)).toBeUndefined()
    await tab.onInit()
    expect(registry.get(ASK_AI_TAB_TAG_NAME)).toBeDefined()
    await expect(tab.onInit()).resolves.toBeUndefined()
  })
})
