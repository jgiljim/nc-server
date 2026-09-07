import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Builds two IIFE bundles from one config, selected by VITE_BUILD_TARGET
// (glue-app/package.json's "build" script runs both):
//   - default: the Vue app shell mounted by PageController/templates/
//     index.php (frontend.md § Integration Model) -> js/momentum-main.js,
//     the standard NC app bundle location `script('momentum', 'momentum-
//     main')` resolves.
//   - VITE_BUILD_TARGET=files: the Files-app integration bundle (frontend.md
//     § File-Browser View Integration + § Ask AI Sidebar; M4.14/M4.16) ->
//     js/momentum-files.js, injected on every Files page by
//     lib/Listener/LoadAdditionalScriptsListener.php.
//
// One config file with a env-var branch, not two separate config files:
// docker/Dockerfile.glue-app's build stage COPYs this repo's own files into
// a Docker build context via `buildctl --local context=.` — a second config
// file (`vite.files.config.ts`) sitting alongside this one at glue-app/'s
// root was never reliably fetchable through that local-context COPY in this
// environment (confirmed live, 2026-07-27: `buildctl build` reproducibly
// reported a freshly-added top-level file under glue-app/ as "not found"
// specifically when referenced by `docker/Dockerfile.glue-app`'s COPY, while
// the exact same file copied fine through an isolated, out-of-repo
// buildctl invocation — a local/environment quirk in how that persistent
// buildkitd daemon's local-source sync handles this specific repo path, not
// a real content or Dockerfile problem). Routing both builds through a file
// that already exists and is already known-good in that COPY step sidesteps
// it entirely.
//
// output.format must be 'iife', not Vite's default 'es', for both bundles:
// both load via Nextcloud's own `script()` helper / a script tag with no
// `type="module"`, so an ES-module-formatted bundle's top-level `const`/
// `let` bindings would leak into the page's single shared classic-script
// global scope instead of getting their own isolated module scope.
// Confirmed live, 2026-07-27 (for momentum-main.js): this collided with an
// unrelated identifier already declared by another script on the same
// Nextcloud page, throwing `Uncaught SyntaxError: Identifier '_' has
// already been declared` the moment the script tag loaded — 'iife' wraps
// the whole bundle in a self-contained closure, exactly what a classic
// (non-module) script tag needs.
//
// A side effect of 'iife': Vite no longer extracts CSS into a separate
// file at all — it injects a <style> tag at runtime from inside the bundle
// instead (confirmed live: js/momentum-main.js is the *only* build output
// for that target; the css/ directory this project briefly emitted stays
// empty). templates/index.php no longer calls style('momentum',
// 'momentum-main') for exactly this reason — that call would just 404 on a
// file that's never generated.
const buildFilesEntry = process.env.VITE_BUILD_TARGET === 'files'

export default defineConfig({
  plugins: buildFilesEntry ? [] : [vue()],
  // `@nextcloud/vue` reads bare `appName`/`appVersion` globals (see its
  // dist/chunks/appName-*.mjs: a `try { realAppName = appName }` with an
  // error log in the catch). Nextcloud's own apps get them from
  // @nextcloud/webpack-vue-config's DefinePlugin; the Vite build has to
  // provide them itself, or every page load logs "The `@nextcloud/vue`
  // library was used without setting / replacing the `appName`" and the
  // library falls back to the placeholder "missing-app-name" — which also
  // breaks its localised-app-name lookup against core's `apps` initial
  // state.
  define: {
    appName: JSON.stringify('momentum'),
    appVersion: JSON.stringify('0.1.0'),
  },
  build: {
    outDir: '.',
    emptyOutDir: false,
    rollupOptions: {
      input: buildFilesEntry ? 'src/files-entry.ts' : 'src/main.ts',
      output: {
        format: 'iife',
        entryFileNames: buildFilesEntry ? 'js/momentum-files.js' : 'js/momentum-main.js',
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.unit.test.ts'],
    // Scoped-CSS processing is off by default (see below) for test speed, but
    // AiStatusStrip's reduced-motion guard (M164.1) needs its real cascade —
    // a JS-toggled class overriding the pulse's animation-name, not an
    // @media query jsdom's CSS engine cannot evaluate (jsdom always applies
    // the base rule regardless of matchMedia; confirmed empirically —
    // @media blocks never take effect in getComputedStyle here) — so this
    // one component opts back in. VirtualTable.vue also opts in (M171.4,
    // backlog/v1.md Phase 171): its fixed-width column rules
    // (--select/--actions/--view-toggle) tie in specificity with the base
    // `.virtual-table__th, .virtual-table__td` rule, so which one wins is a
    // cascade/source-order question jsdom's CSSOM can answer but a
    // class-list assertion cannot. FileBrowserPage's M171.3 toolbar-wrap
    // guard (same JS-toggled-class pattern, `toolbarNarrow`) needs the same
    // for the same reason. DocumentViewerPage's M174.1 nav-toggle-offset
    // scoping guard needs the same: whether `body.momentum-embedded-preview
    // .app-navigation-toggle-wrapper` actually applies is exactly a real
    // selector-match/cascade question, not something a body-class assertion
    // alone can prove (see the M174.1 test's own comment). FieldEditor's
    // M174.3 actions-row guard needs the same: whether the footer actually
    // re-flows to `display: flex` is exactly a real selector-match question,
    // not something a class-list assertion alone can prove.
    css: {
      include: [
        /AiStatusStrip\.vue/,
        /VirtualTable\.vue/,
        /FileBrowserPage\.vue/,
        /DocumentViewerPage\.vue/,
        /FieldEditor\.vue/,
      ],
    },
    server: {
      deps: {
        inline: [/@nextcloud\/vue/],
      },
    },
  },
})
