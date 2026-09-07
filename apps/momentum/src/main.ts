import { createApp } from 'vue'
import App from './App.vue'
import { installGlobalNavBrand } from './brand/globalNavBrand'
import { router } from './router'
import { installFilesRouterShim } from './services/ncFilesRouterShim'

// Mounted into templates/index.php's `#momentum-app` div (PageController).
createApp(App).use(router).mount('#momentum-app')

// Files & Shares bridge (frontend.md § Files & Shares Bridge, M123.1): core's
// own file views and actions read `window.OCP.Files.Router` — the `files`
// view's getContents throws without it, and its navigation actions ("Open
// folder", "View in folder") would silently do nothing. Backing it with THIS
// app's router makes both work inside our pages. Installed once, here, rather
// than per page: core code can reach for it at any time, including from a
// listing that is still in flight when the route changes.
installFilesRouterShim({
  currentViewId: () => String(router.currentRoute.value.params.viewId ?? 'files'),
  currentDir: () => {
    const dir = router.currentRoute.value.query.dir
    const value = Array.isArray(dir) ? dir[0] : dir
    return value && String(value).startsWith('/') ? String(value) : '/'
  },
  navigate: ({ viewId, dir, replace }) => {
    const to = { name: 'file-browser' as const, params: { viewId }, query: { dir } }
    void (replace ? router.replace(to) : router.push(to))
  },
})

// Names the product in the IONOS-themed global header (M74.1). A no-op — and
// an unawaited one — wherever `nc-ionos-theme` is not installed.
void installGlobalNavBrand()
