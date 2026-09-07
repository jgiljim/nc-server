// Puts the product name in the Nextcloud global header when the IONOS theme
// (`nc-ionos-theme`) is installed — backlog/v1.md Phase 74 / M74.1,
// decision_log.md 2026-08-12.
//
// The theme renders «IONOS  HiDrive Next» in the top bar, and that wordmark is
// not text: it is an `<svg viewBox="0 0 127 17">` with the letters as vector
// paths, living two shadow roots deep inside `ionos-global-nav`. The theme's
// Svelte components expose no props, no `::part()`, and no `occ` key, and
// external CSS cannot cross a shadow boundary — so nothing outside the theme
// can name this product where its own design concept says the name belongs.
//
// Both shadow roots are *open*, though, so this module appends a `<style>` into
// `ionos-global-nav`'s shadow root, hides the wordmark, and puts the product
// name in the wordmark's exact slot. No fork of anything of IONOS's, and a
// clean no-op wherever the theme is absent (plain Nextcloud renders its own
// `#header` with `.header-start`/`.header-end`, which this module never
// touches).
//
// This is our app mutating the platform's chrome and it depends on the theme's
// internal shadow structure, so an upstream change disables it silently without
// breaking anything. That trade-off is recorded as explicitly open for debate
// with the HiDrive Next team in decision_log.md 2026-08-12; the clean
// resolution is `nc-simplenavigation` exposing a product-name prop
// (`nc-simplenavigation#33`, still unmerged as of M103.1's 2026-08-18 recheck).
//
// M103.3 (backlog/v1.md Phase 103) extends this same injection point with the
// rest of `specs/mockup-ai-document-manager.html`'s header chrome that is safe
// to port: the concept's own `.ionos-product-name` rule sets `font-weight:
// 500`, lighter than the `600` this module originally guessed absent the
// concept file. The concept's `#app-navigation` is a *faked* reconstruction of
// host chrome for the mockup's own standalone HTML/CSS/JS (confirmed by
// Phase 174 — the mockup has no `.app-navigation-toggle-wrapper` at all,
// because it never renders real Nextcloud nav); it is not DOM this module can
// reach, since `#app-navigation` is core Nextcloud's own component (built by
// M21.5, frontend.md § Navigation Tree Additions), a sibling of
// `ionos-global-nav` rather than something inside its shadow root. So there is
// no separate nav-tree patch here — the header is the only chrome the
// shadow-DOM technique can touch, and it is now brought in line with the
// concept's own product-name styling.

/** The tag the IONOS theme registers for the global header. */
export const GLOBAL_NAV_TAG = 'ionos-global-nav'

/** The product name, per the design concept (backlog/v1.md Phase 74). */
export const PRODUCT_NAME = 'AI Document Manager'

/**
 * Identifies the wordmark among `.header-left`'s `<ionos-icons>` children.
 * Measured live against `doc-mgr` (NC 34.0.1.2): `0 0 90 26` is the IONOS
 * logo, `0 0 127 17` is the product wordmark. Today they sit at index 0 and 1
 * respectively, but they are looked up by `viewBox` and never by index, so a
 * reorder upstream cannot silently retarget the logo.
 */
export const WORDMARK_VIEWBOX = '0 0 127 17'

/** Marks the injected `<style>`, so a second call is a no-op. */
export const BRAND_MARKER_ATTRIBUTE = 'data-momentum-brand'

/** Class on the injected product-name element, styled by the same `<style>`. */
export const BRAND_NAME_CLASS = 'momentum-brand-product-name'

/**
 * Outcome of one synchronous patch attempt. Only `applied` and `already` mean
 * the header now reads the product name; the rest describe how far the theme's
 * DOM had got (or that it is not there at all).
 */
export type GlobalNavBrandResult =
  | 'applied'
  | 'already'
  | 'no-host'
  | 'no-shadow'
  | 'no-wordmark'

function findWordmarkIndex(icons: Element[]): number {
  return icons.findIndex(
    (icon) => icon.shadowRoot?.querySelector('svg')?.getAttribute('viewBox') === WORDMARK_VIEWBOX,
  )
}

