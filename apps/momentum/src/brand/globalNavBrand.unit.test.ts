import { afterEach, describe, expect, it } from 'vitest'
import {
  BRAND_MARKER_ATTRIBUTE,
  BRAND_NAME_CLASS,
  GLOBAL_NAV_TAG,
  PRODUCT_NAME,
  WORDMARK_VIEWBOX,
  applyGlobalNavBrand,
  installGlobalNavBrand,
} from './globalNavBrand'

// Unit tests for the shadow-DOM product-name patch (M74.1, decision_log.md
// 2026-08-12). The tests are the point of the milestone rather than the DOM
// code: the fixture below mirrors the *measured* structure of
// `nc-ionos-theme`'s header — `<a class="header-left">` holding two
// `<ionos-icons>`, each with its own open shadow root holding one `<svg>`,
// the logo at `0 0 90 26` and the wordmark at `0 0 127 17` — so that they
// prove the `viewBox` lookup targets the wordmark and not the logo, that a
// second call changes nothing, and that an unrecognised header is left
// completely alone.

const LOGO_VIEWBOX = '0 0 90 26'

interface Fixture {
  host: Element
  root: ShadowRoot
  icons: Element[]
}

/**
 * Builds the theme's header shape. `viewBoxes` are the `viewBox` values of the
 * `<svg>` inside each `<ionos-icons>`'s own shadow root, in document order.
 */
function mountGlobalNav(viewBoxes: string[]): Fixture {
  const host = document.createElement(GLOBAL_NAV_TAG)
  const root = host.attachShadow({ mode: 'open' })

  const headerLeft = document.createElement('a')
  headerLeft.className = 'header-left'
  const icons = viewBoxes.map((viewBox) => {
    const icon = document.createElement('ionos-icons')
    const iconRoot = icon.attachShadow({ mode: 'open' })
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', viewBox)
    iconRoot.appendChild(svg)
    headerLeft.appendChild(icon)
    return icon as Element
  })
  root.appendChild(headerLeft)

  // Only `.header-right` is slotted in the real theme; `.header-left` has no
  // slot, which is why the name cannot be placed there without the shadow.
  const headerRight = document.createElement('div')
  headerRight.className = 'header-right'
  headerRight.appendChild(document.createElement('slot'))
  root.appendChild(headerRight)

  document.body.appendChild(host)
  return { host, root, icons }
}

function injectedStyle(root: ShadowRoot): HTMLStyleElement | null {
  return root.querySelector(`style[${BRAND_MARKER_ATTRIBUTE}]`)
}

function brandNames(root: ShadowRoot): Element[] {
  return Array.from(root.querySelectorAll(`.${BRAND_NAME_CLASS}`))
}

