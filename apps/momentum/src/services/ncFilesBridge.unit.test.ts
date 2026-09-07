import { describe, expect, it, vi } from 'vitest'
import {
  UploadConflictError,
  NON_BROWSABLE_VIEW_IDS,
  WRITABLE_VIEW_IDS,
  UnknownViewError,
  buildNavTree,
  browsableViews,
  createBridge,
  renderColumnText,
  toBridgeNode,
} from './ncFilesBridge'
import type {
  BridgeDeps,
  BridgeListing,
  RawAction,
  RawListAction,
  RawFilter,
  RawNewMenuEntry,
  RawNode,
  RawSidebarTab,
  RawView,
} from './ncFilesBridge'

// The registry shape these fakes reproduce is the one MEASURED on a running
// Nextcloud 34 install (2026-08-24, frontend.md § The mechanism, as measured):
// `shareoverview` is the declared parent of the six sharing views, `search` is
// a child of `files`, `trashbin` is sticky with order 50 and carries three
// columns of its own.
function view(overrides: Partial<RawView> & { id: string }): RawView {
  return {
    name: overrides.id,
    getContents: async () => ({ folder: { path: '/' }, contents: [] }),
    ...overrides,
  }
}

// This app's own Files-app views land in the same registry (they reach our
// pages through the LoadAdditionalScriptsEvent we dispatch ourselves).
const OWN_VIEWS: RawView[] = [
  view({ id: 'momentum-ai-filing', name: 'AI Filing', order: 26 }),
  view({ id: 'momentum-recent', name: 'Recent Documents', order: 25 }),
  view({ id: 'momentum-ask-filo', name: 'Ask Filo', order: 27 }),
]

const CORE_VIEWS: RawView[] = [
  view({ id: 'files', name: 'All files', order: 0 }),
  view({ id: 'personal', name: 'Personal files', order: 5 }),
  view({ id: 'recent', name: 'Recent', order: 10 }),
  view({ id: 'search', name: 'Search', order: 10, parent: 'files' }),
  view({ id: 'favorites', name: 'Favorites', order: 15 }),
  view({ id: 'shareoverview', name: 'Shares', order: 20 }),
  view({ id: 'sharingin', name: 'Shared with you', order: 1, parent: 'shareoverview' }),
  view({ id: 'sharingout', name: 'Shared with others', order: 2, parent: 'shareoverview' }),
  view({ id: 'sharinglinks', name: 'Shared by link', order: 3, parent: 'shareoverview' }),
  view({ id: 'filerequest', name: 'File requests', order: 4, parent: 'shareoverview' }),
  view({ id: 'deletedshares', name: 'Deleted shares', order: 5, parent: 'shareoverview' }),
  view({ id: 'pendingshares', name: 'Pending shares', order: 6, parent: 'shareoverview' }),
  view({ id: 'folders', name: 'Folder tree', order: 50 }),
  view({ id: 'trashbin', name: 'Deleted files', order: 50, sticky: true }),
]

function davStat(path: string, type: 'file' | 'folder'): RawNode {
  return { path, basename: path.split('/').pop() ?? '', type, mime: 'application/pdf' }
}

function deps(overrides: Partial<BridgeDeps> = {}): BridgeDeps {
  return {
    navigation: {
      views: CORE_VIEWS,
      addEventListener: () => {},
      removeEventListener: () => {},
      setActive: () => {},
    },
    getFileActions: () => [],
    putFile: async () => {},
    getNewMenuEntries: () => [],
    getListActions: () => [],
    getFilters: () => [],
    // Default fake sorter: identity. Cases that care about ordering inject
    // their own, so no test silently depends on core's comparator.
    sortNodes: (nodes) => nodes,
    t: (_app, text) => text,
    ...overrides,
  }
}

