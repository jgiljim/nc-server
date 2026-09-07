import { generateUrl } from '@nextcloud/router'
import { createRouter, createWebHistory } from 'vue-router'
import AiFilingDashboardPage from '../views/AiFilingDashboardPage.vue'
import DocumentsListPage from '../views/DocumentsListPage.vue'
import ByTypeDocumentListPage from '../views/ByTypeDocumentListPage.vue'
import RecentDocumentsPage from '../views/RecentDocumentsPage.vue'
import DocumentViewerPage from '../views/DocumentViewerPage.vue'
import NlQueryPage from '../views/NlQueryPage.vue'
import FileBrowserPage from '../views/FileBrowserPage.vue'

// frontend.md § Page Routes — the server (appinfo/routes.php) registers the
// same five sub-paths under the `/apps/momentum` prefix, all served by the
// same Page#index action; this router owns navigation between them from
// there on.
//
// The base has to come from `generateUrl`, not a hardcoded '/apps/momentum':
// on an instance without mod_rewrite (`_oc_config.modRewriteWorking: false`,
// which is the default for the dev container) every NC url carries an
// `/index.php` prefix, so the page actually lives at
// `/index.php/apps/momentum`. With the hardcoded base, vue-router failed to
// strip it from `location.pathname`, treated the whole path as the route, and
// its first `replaceState` rewrote the address bar to the nonsense
// `/apps/momentum/index.php/apps/momentum` — which then 404s on reload.
// `generateUrl` also picks up a subdirectory webroot for free.
export const router = createRouter({
  history: createWebHistory(generateUrl('/apps/momentum')),
  routes: [
    // The landing page is the cross-type Documents table (M125.2): the nav's
    // "Documents" entry, and `appinfo/info.xml`'s Nextcloud navigation entry
    // (which points at the root route `momentum.page.index`), both land here.
    { path: '/', name: 'documents', component: DocumentsListPage },
    // The AI Filing dashboard keeps a route and stays reachable; it left the
    // nav when document type became a column instead of a submenu.
    { path: '/ai-filing', name: 'ai-filing', component: AiFilingDashboardPage },
    { path: '/type/:typeName', name: 'by-type-document-list', component: ByTypeDocumentListPage },
    { path: '/recent', name: 'recent-documents', component: RecentDocumentsPage },
    { path: '/document/:docId', name: 'document-viewer', component: DocumentViewerPage },
    { path: '/chat', name: 'nl-query', component: NlQueryPage },
    // One route for every Nextcloud file view (frontend.md § Files & Shares
    // Bridge): `viewId` is a registry view id, `?dir=` the folder within it —
    // the same url shape the Files app uses.
    { path: '/browse/:viewId', name: 'file-browser', component: FileBrowserPage },
  ],
})