// `nth-of-type` is 1-based and is computed from the *measured* index, never
// hardcoded. Colour comes from the theme's own `--ion-text` token — measured
// live as resolving to the theme's near-white foreground on the dark theme — so
// the name follows light/dark with no extra work; the two fallbacks keep it
// legible if the token ever goes away.
function brandStyleText(wordmarkIndex: number): string {
  return `
.header-left ionos-icons:nth-of-type(${wordmarkIndex + 1}) { display: none !important; }
.${BRAND_NAME_CLASS} {
  font-family: inherit;
  font-size: 1.25rem;
  font-weight: 500;
  white-space: nowrap;
  color: var(--ion-text, var(--color-main-text, #fff));
}
`
}

/**
 * Patches one already-rendered `ionos-global-nav` element. Synchronous, safe to
 * call repeatedly, and never throws on a shape it does not recognise — it
 * reports what it found instead.
 */
export function applyGlobalNavBrand(
  host: Element | null | undefined,
  productName: string = PRODUCT_NAME,
): GlobalNavBrandResult {
  if (!host) {
    return 'no-host'
  }
  const root = host.shadowRoot
  if (!root) {
    return 'no-shadow'
  }
  if (root.querySelector(`style[${BRAND_MARKER_ATTRIBUTE}]`)) {
    return 'already'
  }

  const icons = Array.from(root.querySelectorAll('.header-left ionos-icons'))
  const wordmarkIndex = findWordmarkIndex(icons)
  if (wordmarkIndex < 0) {
    return 'no-wordmark'
  }
  const wordmark = icons[wordmarkIndex]

  // `ownerDocument` rather than the global `document`: the host may live in
  // another document (a test fixture, an iframe), and elements created by the
  // wrong document cannot be inserted here.
  const doc = host.ownerDocument
  const style = doc.createElement('style')
  style.setAttribute(BRAND_MARKER_ATTRIBUTE, '')
  style.textContent = brandStyleText(wordmarkIndex)
  root.appendChild(style)

  const name = doc.createElement('span')
  name.className = BRAND_NAME_CLASS
  name.textContent = productName
  // `afterend` puts the name in the hidden wordmark's exact slot — measured at
  // x=132px, right after the 90px IONOS logo, with the theme's own 18px gap.
  wordmark.insertAdjacentElement('afterend', name)

  return 'applied'
}

/**
 * Installs the product name into the global header, waiting for the theme's
 * custom element if it has not upgraded yet.
 *
 * Resolves with the result of the attempt that succeeded. When the theme is
 * absent the element is never defined, so the returned promise simply never
 * settles and nothing is observed, scheduled, or mutated — the no-op this
 * module guarantees. There is deliberately no timeout: CLAUDE.md bans fixed
 * delays on the success path, and a timer here would only be able to report an
 * absence that is already handled by doing nothing.
 */
export function installGlobalNavBrand(
  doc: Document = document,
  productName: string = PRODUCT_NAME,
): Promise<GlobalNavBrandResult> {
  const immediate = applyGlobalNavBrand(doc.querySelector(GLOBAL_NAV_TAG), productName)
  if (immediate === 'applied' || immediate === 'already') {
    return Promise.resolve(immediate)
  }

  const view = doc.defaultView
  if (!view?.customElements || typeof view.MutationObserver !== 'function') {
    return Promise.resolve(immediate)
  }

  return view.customElements.whenDefined(GLOBAL_NAV_TAG).then(
    () =>
      new Promise<GlobalNavBrandResult>((resolve) => {
        const attempt = (): boolean => {
          const result = applyGlobalNavBrand(doc.querySelector(GLOBAL_NAV_TAG), productName)
          if (result === 'applied' || result === 'already') {
            resolve(result)
            return true
          }
          return false
        }
        if (attempt()) {
          return
        }
        // The element is defined but its shadow content is not in place yet;
        // watch for it rather than polling on a timer. Disconnected as soon as
        // the patch lands. If an upstream change means it never does, one idle
        // observer remains — the documented silent-degradation case.
        const observer = new view.MutationObserver(() => {
          if (attempt()) {
            observer.disconnect()
          }
        })
        observer.observe(doc.documentElement, { childList: true, subtree: true })
      }),
  )
}