describe('view selection', () => {
  it("never mirrors this app's own Files-app views back into its own nav", () => {
    // Measured on the running instance (2026-08-25): unfiltered, the nav
    // showed "Recent Documents", "AI Filing" and "Ask Filo" a second time,
    // beside the app's real entries — this app's own views are registered into
    // the same shared registry and now reach our own pages.
    const ids = browsableViews([...CORE_VIEWS, ...OWN_VIEWS]).map((v) => v.id)

    expect(ids.filter((id) => id.startsWith('momentum-'))).toEqual([])
    expect(ids).toContain('files')
  })

  it('treats one of its own view ids as unknown rather than half-serving it', async () => {
    const bridge = createBridge(
      deps({
        navigation: {
          views: [...CORE_VIEWS, ...OWN_VIEWS],
          addEventListener: () => {},
          removeEventListener: () => {},
          setActive: () => {},
        },
      }),
    )

    expect(bridge.view('momentum-recent')).toBeUndefined()
    await expect(
      bridge.listContents('momentum-recent', '/', new AbortController().signal),
    ).rejects.toBeInstanceOf(UnknownViewError)
  })

  it('offers every core view except the two that are not listings', () => {
    const ids = browsableViews(CORE_VIEWS).map((v) => v.id)

    expect(ids).not.toContain('search')
    expect(ids).not.toContain('folders')
    expect(NON_BROWSABLE_VIEW_IDS).toEqual(['search', 'folders'])
    // The twelve that remain are the ones the nav must offer.
    expect(ids).toEqual([
      'files',
      'sharingin',
      'sharingout',
      'sharinglinks',
      'filerequest',
      'deletedshares',
      'personal',
      'pendingshares',
      'recent',
      'favorites',
      'shareoverview',
      'trashbin',
    ])
  })

  it('orders by the registry order, falling back to name', () => {
    const ordered = browsableViews([
      view({ id: 'b', name: 'Beta' }),
      view({ id: 'a', name: 'Alpha' }),
      view({ id: 'first', name: 'Zeta', order: 1 }),
    ]).map((v) => v.id)

    // An explicit order always wins over a view with none, whatever its name.
    expect(ordered).toEqual(['first', 'a', 'b'])
  })
})

describe('navigation tree', () => {
  it('nests the six sharing views under Shares and leaves the rest top level', () => {
    const tree = buildNavTree(CORE_VIEWS)

    const shares = tree.find((node) => node.view.id === 'shareoverview')
    expect(shares?.children.map((child) => child.id)).toEqual([
      'sharingin',
      'sharingout',
      'sharinglinks',
      'filerequest',
      'deletedshares',
      'pendingshares',
    ])
    // Children never also appear at the top level.
    expect(tree.map((node) => node.view.id)).toEqual([
      'files',
      'personal',
      'recent',
      'favorites',
      'shareoverview',
      'trashbin',
    ])
  })

  it('promotes a child whose parent is not browsable instead of dropping it', () => {
    // `search` declares `files` as its parent and is itself filtered out; the
    // inverse case — a child whose parent is missing entirely — must still be
    // reachable, because a silently absent nav entry is unexplainable to a user.
    const tree = buildNavTree([
      view({ id: 'child', name: 'Child', parent: 'nowhere' }),
      view({ id: 'files', name: 'All files' }),
    ])

    expect(tree.map((node) => node.view.id)).toContain('child')
  })
})

