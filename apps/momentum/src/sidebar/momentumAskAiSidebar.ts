// Host-side "Ask AI" file-sidebar tab (frontend.md § Ask AI Sidebar; M4.16).
// When a user opens the Nextcloud Files sidebar for a document Doc-Mgr has
// classified, this tab surfaces an IonosGPT (Filo agent) chat pre-loaded with
// that document's context, so questions like "What is the total amount on this
// invoice?" resolve against the extracted fields via Filo's `get_document`
// tool. The IonosGPT-side embed layout and MCP client are the external
// IonosGPT deliverable (backlog/v1.md Phase 4) — this module only owns the
// host side: the tab registration, visibility gate, and iframe mount/context.
//
// frontend.md's own code sample (`registerSidebarTab({ mount(el, fileInfo)
// {...}, ... })`) is illustrative pseudocode, not the real contract —
// `registerSidebarTab` didn't exist in `@nextcloud/files` at all before
// 4.0.0, and confirmed against the installed `@nextcloud/files@4.0.0` type
// declarations, the real `ISidebarTab` is a **Web Components** registration:
// `{id, displayName, iconSvgInline, order, tagName, enabled(context),
// onInit()}` — the sidebar itself creates a `<tagName>` custom element and
// sets `node`/`folder`/`view`/`active` properties on it directly, rather than
// calling a `mount(el, fileInfo)`/`unmount(el)` callback pair. This module
// targets that real contract: `onInit` defines a custom element whose `node`
// setter mounts/tears down the IonosGPT iframe embed.
//
// Like the M4.13 embed primitive and the M4.14 Files View, this stays a pure/
// injectable module for the registration call itself: `registerSidebarTab`
// and `@nextcloud/l10n`'s `t` are injected via `MomentumSidebarDeps`. The
// custom element class itself is exercised directly against jsdom's real
// `HTMLElement`/`customElements` in tests — no fake DOM needed there.

import type { EmbedContext, IonosGptEmbedHandle } from '../embed/ionosGptEmbed'
import { mountIonosGptEmbed } from '../embed/ionosGptEmbed'

export const MOMENTUM_APP_ID = 'momentum'
// frontend.md § Ask AI Sidebar: `id: 'momentum-nl'`, `order: 100`.
export const ASK_AI_TAB_ID = 'momentum-nl'
export const ASK_AI_TAB_ORDER = 100
// Real `ISidebarTab.tagName` contract: must be a valid custom element tag
// name starting with the app id (@nextcloud/files@4.0.0 SidebarTab.ts docs).
export const ASK_AI_TAB_TAG_NAME = 'momentum-ask-ai-tab'

// The classification marker the M4.14 Files View writes onto each node
// (`toFileNode`); its presence is what makes the tab visible. Holding Doc-Mgr's
// own document id (distinct from the NC file id) it is also what the embed
// context carries so Filo's `get_document` tool resolves the right document.
export const DOC_ID_ATTRIBUTE = 'momentum-doc-id'

// The spec's `MomentumChatIcon`. The real `ISidebarTab.iconSvgInline`
// contract takes an inline SVG *string*, like the Files `View.icon` contract
// the M4.14 view uses — distinct from the `@nextcloud/vue` "icons are
// components" rule, which governs Vue pages, not the Files sidebar chrome.
export const MOMENTUM_CHAT_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
  '<path fill="currentColor" d="M12 3c5 0 9 3.14 9 7s-4 7-9 7a10 10 0 0 1-2.6-.34L4 20l1.4-3.6' +
  'A6.6 6.6 0 0 1 3 10c0-3.86 4-7 9-7m-4 6v2h8V9zm0 3v2h5v-2z"/>' +
  '</svg>'

// --- Node + context contract -------------------------------------------

// Minimal structural view of the real `INode` (`@nextcloud/files`) — only the
// fields the tab reads. The M4.14 Files View's `toFileNode` constructs the
// real `File` instances this tab receives via `ISidebarContext.node`.
export interface MomentumSidebarNode {
  attributes?: Record<string, unknown>
  displayname?: string
  basename?: string
}

// The real `ISidebarContext` passed to `enabled()` (`@nextcloud/files@4.0.0`
// `SidebarTab.ts`) — only the `node` field is used here.
export interface MomentumSidebarContext {
  node: MomentumSidebarNode
}

