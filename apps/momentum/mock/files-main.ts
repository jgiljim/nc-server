// Entry point for the "All Files" mock (see README.md's "Files-app view").
// Loads the real, unmodified `../src/files-entry.ts` — the bundle
// `LoadAdditionalScriptsListener.php` injects into every real Nextcloud
// Files page — against the same mocked host/API `main.ts` uses, then renders
// a deliberately minimal stand-in for the real Files app's own UI (sidebar of
// registered views + a plain table for the active view's contents) just
// enough to exercise `momentumFilesView.ts`'s real `registerMomentumView()`
// output. The real Files app itself (breadcrumbs, drag-drop, its own file
// actions, the sidebar panel `registerSidebarTab` feeds) is Nextcloud core,
// not something this harness reimplements — see README.md.
import './host'
import { getNavigation } from '@nextcloud/files'
import { generateUrl } from '@nextcloud/router'
import '../src/files-entry'

interface RenderableView {
  id: string
  name: string
  parent?: string
  order?: number
  getContents: (path: string) => Promise<{ contents: unknown[] }>
  columns?: { id: string; title: string; render: (node: unknown, view?: unknown) => HTMLElement | null | undefined }[]
  emptyView?: (div: HTMLDivElement) => void
}

// The real `Navigation`/`View` types (`@nextcloud/files`) are wider than this
// — only the members this renderer reads.
function views(): RenderableView[] {
  return (getNavigation().views as unknown as RenderableView[]).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

const sidebar = document.getElementById('momentum-files-sidebar') as HTMLElement
const main = document.getElementById('momentum-files-main') as HTMLElement

let activeViewId: string | undefined

function renderSidebar(): void {
  const all = views()
  const topLevel = all.filter((view) => !view.parent)
  sidebar.replaceChildren()
  const list = document.createElement('ul')
  list.className = 'momentum-files-nav'
  for (const view of topLevel) {
    list.appendChild(renderNavItem(view, all))
  }
  sidebar.appendChild(list)
}

function renderNavItem(view: RenderableView, all: RenderableView[]): HTMLElement {
  const li = document.createElement('li')
  const link = document.createElement('a')
  link.href = '#'
  link.textContent = view.name
  link.dataset.testid = 'mock-files-nav-item'
  link.className = view.id === activeViewId ? 'active' : ''
  link.addEventListener('click', (event) => {
    event.preventDefault()
    activeViewId = view.id
    renderSidebar()
    void renderMain(view)
  })
  li.appendChild(link)

  const children = all.filter((candidate) => candidate.parent === view.id)
  if (children.length > 0) {
    const childList = document.createElement('ul')
    for (const child of children) childList.appendChild(renderNavItem(child, all))
    li.appendChild(childList)
  }
  return li
}

function cellText(el: HTMLElement | null | undefined): string {
  return el?.textContent ?? ''
}

async function renderMain(view: RenderableView): Promise<void> {
  main.replaceChildren()
  const heading = document.createElement('h2')
  heading.textContent = view.name
  main.appendChild(heading)

  const status = document.createElement('p')
  status.textContent = 'Loading…'
  main.appendChild(status)

  let contents: unknown[]
  try {
    ;({ contents } = await view.getContents('/'))
  } catch (error) {
    status.textContent = `Failed to load: ${String(error)}`
    return
  }
  status.remove()

  if (contents.length === 0) {
    if (view.emptyView) {
      const emptyHost = document.createElement('div')
      emptyHost.className = 'momentum-files-empty'
      main.appendChild(emptyHost)
      // Ask Filo's real emptyView (frontend.md § Ask AI Sidebar) mounts an
      // iframe pointed at the real `https://gpt.ionos.com` — safe to call
      // as-is (no throw, no local network dependency), but it will 404/
      // refuse to embed outside a real IonosGPT deployment. Expected; see
      // README.md.
      view.emptyView(emptyHost)
    } else {
      const empty = document.createElement('p')
      empty.textContent = 'No documents.'
      main.appendChild(empty)
    }
    return
  }

  const table = document.createElement('table')
  table.className = 'momentum-files-table'
  const columns = view.columns ?? []
  const headRow = document.createElement('tr')
  for (const title of ['Name', ...columns.map((c) => c.title)]) {
    const th = document.createElement('th')
    th.textContent = title
    headRow.appendChild(th)
  }
  const thead = document.createElement('thead')
  thead.appendChild(headRow)
  table.appendChild(thead)

  const tbody = document.createElement('tbody')
  for (const node of contents) {
    const row = document.createElement('tr')
    const nameCell = document.createElement('td')
    const basename = (node as { basename?: string }).basename ?? ''
    const docId = (node as { attributes?: Record<string, unknown> }).attributes?.['momentum-doc-id']
    if (typeof docId === 'string' && docId) {
      const link = document.createElement('a')
      link.href = generateUrl(`/apps/momentum/document/${encodeURIComponent(docId)}`)
      link.textContent = basename
      link.dataset.testid = 'mock-files-row-open'
      nameCell.appendChild(link)
    } else {
      nameCell.textContent = basename
    }
    row.appendChild(nameCell)
    for (const column of columns) {
      const td = document.createElement('td')
      td.textContent = cellText(column.render(node, view))
      row.appendChild(td)
    }
    tbody.appendChild(row)
  }
  table.appendChild(tbody)
  main.appendChild(table)
}

// `registerMomentumView()` (called by the `../src/files-entry` import above)
// registers the three top-level views synchronously, then the per-type
// AI Filing children once `GET /document-types` resolves — `Navigation`
// dispatches an `update` event on every `register()` call (both batches), so
// re-rendering on it picks up the children without polling.
const nav = getNavigation()
nav.addEventListener('update', () => {
  renderSidebar()
  if (!activeViewId) {
    const [first] = views()
    if (first) {
      activeViewId = first.id
      void renderMain(first)
    }
  }
})
renderSidebar()