describe('listContents', () => {
  it('reads the files view through its own getContents too (the Router shim makes that work)', async () => {
    // Earlier this module re-implemented core's DAV PROPFIND for `files` and
    // `personal`, because their getContents reads `window.OCP.Files.Router`
    // and throws without it. That is now supplied by ncFilesRouterShim, so
    // there is exactly ONE read path for every view — and core keeps owning
    // hidden-file and sorting semantics instead of us restating them.
    const getContents = vi.fn<RawView['getContents']>(async () => ({
      folder: { path: '/Invoices' },
      contents: [davStat('/Invoices/a.pdf', 'file')],
    }))
    const bridge = createBridge(
      deps({
        navigation: {
          views: [view({ id: 'files', name: 'All files', getContents })],
          addEventListener: () => {},
          removeEventListener: () => {},
          setActive: () => {},
        },
      }),
    )
    const controller = new AbortController()

    const listing = await bridge.listContents('files', '/Invoices', controller.signal)

    expect(getContents).toHaveBeenCalledWith('/Invoices', { signal: controller.signal })
    expect(listing.folderPath).toBe('/Invoices')
    expect(listing.nodes.map((node) => node.basename)).toEqual(['a.pdf'])
  })

  it('reads every other view through its own getContents, with the required signal option', async () => {
    const controller = new AbortController()
    const getContents = vi.fn<RawView['getContents']>(async () => ({
      folder: { path: '/' },
      contents: [davStat('/shared.pdf', 'file')],
    }))
    const bridge = createBridge(
      deps({
        navigation: {
          views: [view({ id: 'sharingin', name: 'Shared with you', getContents })],
          addEventListener: () => {},
          removeEventListener: () => {},
          setActive: () => {},
        },
      }),
    )

    const listing = await bridge.listContents('sharingin', '/', controller.signal)

    // The options argument is REQUIRED in @nextcloud/files v4: core's own
    // implementations read `options.signal` and throw without it.
    expect(getContents).toHaveBeenCalledWith('/', { signal: controller.signal })
    expect(listing.nodes.map((node) => node.basename)).toEqual(['shared.pdf'])
  })

  it('rejects with UnknownViewError for an unregistered or non-browsable view', async () => {
    const bridge = createBridge(deps())

    await expect(bridge.listContents('nope', '/', new AbortController().signal)).rejects.toBeInstanceOf(
      UnknownViewError,
    )
    // `search` IS registered, but this app does not surface it — asking for it
    // must fail the same way rather than half-working.
    await expect(bridge.listContents('search', '/', new AbortController().signal)).rejects.toBeInstanceOf(
      UnknownViewError,
    )
  })

  // M174.7: `getSidebar().open()` throws "the active folder or view is not
  // set" unless the shared Navigation singleton's active view is set — and
  // nothing outside the Files app's own router was setting it. Listing a view
  // is the one place this page always does when it navigates to one, so it is
  // where the active view is kept in sync.
  it('sets the shared navigation active view to the one it just listed', async () => {
    const setActive = vi.fn()
    const bridge = createBridge(
      deps({
        navigation: {
          views: [view({ id: 'files', name: 'All files' })],
          addEventListener: () => {},
          removeEventListener: () => {},
          setActive,
        },
      }),
    )

    await bridge.listContents('files', '/', new AbortController().signal)

    expect(setActive).toHaveBeenCalledWith('files')
  })
})

describe('file actions', () => {
  const node = toBridgeNode(davStat('/a.pdf', 'file'))

  it('offers the registry actions that report themselves enabled for the node', () => {
    const bridge = createBridge(
      deps({
        getFileActions: () => [
          { id: 'download', displayName: () => 'Download', exec: async () => true },
          { id: 'restore', displayName: () => 'Restore', enabled: () => false, exec: async () => true },
          {
            id: 'broken',
            displayName: () => 'Broken',
            enabled: () => {
              throw new Error('cannot decide')
            },
            exec: async () => true,
          },
        ],
      }),
    )

    const ids = bridge.actionsFor(node, 'files', [node]).map((action) => action.id)

    expect(ids).toEqual(['download'])
  })

  it('marks an action inline when it declares `inline`, without dropping its non-empty label', () => {
    const bridge = createBridge(
      deps({
        getFileActions: () => [
          { id: 'sharing-status', displayName: () => '', inline: () => true, exec: async () => true },
        ],
      }),
    )

    const [action] = bridge.actionsFor(node, 'files', [node])

    expect(action.inline).toBe(true)
    expect(action.label).toBe('')
  })

  it('marks an action inline when it declares ONLY `renderInline` (not `inline`) — the two properties are distinct', () => {
    const bridge = createBridge(
      deps({
        getFileActions: () => [
          { id: 'system-tags', displayName: () => '', renderInline: () => true, exec: async () => true },
        ],
      }),
    )

    const [action] = bridge.actionsFor(node, 'files', [node])

    expect(action.inline).toBe(true)
  })

  it('leaves an ordinary action non-inline', () => {
    const bridge = createBridge(
      deps({ getFileActions: () => [{ id: 'download', displayName: () => 'Download', exec: async () => true }] }),
    )

    const [action] = bridge.actionsFor(node, 'files', [node])

    expect(action.inline).toBe(false)
  })

  it('does not offer an action whose `inline` predicate throws just because it decided badly — falls back to non-inline', () => {
    const bridge = createBridge(
      deps({
        getFileActions: () => [
          {
            id: 'flaky',
            displayName: () => 'Flaky',
            inline: () => {
              throw new Error('cannot decide')
            },
            exec: async () => true,
          },
        ],
      }),
    )

    const [action] = bridge.actionsFor(node, 'files', [node])

    expect(action.inline).toBe(false)
  })

  it('executes an action with the node, view and contents core expects', async () => {
    const exec = vi.fn<(context: unknown) => Promise<boolean>>(async () => true)
    const bridge = createBridge(
      deps({ getFileActions: () => [{ id: 'download', displayName: () => 'Download', exec }] }),
    )

    await bridge.runAction('download', node, 'files', [node])

    const context = exec.mock.calls[0][0] as unknown as {
      nodes: unknown[]
      view: RawView
      contents: unknown[]
    }
    expect(context.nodes).toEqual([node.raw])
    expect(context.view.id).toBe('files')
    expect(context.contents).toEqual([node.raw])
  })

  it('throws rather than silently doing nothing for an action id that is gone', async () => {
    const bridge = createBridge(deps({ getFileActions: () => [] }))

    await expect(bridge.runAction('download', node, 'files', [node])).rejects.toThrow('download')
  })
})

