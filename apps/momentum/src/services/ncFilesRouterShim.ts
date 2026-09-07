// `window.OCP.Files.Router` adapter (frontend.md § Files & Shares Bridge;
// M123.1).
//
// Core's own file views, actions and stores reach for this global to read where
// the user is and to navigate: `apps/files/src/services/Files.ts`'s
// `getContents` consults the search store (which reads `Router.query`), and
// `openFolderAction` / `viewInFolderAction` / `newFolder` all call
// `Router.goToRoute(null, { view, fileid }, { dir })`. On the Files app's own
// pages that object is its vue-router. On ours it does not exist, which is why
// calling the `files` view's `getContents` from our page throws
// `Cannot read properties of undefined (reading 'Router')`.
//
// This module supplies the same interface backed by THIS app's router, so
// core's navigation actions land on `/apps/momentum/browse/:viewId?dir=…`
// instead of doing nothing. Installing an inert stub would have been shorter
// and would have turned "Open folder" into a silent no-op — an affordance that
// looks like it works is worse than one that is absent.
//
// Deps are injected so this is testable without a browser or a real router.

export interface FilesRouterState {
  params: Record<string, string>
  query: Record<string, string>
  name?: string | null
}

export interface FilesRouterLike extends FilesRouterState {
  goToRoute: (
    name: string | null | undefined,
    params?: Record<string, string>,
    query?: Record<string, string>,
    replace?: boolean,
  ) => void | Promise<void>
  goTo: (path: string, replace?: boolean) => void | Promise<void>
}

export interface RouterShimDeps {
  // Where the user is now, read on every access — core reads
  // `Router.query.dir` at call time, not at install time.
  currentViewId: () => string
  currentDir: () => string
  // Where core asked to go. `fileid` is passed through because core's actions
  // use it to highlight/scroll to a specific entry.
  navigate: (target: { viewId: string; dir: string; fileid?: string; replace: boolean }) => void
  // Injected for tests; defaults to the real global object.
  target?: Record<string, unknown>
}

interface OcpGlobal {
  Files?: { Router?: FilesRouterLike }
}

/**
 * Installs the shim and returns an uninstall function.
 *
 * A pre-existing `OCP.Files.Router` is left completely alone: on a page where
 * the real Files app is running, its router is the correct one and replacing it
 * would break the host. This is why the return value can be a no-op.
 */
export function installFilesRouterShim(deps: RouterShimDeps): () => void {
  const target = (deps.target ?? (globalThis as unknown as Record<string, unknown>)) as Record<
    string,
    unknown
  >
  const ocp = (target.OCP ??= {}) as OcpGlobal
  ocp.Files ??= {}
  if (ocp.Files.Router) return () => {}

  const router: FilesRouterLike = {
    get params() {
      return { view: deps.currentViewId() }
    },
    get query() {
      return { dir: deps.currentDir() }
    },
    get name() {
      return 'filelist'
    },
    goToRoute: (_name, params, query, replace = false) => {
      deps.navigate({
        viewId: params?.view ?? deps.currentViewId(),
        dir: query?.dir ?? deps.currentDir(),
        fileid: params?.fileid,
        replace,
      })
    },
    // `goTo(path)` is the raw-path variant; core uses it rarely (public
    // shares), and a path is a directory here.
    goTo: (path, replace = false) => {
      deps.navigate({ viewId: deps.currentViewId(), dir: path, replace })
    },
  }

  ocp.Files.Router = router
  return () => {
    if (ocp.Files?.Router === router) delete ocp.Files.Router
  }
}
