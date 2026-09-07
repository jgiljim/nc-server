import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  AI_FILING_VIEW_ID,
  ASK_FILO_VIEW_ID,
  DEFAULT_PAGE_SIZE,
  RECENT_SORT,
  RECENT_VIEW_ID,
  createAskFiloEmptyView,
  createMomentumColumns,
  createMomentumGetContents,
  registerMomentumView,
  toFileNode,
  type MomentumFileNode,
  type MomentumViewDeps,
} from './momentumFilesView'

// frontend.md § File-Browser View Integration (M4.14), adapted to the real
// `@nextcloud/files@3.12.2` contract (see momentumFilesView.ts's header
// comment) rather than frontend.md's illustrative snippet. The module is
// pure/injectable, so these tests exercise it with stubbed NC-runtime deps
// and a fake axios — no Nextcloud packages required.

interface StubbedDeps extends MomentumViewDeps {
  registered: unknown[]
  fileConfigs: Record<string, unknown>[]
  folderConfigs: Record<string, unknown>[]
  get: ReturnType<typeof vi.fn>
  // Typed against the dep's own signature (rather than the untyped
  // `ReturnType<typeof vi.fn>` the older fakes here use) because this one
  // *overrides* a `MomentumViewDeps` member, so the two types have to agree.
  mountEmbed: Mock<NonNullable<MomentumViewDeps['mountEmbed']>>
  destroyEmbed: ReturnType<typeof vi.fn>
}

// Reads the config of every registered view, keyed by id — index-based lookups
// would break every time a view is added ahead of another in registration
// order, which says nothing about what the Files sidebar actually shows (that
// is `order`).
function configById(deps: StubbedDeps): Record<string, Record<string, unknown>> {
  const byId: Record<string, Record<string, unknown>> = {}
  for (const view of deps.registered) {
    const { config } = view as { config: Record<string, unknown> }
    byId[config.id as string] = config
  }
  return byId
}

function makeDeps(get: ReturnType<typeof vi.fn>): StubbedDeps {
  const registered: unknown[] = []
  const fileConfigs: Record<string, unknown>[] = []
  const folderConfigs: Record<string, unknown>[] = []

  class FakeFile {
    attributes: Record<string, unknown>
    config: Record<string, unknown>
    constructor(config: Record<string, unknown>) {
      this.config = config
      this.attributes = (config.attributes as Record<string, unknown>) ?? {}
      fileConfigs.push(config)
    }
  }

  class FakeFolder {
    attributes: Record<string, unknown>
    config: Record<string, unknown>
    constructor(config: Record<string, unknown>) {
      this.config = config
      this.attributes = {}
      folderConfigs.push(config)
    }
  }

  class FakeView {
    config: Record<string, unknown>
    constructor(config: Record<string, unknown>) {
      this.config = config
    }
  }

  const destroyEmbed = vi.fn()
  const mountEmbed: Mock<NonNullable<MomentumViewDeps['mountEmbed']>> = vi.fn(
    (container: HTMLElement) => {
      container.appendChild(document.createElement('iframe'))
      return { destroy: destroyEmbed }
    },
  )

  return {
    registered,
    fileConfigs,
    folderConfigs,
    get,
    mountEmbed,
    destroyEmbed,
    Navigation: { register: (view) => registered.push(view) },
    View: FakeView as unknown as MomentumViewDeps['View'],
    File: FakeFile as unknown as MomentumViewDeps['File'],
    Folder: FakeFolder as unknown as MomentumViewDeps['Folder'],
    axios: { get: get as unknown as MomentumViewDeps['axios']['get'] },
    generateUrl: (path) => `/index.php${path}`,
    t: (_app, text) => text,
    uid: 'alice',
    davRootUrl: 'https://cloud.example/remote.php/dav/files/alice',
  }
}

const DOC = {
  public_id: '42424242-4242-4242-4242-424242424242',
  path: '/acme-q1.pdf',
  doc_type: 'Invoice',
  direction: 'inbound',
  status: 'done',
  reviewed: true,
  created_at: '2026-07-20T00:00:00Z',
}