describe('sidebar', () => {
  it('reports unavailable and refuses to open when getSidebar() reports unavailable', () => {
    const bridge = createBridge(deps({ getSidebar: () => ({ available: false, open: () => {} }) }))

    expect(bridge.sidebarAvailable()).toBe(false)
    expect(() => bridge.openSidebar(toBridgeNode(davStat('/a.pdf', 'file')))).toThrow()
  })

  it('reports unavailable and refuses to open when getSidebar is not injected at all', () => {
    const bridge = createBridge(deps({ getSidebar: undefined }))

    expect(bridge.sidebarAvailable()).toBe(false)
    expect(() => bridge.openSidebar(toBridgeNode(davStat('/a.pdf', 'file')))).toThrow()
  })

  it('opens the core sidebar with the raw node, at the requested tab, when it is available', () => {
    const open = vi.fn()
    const bridge = createBridge(deps({ getSidebar: () => ({ available: true, open }) }))
    const node = toBridgeNode(davStat('/a.pdf', 'file'))

    expect(bridge.sidebarAvailable()).toBe(true)
    bridge.openSidebar(node, 'momentum-nl')

    expect(open).toHaveBeenCalledWith(node.raw, 'momentum-nl')
  })

  // M177.3: `M174.7` reached the shared store; nothing rendered it. These
  // cover the piece that lets this page render its OWN sidebar UI off the
  // same registry `getTabs()` already returns.
  describe('sidebarTabsFor', () => {
    function tab(overrides: Partial<RawSidebarTab> & { id: string; tagName: string }): RawSidebarTab {
      return {
        displayName: overrides.id,
        iconSvgInline: '<svg />',
        order: 0,
        ...overrides,
      }
    }

    it('returns no tabs when the sidebar is unavailable', async () => {
      const bridge = createBridge(deps({ getSidebar: () => ({ available: false, open: () => {} }) }))
      const node = toBridgeNode(davStat('/a.pdf', 'file'))

      await expect(bridge.sidebarTabsFor(node)).resolves.toEqual([])
    })

    it('returns no tabs when getSidebar is not injected at all', async () => {
      const bridge = createBridge(deps({ getSidebar: undefined }))
      const node = toBridgeNode(davStat('/a.pdf', 'file'))

      await expect(bridge.sidebarTabsFor(node)).resolves.toEqual([])
    })

    it('drops a tab whose enabled() returns false, or throws', async () => {
      const getTabs = () => [
        tab({ id: 'sharing', tagName: 'nc-sharing-tab', order: 1 }),
        tab({ id: 'disabled', tagName: 'nc-disabled-tab', order: 2, enabled: () => false }),
        tab({
          id: 'throws',
          tagName: 'nc-throws-tab',
          order: 3,
          enabled: () => {
            throw new Error('boom')
          },
        }),
      ]
      const customElements = { get: () => class extends HTMLElement {} }
      const bridge = createBridge(deps({ getSidebar: () => ({ available: true, open: () => {}, getTabs }), customElements }))
      const node = toBridgeNode(davStat('/a.pdf', 'file'))

      const tabs = await bridge.sidebarTabsFor(node)

      expect(tabs.map((t) => t.id)).toEqual(['sharing'])
    })

    it('calls onInit() only for a tab whose custom element is not yet defined, and sorts by order', async () => {
      const defined = new Set(['nc-sharing-tab'])
      const onInitSharing = vi.fn()
      const onInitMomentumNl = vi.fn(() => {
        defined.add('momentum-ask-ai-tab')
      })
      const customElements = { get: (name: string) => (defined.has(name) ? (class extends HTMLElement {} as unknown as CustomElementConstructor) : undefined) }
      const getTabs = () => [
        tab({ id: 'sharing', tagName: 'nc-sharing-tab', order: 2, onInit: onInitSharing }),
        tab({ id: 'momentum-nl', tagName: 'momentum-ask-ai-tab', order: 1, onInit: onInitMomentumNl }),
      ]
      const bridge = createBridge(deps({ getSidebar: () => ({ available: true, open: () => {}, getTabs }), customElements }))
      const node = toBridgeNode(davStat('/a.pdf', 'file'))

      const tabs = await bridge.sidebarTabsFor(node)

      expect(onInitSharing).not.toHaveBeenCalled()
      expect(onInitMomentumNl).toHaveBeenCalledTimes(1)
      expect(tabs.map((t) => t.id)).toEqual(['momentum-nl', 'sharing'])
    })

    it('drops a tab whose onInit() fails to define its element, rather than throwing', async () => {
      const getTabs = () => [tab({ id: 'broken', tagName: 'nc-broken-tab', onInit: () => Promise.reject(new Error('boom')) })]
      const customElements = { get: () => undefined }
      const bridge = createBridge(deps({ getSidebar: () => ({ available: true, open: () => {}, getTabs }), customElements }))
      const node = toBridgeNode(davStat('/a.pdf', 'file'))

      await expect(bridge.sidebarTabsFor(node)).resolves.toEqual([])
    })
  })

  it('closes the core sidebar when available, and is a no-op when it is not', () => {
    const close = vi.fn()
    const withSidebar = createBridge(deps({ getSidebar: () => ({ available: true, open: () => {}, close }) }))
    withSidebar.closeSidebar()
    expect(close).toHaveBeenCalledTimes(1)

    const withoutSidebar = createBridge(deps({ getSidebar: undefined }))
    expect(() => withoutSidebar.closeSidebar()).not.toThrow()
  })
})