/**
 * Drains the microtask queue so a promise that *should* have settled by now
 * has. Event-based, not a delay — CLAUDE.md bans fixed delays in tests.
 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('applyGlobalNavBrand', () => {
  it('hides the wordmark by its viewBox, not by its index', () => {
    const { host, root } = mountGlobalNav([LOGO_VIEWBOX, WORDMARK_VIEWBOX])

    expect(applyGlobalNavBrand(host)).toBe('applied')

    const style = injectedStyle(root)
    expect(style).not.toBeNull()
    // Second of two `<ionos-icons>` -> nth-of-type(2).
    expect(style?.textContent).toContain('ionos-icons:nth-of-type(2) { display: none !important; }')
  })

  it('still targets the wordmark when the icons are reordered upstream', () => {
    const { host, root } = mountGlobalNav([WORDMARK_VIEWBOX, LOGO_VIEWBOX])

    expect(applyGlobalNavBrand(host)).toBe('applied')

    expect(injectedStyle(root)?.textContent).toContain('ionos-icons:nth-of-type(1)')
  })

  it('puts the product name in the wordmark’s own slot', () => {
    const { host, root, icons } = mountGlobalNav([LOGO_VIEWBOX, WORDMARK_VIEWBOX])

    applyGlobalNavBrand(host)

    const [name] = brandNames(root)
    expect(name?.textContent).toBe(PRODUCT_NAME)
    expect(icons[1]?.nextElementSibling).toBe(name)
  })

  it('colours the name from the theme’s own token so it follows light/dark', () => {
    const { host, root } = mountGlobalNav([LOGO_VIEWBOX, WORDMARK_VIEWBOX])

    applyGlobalNavBrand(host)

    expect(injectedStyle(root)?.textContent).toContain(
      'color: var(--ion-text, var(--color-main-text, #fff));',
    )
  })

  it('weights the name per the concept’s own `.ionos-product-name` rule (M103.3)', () => {
    const { host, root } = mountGlobalNav([LOGO_VIEWBOX, WORDMARK_VIEWBOX])

    applyGlobalNavBrand(host)

    expect(injectedStyle(root)?.textContent).toContain('font-weight: 500;')
  })

  it('accepts an explicit product name', () => {
    const { host, root } = mountGlobalNav([LOGO_VIEWBOX, WORDMARK_VIEWBOX])

    applyGlobalNavBrand(host, 'Something Else')

    expect(brandNames(root)[0]?.textContent).toBe('Something Else')
  })

  it('is idempotent — a second call injects nothing further', () => {
    const { host, root } = mountGlobalNav([LOGO_VIEWBOX, WORDMARK_VIEWBOX])

    expect(applyGlobalNavBrand(host)).toBe('applied')
    expect(applyGlobalNavBrand(host)).toBe('already')

    expect(root.querySelectorAll(`style[${BRAND_MARKER_ATTRIBUTE}]`)).toHaveLength(1)
    expect(brandNames(root)).toHaveLength(1)
  })

  it('is a no-op when no icon carries the wordmark viewBox', () => {
    const { host, root } = mountGlobalNav([LOGO_VIEWBOX])

    expect(applyGlobalNavBrand(host)).toBe('no-wordmark')

    expect(injectedStyle(root)).toBeNull()
    expect(brandNames(root)).toHaveLength(0)
  })

  it('is a no-op when the header has no shadow root', () => {
    const host = document.createElement(GLOBAL_NAV_TAG)
    document.body.appendChild(host)

    expect(applyGlobalNavBrand(host)).toBe('no-shadow')
    expect(host.childElementCount).toBe(0)
  })

  it('is a no-op when the theme is absent altogether', () => {
    expect(applyGlobalNavBrand(document.querySelector(GLOBAL_NAV_TAG))).toBe('no-host')
  })
})

describe('installGlobalNavBrand', () => {
  it('applies immediately when the header is already rendered', async () => {
    const { root } = mountGlobalNav([LOGO_VIEWBOX, WORDMARK_VIEWBOX])

    await expect(installGlobalNavBrand()).resolves.toBe('applied')

    expect(brandNames(root)[0]?.textContent).toBe(PRODUCT_NAME)
  })

  // Ordering note: the two tests below must stay in this order. The second one
  // relies on `GLOBAL_NAV_TAG` already being defined in this window (custom
  // elements cannot be undefined once registered), which is what the first one
  // does.

  it('waits for the custom element to upgrade, with no fixed delay', async () => {
    // The theme's bundle defines the element and populates its shadow after our
    // bundle has already run, so this resolves off `customElements.whenDefined`
    // plus a MutationObserver — never a timer.
    const pending = installGlobalNavBrand()

    let settled = false
    void pending.then(() => {
      settled = true
    })
    await flushMicrotasks()
    expect(settled).toBe(false)

    customElements.define(GLOBAL_NAV_TAG, class extends HTMLElement {})
    const { root } = mountGlobalNav([LOGO_VIEWBOX, WORDMARK_VIEWBOX])

    await expect(pending).resolves.toBe('applied')
    expect(brandNames(root)[0]?.textContent).toBe(PRODUCT_NAME)
  })

  it('stays inert when plain Nextcloud renders the header', async () => {
    // Plain NC renders `#header` with `.header-start`/`.header-end`; nothing
    // this module recognises, and nothing it may touch. The promise stays
    // pending by design — there is nothing to report and nothing to time out
    // on, so the observable contract is "the page is left exactly as it was".
    const header = document.createElement('div')
    header.id = 'header'
    header.innerHTML = '<div class="header-start"></div><div class="header-end"></div>'
    const before = header.outerHTML
    document.body.appendChild(header)

    let result: string | undefined
    void installGlobalNavBrand().then((r) => {
      result = r
    })
    await flushMicrotasks()

    expect(result).toBeUndefined()
    expect(header.outerHTML).toBe(before)
    expect(document.querySelectorAll(`.${BRAND_NAME_CLASS}`)).toHaveLength(0)
  })
})
