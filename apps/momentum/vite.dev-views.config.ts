import { defineConfig } from 'vite'

// DEV-ONLY, NOT FOR PRODUCTION. Builds mock/dev-views-bridge.ts (see that
// file's header) into js/momentum-dev-views.js, an extra IIFE script
// templates/index.php loads only to register the mock 'files' View against
// the real NC page. Not part of the app's real build (package.json's
// "build" script doesn't reference this config) — run manually with
// `npx vite build --config vite.dev-views.config.ts`.
export default defineConfig({
  define: {
    appName: JSON.stringify('momentum'),
    appVersion: JSON.stringify('0.1.0'),
  },
  build: {
    outDir: '.',
    emptyOutDir: false,
    rollupOptions: {
      input: 'mock/dev-views-bridge.ts',
      output: {
        format: 'iife',
        entryFileNames: 'js/momentum-dev-views.js',
      },
    },
  },
})