describe('registry population is asynchronous', () => {
  it('lets callers subscribe to later registrations and unsubscribe again', () => {
    const listeners: Array<() => void> = []
    const bridge = createBridge(
      deps({
        navigation: {
          views: [],
          addEventListener: (_type, listener) => listeners.push(listener),
          removeEventListener: (_type, listener) => {
            const index = listeners.indexOf(listener)
            if (index >= 0) listeners.splice(index, 1)
          },
          setActive: () => {},
        },
      }),
    )
    const onChange = vi.fn()

    const unsubscribe = bridge.onViewsChanged(onChange)
    listeners.forEach((listener) => listener())
    expect(onChange).toHaveBeenCalledTimes(1)

    unsubscribe()
    expect(listeners).toHaveLength(0)
  })
})

describe('core view columns', () => {
  it('renders a core column as its text content', () => {
    const el = document.createElement('span')
    el.textContent = '  /Invoices/old.pdf  '
    const column = { id: 'files_trashbin--original-location', title: 'Original location', render: () => el }

    expect(renderColumnText(column, toBridgeNode(davStat('/old.pdf', 'file')), {
      id: 'trashbin',
      name: 'Deleted files',
      columns: [],
    })).toBe('/Invoices/old.pdf')
  })

  it('yields an empty cell rather than breaking the row when a column throws', () => {
    const column = {
      id: 'files_trashbin--deleted-by',
      title: 'Deleted by',
      render: () => {
        throw new Error('node not understood')
      },
    }

    expect(renderColumnText(column, toBridgeNode(davStat('/old.pdf', 'file')), {
      id: 'trashbin',
      name: 'Deleted files',
      columns: [],
    })).toBe('')
  })
})