describe('toFileNode', () => {
  it('maps a search item onto a File node with a real DAV source and owner', () => {
    const deps = makeDeps(vi.fn())
    const node = toFileNode(deps, DOC)

    expect(node.attributes).toEqual({
      'momentum-doc-id': '42424242-4242-4242-4242-424242424242',
      'momentum-type': 'Invoice',
      'momentum-direction': 'inbound',
      'momentum-status': 'done',
      'momentum-reviewed': true,
    })
    expect(deps.fileConfigs[0].source).toBe('https://cloud.example/remote.php/dav/files/alice/acme-q1.pdf')
    expect(deps.fileConfigs[0].owner).toBe('alice')
    expect(deps.fileConfigs[0].root).toBe('/files/alice')
    expect(deps.fileConfigs[0].id).toBe('42424242-4242-4242-4242-424242424242')
    expect(deps.fileConfigs[0].mtime).toEqual(new Date('2026-07-20T00:00:00Z'))
    // M21.15: without this, `@nextcloud/files`' Node.permissions getter
    // resolves to Permission.NONE, and the built-in sidebar "Sharing"
    // action's enabled() check refuses to open the sidebar at all for the
    // node — see momentumFilesView.ts's PERMISSION_READ comment.
    expect(deps.fileConfigs[0].permissions).toBe(1)
  })

  it('strips the API\'s /<uid>/files/ internal-storage prefix from path before building the DAV source', () => {
    // Confirmed live, 2026-07-28: GET /documents/{id} returns `path` as
    // Nextcloud's own Node::getPath() ("/<uid>/files/<relative>"), not a
    // home-relative path — naively appending it to davRootUrl doubles the uid.
    const deps = makeDeps(vi.fn())
    const node = toFileNode(deps, { ...DOC, path: '/alice/files/Invoices/acme-q1.pdf' })

    expect(deps.fileConfigs[0].source).toBe(
      'https://cloud.example/remote.php/dav/files/alice/Invoices/acme-q1.pdf',
    )
  })

  it('defaults missing fields rather than emitting undefined attributes', () => {
    const deps = makeDeps(vi.fn())
    const node = toFileNode(deps, { public_id: '77777777-7777-7777-7777-777777777777' })

    expect(node.attributes).toEqual({
      'momentum-doc-id': '77777777-7777-7777-7777-777777777777',
      'momentum-type': '',
      'momentum-direction': '',
      'momentum-status': '',
      'momentum-reviewed': false,
    })
  })
})

describe('createMomentumColumns', () => {
  const columns = createMomentumColumns({ t: (_app, text) => text })

  it('defines the four display-only columns in spec order', () => {
    expect(columns.map((c) => c.id)).toEqual([
      'momentum-type',
      'momentum-direction',
      'momentum-status',
      'momentum-reviewed',
    ])
  })

  it('renders text values from node attributes', () => {
    const node = toFileNode(makeDeps(vi.fn()), DOC)
    expect(columns[0].render(node).textContent).toBe('Invoice')
    expect(columns[1].render(node).textContent).toBe('inbound')
    expect(columns[2].render(node).textContent).toBe('done')
  })

  it('renders a check for reviewed and a dash for unreviewed', () => {
    const reviewed = toFileNode(makeDeps(vi.fn()), { public_id: '11111111-1111-1111-1111-111111111111', reviewed: true })
    const unreviewed = toFileNode(makeDeps(vi.fn()), { public_id: '22222222-2222-2222-2222-222222222222', reviewed: false })
    expect(columns[3].render(reviewed).textContent).toBe('✓')
    expect(columns[3].render(unreviewed).textContent).toBe('—')
  })

  it('renders a dash for empty text columns', () => {
    const empty: MomentumFileNode = { attributes: {} }
    expect(columns[0].render(empty).textContent).toBe('—')
    expect(columns[1].render(empty).textContent).toBe('—')
  })
})

