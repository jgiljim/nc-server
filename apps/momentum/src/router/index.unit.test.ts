import { describe, expect, it } from 'vitest'
import { router } from './index'

// frontend.md § Page Routes: every page is a Vue-Router client route served
// by the same server-side Page#index action (appinfo/routes.php).
describe('router', () => {
  it.each([
    ['/', 'documents'],
    ['/ai-filing', 'ai-filing'],
    ['/type/:typeName', 'by-type-document-list'],
    ['/recent', 'recent-documents'],
    ['/document/:docId', 'document-viewer'],
    ['/chat', 'nl-query'],
    ['/browse/:viewId', 'file-browser'],
  ])('registers %s as the %s route', (path, name) => {
    const match = router.getRoutes().find((route) => route.path === path)

    expect(match).toBeDefined()
    expect(match?.name).toBe(name)
  })

  it('registers exactly seven page routes', () => {
    // Seven since M125.2 moved the AI Filing dashboard to its own path so the
    // root could become the Documents table. Counted so a route added here
    // without its `appinfo/routes.php` counterpart (which would 404 on reload
    // and on any shared link) shows up as a mismatch between this and
    // RoutesTest.php.
    expect(router.getRoutes()).toHaveLength(7)
  })
})