describe('upload', () => {
  const file = {
    name: 'invoice.pdf',
    size: 3,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  }

  it('is offered only where a writable directory actually exists', () => {
    const bridge = createBridge(deps())

    expect(bridge.canUpload('files')).toBe(true)
    expect(bridge.canUpload('personal')).toBe(true)
    expect(WRITABLE_VIEW_IDS).toEqual(['files', 'personal'])
    // Share and trash views are projections, not directories — offering upload
    // there would be an affordance that can only fail.
    expect(bridge.canUpload('sharingin')).toBe(false)
    expect(bridge.canUpload('trashbin')).toBe(false)
  })

  it('hands the file and the current directory to the injected uploader', async () => {
    const putFile = vi.fn<BridgeDeps['putFile']>(async () => {})
    const controller = new AbortController()

    await createBridge(deps({ putFile })).uploadFile('files', '/Invoices', file, controller.signal)

    expect(putFile).toHaveBeenCalledWith('/Invoices', file, controller.signal)
  })

  it('propagates a conflict rather than retrying or overwriting', async () => {
    const putFile = vi.fn<BridgeDeps['putFile']>(async () => {
      throw new UploadConflictError('/Invoices/invoice.pdf')
    })

    await expect(
      createBridge(deps({ putFile })).uploadFile('files', '/Invoices', file),
    ).rejects.toBeInstanceOf(UploadConflictError)
    expect(putFile).toHaveBeenCalledTimes(1)
  })

  it('refuses to upload into a non-writable view', async () => {
    const putFile = vi.fn<BridgeDeps['putFile']>(async () => {})

    await expect(createBridge(deps({ putFile })).uploadFile('sharingin', '/', file)).rejects.toThrow(
      'not a writable location',
    )
    expect(putFile).not.toHaveBeenCalled()
  })
})

// --- M124.1: the Files-app parity surfaces (frontend.md § Files-app parity) --
// The fakes mirror what was MEASURED on NC 34 from /apps/momentum/browse/files
// (2026-08-25): four new-menu entries with categories, `empty-trash` as the
// only file-list action, three filters with web-component tagNames plus two
// without UI, and execBatch on nine file actions.

function listing(nodes: RawNode[] = []): BridgeListing {
  const folderRaw = { path: '/', isFolder: true }
  return {
    folderPath: '/',
    nodes: nodes.map(toBridgeNode),
    folderRaw,
  }
}

describe('new menu', () => {
  const ENTRIES: RawNewMenuEntry[] = [
    { id: 'template-picker', displayName: 'Create templates folder', category: 1, order: 30, handler: () => {} },
    { id: 'newFolder', displayName: 'New folder', category: 1, order: 0, handler: () => {} },
    { id: 'rich-workspace-init', displayName: 'Add folder description', category: 2, handler: () => {} },
    { id: 'upload', displayName: 'Upload files', category: 0, order: 0, handler: () => {} },
  ]

  it('groups by core\'s category first, then order within a category', () => {
    const bridge = createBridge(deps({ getNewMenuEntries: () => ENTRIES }))

    expect(bridge.newMenuEntries(listing()).map((entry) => entry.id)).toEqual([
      'upload', // category 0 — upload from device
      'newFolder', // category 1, order 0
      'template-picker', // category 1, order 30
      'rich-workspace-init', // category 2 — other
    ])
  })

  it('defaults a category-less entry to CreateNew rather than dropping it', () => {
    const bridge = createBridge(
      deps({ getNewMenuEntries: () => [{ id: 'x', displayName: 'X', handler: () => {} }] }),
    )

    expect(bridge.newMenuEntries(listing())[0].category).toBe(1)
  })

  it('omits entries that report themselves disabled for this folder', () => {
    const bridge = createBridge(
      deps({
        getNewMenuEntries: () => [
          { id: 'yes', displayName: 'Yes', handler: () => {} },
          { id: 'no', displayName: 'No', enabled: () => false, handler: () => {} },
          {
            id: 'throws',
            displayName: 'Throws',
            enabled: () => {
              throw new Error('cannot decide')
            },
            handler: () => {},
          },
        ],
      }),
    )

    expect(bridge.newMenuEntries(listing()).map((entry) => entry.id)).toEqual(['yes'])
  })

  it('runs an entry with the real folder object and the listing contents', () => {
    const handler = vi.fn()
    const bridge = createBridge(
      deps({ getNewMenuEntries: () => [{ id: 'newFolder', displayName: 'New folder', handler }] }),
    )
    const current = listing([davStat('/a.pdf', 'file')])

    bridge.runNewMenuEntry('newFolder', current)

    // The FOLDER, not its path: core's handlers create into this object.
    expect(handler).toHaveBeenCalledWith(current.folderRaw, [current.nodes[0].raw])
  })

  it('throws for an entry id that is gone rather than doing nothing', () => {
    const bridge = createBridge(deps({ getNewMenuEntries: () => [] }))

    expect(() => bridge.runNewMenuEntry('newFolder', listing())).toThrow('newFolder')
  })
})