describe('createMomentumGetContents', () => {
  it('reads GET /search/documents with the default limit and no type filter for the root view', async () => {
    const get = vi.fn().mockResolvedValue({ data: { items: [DOC] } })
    const deps = makeDeps(get)

    const result = await createMomentumGetContents(deps)('/')

    const url = get.mock.calls[0][0] as string
    const params = new URL(url, 'http://x').searchParams
    expect(params.has('type_name')).toBe(false)
    expect(params.get('limit')).toBe(String(DEFAULT_PAGE_SIZE))
    expect(url).toContain('/apps/momentum/api/search/documents')

    expect(result.folder).toBeDefined()
    expect(result.contents).toHaveLength(1)
    expect(result.contents[0].attributes['momentum-type']).toBe('Invoice')
    // M21.15: the synthetic root folder needs Permission.READ too, for the
    // same sidebarAction.ts open-eligibility reason as toFileNode's docs.
    expect((deps.folderConfigs[0] as { permissions: number }).permissions).toBe(1)
  })

  // M4.14 follow-up (frontend.md § Files-App Navigation Entries): the Recent
  // Documents entry is the same search, newest-first, so the two cross-type
  // lists in the sidebar differ by sort rather than by content.
  it('passes a sort verbatim when one is given', async () => {
    const get = vi.fn().mockResolvedValue({ data: { items: [] } })
    const deps = makeDeps(get)

    await createMomentumGetContents(deps, undefined, RECENT_SORT)('/')

    const params = new URL(get.mock.calls[0][0] as string, 'http://x').searchParams
    expect(params.get('sort')).toBe('created_at:desc')
    expect(params.has('type_name')).toBe(false)
  })

  it('omits sort entirely when none is given', async () => {
    const get = vi.fn().mockResolvedValue({ data: { items: [] } })
    const deps = makeDeps(get)

    await createMomentumGetContents(deps)('/')

    const params = new URL(get.mock.calls[0][0] as string, 'http://x').searchParams
    expect(params.has('sort')).toBe(false)
  })

  it('passes type_name verbatim for a per-type sub-view', async () => {
    const get = vi.fn().mockResolvedValue({ data: { items: [] } })
    const deps = makeDeps(get)

    await createMomentumGetContents(deps, 'contract')('/')

    const params = new URL(get.mock.calls[0][0] as string, 'http://x').searchParams
    expect(params.get('type_name')).toBe('contract')
  })

  it('returns the root folder with no contents when the API errors', async () => {
    const get = vi.fn().mockRejectedValue(new Error('503'))
    const deps = makeDeps(get)

    const result = await createMomentumGetContents(deps)('/')

    expect(result.contents).toEqual([])
    expect(result.folder).toBeDefined()
  })
})

describe('registerMomentumView', () => {
  it('registers the AI Filing root view plus one sub-view per document type', async () => {
    const get = vi.fn().mockResolvedValue({
      data: { types: [{ type_name: 'invoice', display_name: 'Invoice' }, { type_name: 'contract' }] },
    })
    const deps = makeDeps(get)

    await registerMomentumView(deps)

    const byId = configById(deps)
    expect(byId[AI_FILING_VIEW_ID].name).toBe('AI Filing')
    expect(byId[AI_FILING_VIEW_ID].order).toBe(25)
    expect(typeof byId[AI_FILING_VIEW_ID].getContents).toBe('function')

    expect(byId[`${AI_FILING_VIEW_ID}-invoice`]).toMatchObject({
      name: 'Invoice',
      parent: AI_FILING_VIEW_ID,
    })
    // Falls back to type_name when display_name is absent.
    expect(byId[`${AI_FILING_VIEW_ID}-contract`]).toMatchObject({
      name: 'contract',
      parent: AI_FILING_VIEW_ID,
    })
    expect(get).toHaveBeenCalledWith('/index.php/apps/momentum/api/document-types')
  })

  // frontend.md § Files-App Navigation Entries — the Files sidebar carries the
  // same three top-level entries as the app's own navigation tree, in the same
  // order, since a Files `View` cannot link out to `/apps/momentum/*` (its nav
  // item always routes to the Files app's own `filelist` route).
  it('registers all three top-level entries in navigation-tree order', async () => {
    const get = vi.fn().mockResolvedValue({ data: { types: [] } })
    const deps = makeDeps(get)

    await registerMomentumView(deps)

    const byId = configById(deps)
    expect(byId[RECENT_VIEW_ID]).toMatchObject({ name: 'Recent Documents', order: 24 })
    expect(byId[AI_FILING_VIEW_ID]).toMatchObject({ name: 'AI Filing', order: 25 })
    expect(byId[ASK_FILO_VIEW_ID]).toMatchObject({ name: 'Chat', order: 26 })
    // No `parent` on any of them: all three are top-level siblings of the
    // Files app's own views, not children of AI Filing.
    for (const id of [RECENT_VIEW_ID, AI_FILING_VIEW_ID, ASK_FILO_VIEW_ID]) {
      expect(byId[id].parent).toBeUndefined()
    }
  })

  it('gives the Recent Documents view the newest-first sort and no type filter', async () => {
    const get = vi.fn().mockResolvedValue({ data: { types: [] } })
    const deps = makeDeps(get)
    await registerMomentumView(deps)

    const getContents = configById(deps)[RECENT_VIEW_ID].getContents as (
      path: string,
    ) => Promise<unknown>
    get.mockResolvedValue({ data: { items: [] } })
    await getContents('/')

    const params = new URL(get.mock.calls.at(-1)![0] as string, 'http://x').searchParams
    expect(params.get('sort')).toBe('created_at:desc')
    expect(params.has('type_name')).toBe(false)
  })

  it('registers Ask Filo as a contentless view that renders the embed instead', async () => {
    const get = vi.fn().mockResolvedValue({ data: { types: [] } })
    const deps = makeDeps(get)
    await registerMomentumView(deps)

    const askFilo = configById(deps)[ASK_FILO_VIEW_ID]
    const callsBefore = get.mock.calls.length

    const result = (await (askFilo.getContents as (p: string) => Promise<{ contents: unknown[] }>)(
      '/',
    )) as { contents: unknown[] }

    // Zero contents is what makes the Files app render `emptyView` at all
    // (apps/files/src/views/FilesList.vue's showCustomEmptyView), and there is
    // no document list to fetch for a chat panel — so it must not call the API.
    expect(result.contents).toEqual([])
    expect(get.mock.calls).toHaveLength(callsBefore)
    expect(typeof askFilo.emptyView).toBe('function')
  })

  it('still registers all three top-level entries when the type list fails to load', async () => {
    const get = vi.fn().mockRejectedValue(new Error('down'))
    const deps = makeDeps(get)

    await registerMomentumView(deps)

    // The per-type children are best-effort; the three entries the user
    // navigates by are not.
    expect(Object.keys(configById(deps)).sort()).toEqual(
      [AI_FILING_VIEW_ID, ASK_FILO_VIEW_ID, RECENT_VIEW_ID].sort(),
    )
  })

  it('skips types with no type_name', async () => {
    const get = vi.fn().mockResolvedValue({
      data: { types: [{ display_name: 'Nameless' }, { type_name: 'invoice' }] },
    })
    const deps = makeDeps(get)

    await registerMomentumView(deps)

    const ids = deps.registered.map((v) => (v as { config: { id: string } }).config.id)
    expect(ids.filter((id) => id.startsWith(`${AI_FILING_VIEW_ID}-`))).toEqual([
      `${AI_FILING_VIEW_ID}-invoice`,
    ])
  })
})

