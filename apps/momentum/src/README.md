# Glue App frontend (`glue-app/src`)

The Nextcloud-only frontend (CLAUDE.md § *Frontend*, decided 2026-07-23): a
`@nextcloud/vue` app mounted by `PageController`/`templates/index.php`, built by
Vite into `js/momentum-main.js` (see `../vite.config.ts`, `../Makefile`).

## Layout

```
src/
├── main.ts                  Vue app bootstrap (mounts #momentum-app)
├── App.vue                  Root shell / router outlet
├── config.ts                MOMENTUM_CONFIG — single source of tunable constants (frontend.md § Frontend Configuration)
├── types.ts                 Shared UI view-model types (ColumnDef, FilterableField, …)
├── router/                  Vue Router (frontend.md § Page Routes)
├── views/                   Page components, one per route
├── components/              Reusable component library built on @nextcloud/vue (frontend.md § Reusable Components)
├── brand/                   Global-header product name, injected into nc-ionos-theme's open shadow DOM (backlog/v1.md M74.1)
└── embed/                   Framework-agnostic IonosGPT embed primitive
```

## JS test layout (decided as part of Phase 4 / M4.1)

Vitest tests are colocated with the source they cover and named
**`*.unit.test.ts`** — the one suffix `vite.config.ts`'s `test.include` and the
`Makefile`'s `JS_TESTS` pick up. This single tier covers both pure-logic tests
(e.g. `columnVisibility.unit.test.ts`) and `@vue/test-utils` component tests
(e.g. `ColumnPicker.unit.test.ts`, `FilterPicker.unit.test.ts`), distinguished
by content, not filename. It intentionally does **not** adopt the superseded
standalone frontend's `*.integration.test.ts` / `*.live.test.ts` split (see
CLAUDE.md's note under "TypeScript/Vue frontend tests"): this app calls
Nextcloud over its own PHP-proxied routes at runtime, so a browser-level live
tier lands with the pages that make those calls, not with these primitives.

### Testing components built on `@nextcloud/vue`

`@nextcloud/vue`'s component ESM bundles import their own compiled CSS, so
Vitest must transform (and no-op) those imports — `vite.config.ts` inlines the
dependency via `test.server.deps.inline` for this reason.

`NcPopover` renders its content through floating-vue, which does not
synchronously mount its default slot in jsdom. Component tests therefore **stub
`NcPopover`** with a trivial wrapper that renders both the `trigger` and default
slots, and assert on this component's own contract (props in, events out). The
popover chrome itself is `@nextcloud/vue`'s responsibility, not ours.