describe('file-list actions', () => {
  it('offers them in order with the view/folder/contents context core expects', () => {
    const displayName = vi.fn<RawListAction['displayName']>(() => 'Empty deleted files')
    const bridge = createBridge(
      deps({
        getListActions: () => [
          { id: 'second', displayName: () => 'Second', order: 10, exec: async () => true },
          { id: 'empty-trash', displayName, order: 0, exec: async () => true },
        ],
      }),
    )
    const current = listing([davStat('/old.pdf', 'file')])

    const actions = bridge.listActionsFor('trashbin', current)

    expect(actions.map((action) => action.id)).toEqual(['empty-trash', 'second'])
    const context = displayName.mock.calls[0][0] as unknown as {
      view: RawView
      folder: unknown
      contents: unknown[]
    }
    expect(context.view.id).toBe('trashbin')
    expect(context.folder).toBe(current.folderRaw)
    expect(context.contents).toEqual([current.nodes[0].raw])
  })

  it('executes one and returns core\'s own result', async () => {
    const exec = vi.fn(async () => true)
    const bridge = createBridge(
      deps({ getListActions: () => [{ id: 'empty-trash', displayName: () => 'Empty', order: 0, exec }] }),
    )

    await expect(bridge.runListAction('empty-trash', 'trashbin', listing())).resolves.toBe(true)
    expect(exec).toHaveBeenCalledTimes(1)
  })
})

describe('filters', () => {
  function fakeFilter(overrides: Partial<RawFilter> & { id: string }): RawFilter & {
    emit: (type: string, detail?: unknown) => void
  } {
    const listeners = new Map<string, Array<(event: { detail?: unknown }) => void>>()
    return {
      order: 0,
      filter: (nodes) => nodes,
      addEventListener: (type, listener) => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener])
      },
      removeEventListener: (type, listener) => {
        listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== listener))
      },
      emit: (type, detail) => {
        for (const listener of listeners.get(type) ?? []) listener({ detail })
      },
      ...overrides,
    }
  }

  it('exposes every registered filter in order, UI and UI-less alike', () => {
    const bridge = createBridge(
      deps({
        getFilters: () => [
          fakeFilter({ id: 'files_sharing:account', order: 100, displayName: 'People', tagName: 'x-people' }),
          fakeFilter({ id: 'files:hidden', order: 0 }),
          fakeFilter({ id: 'files:type', order: 10, displayName: 'Type', tagName: 'x-type' }),
        ],
      }),
    )

    expect(bridge.filters().map((filter) => filter.id)).toEqual([
      'files:hidden',
      'files:type',
      'files_sharing:account',
    ])
    // A UI-less filter still has to be applied — that is where NC's
    // hidden-files behaviour comes from.
    expect(bridge.filters()[0].tagName).toBeUndefined()
    expect(bridge.filters()[1].tagName).toBe('x-type')
  })

  it('applies a filter to the listing by identity, not by rebuilding nodes', () => {
    const keep = davStat('/keep.pdf', 'file')
    const drop = davStat('/drop.pdf', 'file')
    const bridge = createBridge(
      deps({
        getFilters: () => [
          fakeFilter({
            id: 'files:type',
            filter: (nodes) => nodes.filter((node) => (node as RawNode).basename === 'keep.pdf'),
          }),
        ],
      }),
    )
    const nodes = [toBridgeNode(keep), toBridgeNode(drop)]

    const kept = bridge.filters()[0].apply(nodes)

    // The SAME BridgeNode objects survive, so row identity (and therefore
    // selection) is stable across filtering.
    expect(kept).toEqual([nodes[0]])
    expect(kept[0]).toBe(nodes[0])
  })

  it('hands the filter instance to its web component, the contract core documents', () => {
    const filter = fakeFilter({ id: 'files:type', tagName: 'x-type' })
    const bridge = createBridge(deps({ getFilters: () => [filter] }))
    const element: { filter?: unknown } = {}

    bridge.filters()[0].attachTo(element)

    expect(element.filter).toBe(filter)
  })

  it('separates "re-apply" from "re-render chips", and unsubscribes cleanly', () => {
    const filter = fakeFilter({ id: 'files:type', tagName: 'x-type' })
    const bridge = createBridge(deps({ getFilters: () => [filter] }))
    const exposed = bridge.filters()[0]
    const onFilter = vi.fn()
    const onChips = vi.fn()

    const unsubscribe = exposed.subscribe(onFilter, onChips)
    filter.emit('update:filter')
    filter.emit('update:chips', [{ text: 'PDF', onclick: () => {} }])

    expect(onFilter).toHaveBeenCalledTimes(1)
    expect(onChips).toHaveBeenCalledTimes(1)
    // Chips live in the event detail — a filter has no getter for them — so
    // the last emitted set is what `chips()` reports.
    expect(bridge.filters()[0].chips().map((chip) => chip.text)).toEqual(['PDF'])

    unsubscribe()
    filter.emit('update:filter')
    expect(onFilter).toHaveBeenCalledTimes(1)
  })
})