// frontend.md § Ask Filo (Files app) — `emptyView` is the documented hook for
// rendering custom DOM into the file-list area (core's own
// apps/files/src/views/search.ts uses it), and the M4.13 embed primitive is
// framework-free, so the chat panel needs no Vue in this bundle.
describe('createAskFiloEmptyView', () => {
  it('mounts the corpus-scoped embed into the container the Files app hands it', () => {
    const deps = makeDeps(vi.fn())
    const div = document.createElement('div')

    createAskFiloEmptyView(deps)(div)

    expect(deps.mountEmbed).toHaveBeenCalledTimes(1)
    expect(deps.mountEmbed.mock.calls[0][0]).toBe(div)
    expect(deps.mountEmbed.mock.calls[0][1]).toEqual({ mode: 'corpus' })
    expect(div.querySelectorAll('iframe')).toHaveLength(1)
  })

  it('replaces a previous embed rather than stacking iframes', () => {
    const deps = makeDeps(vi.fn())
    const div = document.createElement('div')
    const emptyView = createAskFiloEmptyView(deps)

    // The Files app calls emptyView again on every re-entry into the view
    // (FilesList.vue's showCustomEmptyView watcher).
    emptyView(div)
    emptyView(div)

    expect(deps.destroyEmbed).toHaveBeenCalledTimes(1)
    expect(div.querySelectorAll('iframe')).toHaveLength(1)
  })

  it('makes the container fill the empty-view wrapper so the iframe has a box', () => {
    const deps = makeDeps(vi.fn())
    const div = document.createElement('div')

    createAskFiloEmptyView(deps)(div)

    // .files-list__empty-view-wrapper is `display:flex; height:100%`, and the
    // div handed to emptyView is an unstyled child of it — an iframe in there
    // collapses to nothing without this.
    expect(div.style.display).toBe('flex')
    expect(div.style.flex).toBe('1 1 auto')
    expect(div.style.minHeight).toBe('0')
  })
})
