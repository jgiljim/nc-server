import { describe, expect, it, vi } from 'vitest'
import { installFilesRouterShim } from './ncFilesRouterShim'
import type { FilesRouterLike } from './ncFilesRouterShim'

describe('installFilesRouterShim', () => {
  function setup(overrides: Partial<Parameters<typeof installFilesRouterShim>[0]> = {}) {
    const target: Record<string, unknown> = {}
    const navigate = vi.fn()
    const uninstall = installFilesRouterShim({
      currentViewId: () => 'files',
      currentDir: () => '/Invoices',
      navigate,
      target,
      ...overrides,
    })
    const router = (target.OCP as { Files: { Router: FilesRouterLike } }).Files.Router
    return { target, navigate, uninstall, router }
  }

  it('exposes where the user is, read at access time rather than at install time', () => {
    let dir = '/Invoices'
    const { router } = setup({ currentDir: () => dir })

    expect(router.query).toEqual({ dir: '/Invoices' })
    dir = '/Invoices/2026'
    // Core reads `Router.query.dir` when it runs, not when we installed this —
    // a snapshot would make every getContents call fetch the folder the user
    // was in when the page loaded.
    expect(router.query).toEqual({ dir: '/Invoices/2026' })
    expect(router.params).toEqual({ view: 'files' })
  })

  it("routes core's goToRoute into this app instead of nowhere", () => {
    const { router, navigate } = setup()

    // Exactly the call apps/files' openFolderAction makes.
    router.goToRoute(null, { view: 'files', fileid: '42' }, { dir: '/Invoices/2026' })

    expect(navigate).toHaveBeenCalledWith({
      viewId: 'files',
      dir: '/Invoices/2026',
      fileid: '42',
      replace: false,
    })
  })

  it('falls back to the current location for the parts core omits', () => {
    const { router, navigate } = setup()

    router.goToRoute(null, undefined, undefined, true)

    expect(navigate).toHaveBeenCalledWith({
      viewId: 'files',
      dir: '/Invoices',
      fileid: undefined,
      replace: true,
    })
  })

  it('never replaces a Router that already exists', () => {
    // On a page where the real Files app runs, ITS router is the correct one.
    const existing = { params: {}, query: {}, goToRoute: vi.fn(), goTo: vi.fn() }
    const target: Record<string, unknown> = { OCP: { Files: { Router: existing } } }
    const navigate = vi.fn()

    const uninstall = installFilesRouterShim({
      currentViewId: () => 'files',
      currentDir: () => '/',
      navigate,
      target,
    })

    expect((target.OCP as { Files: { Router: unknown } }).Files.Router).toBe(existing)
    uninstall()
    // Uninstalling must not remove someone else's router either.
    expect((target.OCP as { Files: { Router: unknown } }).Files.Router).toBe(existing)
  })

  it('removes only its own router on uninstall', () => {
    const { target, uninstall } = setup()

    uninstall()

    expect((target.OCP as { Files?: { Router?: unknown } }).Files?.Router).toBeUndefined()
  })
})