describe('bulk actions', () => {
  const selection = [toBridgeNode(davStat('/a.pdf', 'file')), toBridgeNode(davStat('/b.pdf', 'file'))]

  it('offers only actions that can act on a set', () => {
    const bridge = createBridge(
      deps({
        getFileActions: () => [
          { id: 'delete', displayName: () => 'Delete', exec: async () => true, execBatch: async () => [true] },
          // No execBatch: applying it one-by-one would report success while
          // half a selection silently failed.
          { id: 'rename', displayName: () => 'Rename', exec: async () => true },
        ],
      }),
    )

    expect(bridge.batchActionsFor(selection, 'files', selection).map((a) => a.id)).toEqual(['delete'])
  })

  it('offers nothing for an empty selection', () => {
    const bridge = createBridge(
      deps({
        getFileActions: () => [
          { id: 'delete', displayName: () => 'Delete', exec: async () => true, execBatch: async () => [true] },
        ],
      }),
    )

    expect(bridge.batchActionsFor([], 'files', selection)).toEqual([])
  })

  it('executes with the whole selection and returns core\'s per-node results', async () => {
    const execBatch = vi.fn<NonNullable<RawAction['execBatch']>>(async () => [true, false])
    const bridge = createBridge(
      deps({
        getFileActions: () => [
          { id: 'delete', displayName: () => 'Delete', exec: async () => true, execBatch },
        ],
      }),
    )

    const results = await bridge.runBatchAction('delete', selection, 'files', selection)

    expect(results).toEqual([true, false])
    const context = execBatch.mock.calls[0][0] as unknown as { nodes: unknown[] }
    expect(context.nodes).toEqual(selection.map((node) => node.raw))
  })

  it('refuses an action that cannot batch instead of silently looping it', async () => {
    const bridge = createBridge(
      deps({
        getFileActions: () => [{ id: 'rename', displayName: () => 'Rename', exec: async () => true }],
      }),
    )

    await expect(bridge.runBatchAction('rename', selection, 'files', selection)).rejects.toThrow(
      'cannot act on a selection',
    )
  })
})

describe('sorting', () => {
  it('delegates to core\'s comparator, folders first by default', async () => {
    const sortNodes = vi.fn<BridgeDeps['sortNodes']>((nodes) => [...nodes].reverse())
    const bridge = createBridge(deps({ sortNodes }))
    const nodes = [toBridgeNode(davStat('/a.pdf', 'file')), toBridgeNode(davStat('/b.pdf', 'file'))]

    const sorted = bridge.sortNodes(nodes, { column: 'basename', direction: 'asc' })

    expect(sortNodes.mock.calls[0][1]).toEqual({
      sortingMode: 'basename',
      sortingOrder: 'asc',
      sortFoldersFirst: true,
      sortFavoritesFirst: false,
    })
    // Same node objects, reordered — never rebuilt, so selection survives a
    // re-sort.
    expect(sorted).toEqual([nodes[1], nodes[0]])
  })

  it('drops nothing when core returns a node it was not given', () => {
    // Defensive: the mapping back is by identity, and a comparator that
    // returned a foreign object would otherwise put `undefined` in the list.
    const bridge = createBridge(deps({ sortNodes: () => [{ foreign: true }] }))
    const nodes = [toBridgeNode(davStat('/a.pdf', 'file'))]

    expect(bridge.sortNodes(nodes, { column: 'basename', direction: 'asc' })).toEqual([])
  })
})
