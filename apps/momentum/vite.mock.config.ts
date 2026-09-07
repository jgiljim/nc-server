import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { mockApiMiddleware } from './mock/server'

// Standalone dev server for the frontend/HiDrive-Next team (see
// mock/README.md): `npm run mock` boots the real `src/main.ts` app shell
// (unmodified — the same file production's `vite.config.ts` builds) against
// a mocked Nextcloud host (`mock/host.ts`) and a mocked
// `/apps/momentum/api/*` + WebDAV backend (`mock/server.ts`), with no
// Nextcloud instance, no Doc-Mgr backend, and no `helm install` involved.
//
// A separate config file rather than a mode branch in `vite.config.ts`: that
// file's own build is IIFE-only (`output.format: 'iife'`, per its header
// comment) because it loads via Nextcloud's `script()` helper as a classic,
// non-module script — `vite dev` serves ES modules to the browser
// unconditionally, which is a different-enough contract that branching one
// config for both would mostly be `if (mock) { …undo half the build config…
// }`.
export default defineConfig({
  root: fileURLToPath(new URL('./mock', import.meta.url)),
  plugins: [
    vue(),
    {
      name: 'momentum-mock-api',
      configureServer(server) {
        server.middlewares.use(mockApiMiddleware())
      },
    },
  ],
  // Same reason vite.config.ts sets these: @nextcloud/vue reads bare
  // `appName`/`appVersion` globals it expects a bundler's DefinePlugin to
  // supply (see that file's own comment).
  define: {
    appName: JSON.stringify('momentum'),
    appVersion: JSON.stringify('0.1.0'),
  },
})