// The real `ISidebarTab` contract (`@nextcloud/files@4.0.0`).
export interface MomentumSidebarTab {
  id: string
  displayName: string
  iconSvgInline: string
  order: number
  tagName: string
  enabled(context: MomentumSidebarContext): boolean
  onInit(): Promise<void>
}

// The slice of `CustomElementRegistry` this module needs. `customElements`
// itself has no public constructor (browser/jsdom-enforced), so tests inject
// a plain fake here rather than a real registry instance — this keeps each
// test isolated instead of sharing one global tag-name registration.
export interface CustomElementRegistryLike {
  get(name: string): CustomElementConstructor | undefined
  define(name: string, ctor: CustomElementConstructor): void
}

export interface MomentumSidebarDeps {
  registerSidebarTab: (tab: MomentumSidebarTab) => void
  t: (app: string, text: string) => string
  // Overridable for tests; defaults to the real M4.13 embed primitive.
  mountEmbed?: (container: HTMLElement, context?: EmbedContext) => IonosGptEmbedHandle
  // Overridable for tests; defaults to the real global registry.
  customElements?: CustomElementRegistryLike
}

// --- Visibility + context --------------------------------------------------

// The tab appears only for files Doc-Mgr has classified — i.e. a non-empty
// `momentum-doc-id` attribute (frontend.md § Ask AI Sidebar, "When visible").
export function hasClassification(node: MomentumSidebarNode): boolean {
  const docId = node.attributes?.[DOC_ID_ATTRIBUTE]
  return typeof docId === 'string' && docId !== ''
}

// Builds the `document`-mode embed context for a classified file. `doc_id` is
// Doc-Mgr's own id (from the `momentum-doc-id` attribute), which Filo's
// `get_document` tool expects — not the unrelated NC node id.
export function buildDocumentContext(node: MomentumSidebarNode): EmbedContext {
  const context: EmbedContext = {
    mode: 'document',
    doc_id: String(node.attributes?.[DOC_ID_ATTRIBUTE] ?? ''),
  }
  const fileName = node.displayname || node.basename
  if (fileName) context.file_name = fileName
  return context
}

// --- Web Component -----------------------------------------------------

// The custom element the real sidebar creates and sets `.node` on (real
// `SidebarTabComponentInstance` contract). Mounts the IonosGPT embed once a
// node is assigned and the element is attached; tears it down on disconnect
// or re-render so NC re-using/replacing the element never leaks an iframe.
export function createMomentumAskAiTabElement(
  deps: Pick<MomentumSidebarDeps, 'mountEmbed'>,
): CustomElementConstructor {
  const mountEmbed = deps.mountEmbed ?? mountIonosGptEmbed

  return class MomentumAskAiTabElement extends HTMLElement {
    #node: MomentumSidebarNode | null = null
    #handle: IonosGptEmbedHandle | null = null

    get node(): MomentumSidebarNode | null {
      return this.#node
    }

    set node(node: MomentumSidebarNode | null) {
      this.#node = node
      this.#render()
    }

    connectedCallback(): void {
      this.#render()
    }

    disconnectedCallback(): void {
      this.#teardown()
    }

    #render(): void {
      this.#teardown()
      if (!this.#node || !this.isConnected) return
      this.#handle = mountEmbed(this, buildDocumentContext(this.#node))
    }

    #teardown(): void {
      this.#handle?.destroy()
      this.#handle = null
      this.innerHTML = ''
    }
  }
}

// --- Registration ----------------------------------------------------------

// Registers the Ask AI sidebar tab through the injected NC registrar
// (frontend.md § Ask AI Sidebar's `registerSidebarTab(...)`, adapted to the
// real `@nextcloud/files@4.0.0` Web Components contract above).
export function registerAskAiSidebarTab(deps: MomentumSidebarDeps): void {
  const registry = deps.customElements ?? customElements
  deps.registerSidebarTab({
    id: ASK_AI_TAB_ID,
    displayName: deps.t(MOMENTUM_APP_ID, 'Ask AI'),
    iconSvgInline: MOMENTUM_CHAT_ICON,
    order: ASK_AI_TAB_ORDER,
    tagName: ASK_AI_TAB_TAG_NAME,
    enabled: (context) => hasClassification(context.node),
    onInit: async () => {
      if (!registry.get(ASK_AI_TAB_TAG_NAME)) {
        registry.define(ASK_AI_TAB_TAG_NAME, createMomentumAskAiTabElement(deps))
      }
    },
  })
}
