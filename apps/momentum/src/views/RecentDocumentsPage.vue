<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import DocumentList from '../components/DocumentList.vue'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import { excludeStaticColumns } from '../components/columnExclusion'
import { FileOutlineIcon, FilterOffOutlineIcon } from '../components/icons'
import { URL_PARAM_FILTER, decodeFilterParams } from '../components/urlState'
import { fetchSearchDocuments } from '../services/documents'
import { t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import type { ActiveFilter, ColumnDef, FilterableField, Page, SortState, TableRow } from '../types'
import type { SearchItemDTO } from '../services/documents'

// frontend.md § Recent Documents (M4.8): the cross-type document list —
// GET /search/documents with no `type_name`, so only the built-in system
// columns are shown (no extracted fields, unlike the By-Type List, M4.7).

// M178.1 (backlog/v1.md Phase 178): see DocumentsListPage's identical note —
// a read-only look at the `f` URL param DocumentList writes on every filter
// change, used only to distinguish "nothing recent" from "nothing matches
// the current filters" below.
const route = useRoute()
const hasActiveFilters = computed(() => decodeFilterParams(route.query[URL_PARAM_FILTER]).length > 0)

const DEFAULT_SORT: SortState = { column: 'created_at', direction: 'desc' }

const COLUMNS: ColumnDef[] = excludeStaticColumns([
  { key: 'filename', label: t('momentum', 'Filename'), dataType: 'string', defaultVisible: true },
  { key: 'doc_type', label: t('momentum', 'Document type'), dataType: 'string', sortable: true, defaultVisible: true },
  {
    key: 'created_at',
    label: t('momentum', 'Date added'),
    dataType: 'date',
    sortable: true,
    defaultVisible: true,
    cursorPaginated: true,
  },
  {
    key: 'updated_at',
    label: t('momentum', 'Updated'),
    dataType: 'date',
    sortable: true,
    defaultVisible: true,
    cursorPaginated: true,
  },
  { key: 'status', label: t('momentum', 'Status'), dataType: 'string', sortable: true, defaultVisible: true },
  { key: 'reviewed', label: t('momentum', 'Reviewed'), dataType: 'boolean', sortable: true, defaultVisible: true },
])

// No extracted-field filters apply to the cross-type view (api.md §
// GET /search/documents: extracted-field filters are "by-type search
// only") — DocumentList (M4.4) always prepends the status/reviewed/
// direction built-ins ahead of whatever's passed here.
const FILTERABLE_FIELDS: FilterableField[] = []

function basename(path: string | undefined): string {
  if (!path) return ''
  const segments = path.split('/')
  return segments[segments.length - 1] || path
}

// A NULL doc_type reads two different ways: "not classified yet"
// (doc_type_source unset or 'ai') versus the classifier's explicit "no
// registry type fits" outcome (doc_type_source === 'none', M151.3/M179.3,
// backlog/v1.md Phase 179) — DocumentViewerPage's isUndefinedType already
// makes this same distinction; this is its list-surface companion, closing
// the gap M151.9 left open here.
function typeCell(item: SearchItemDTO): string {
  if (item.doc_type) return item.doc_type
  if (item.doc_type_source === 'none') return t('momentum', 'Undefined')
  return ''
}

function toTableRow(item: SearchItemDTO): TableRow {
  return {
    id: item.public_id ?? '',
    cells: {
      filename: basename(item.path),
      mime_type: item.mime_type ?? '',
      doc_type: typeCell(item),
      created_at: item.created_at,
      updated_at: item.updated_at,
      status: item.status,
      reviewed: item.reviewed,
      snippet: item.snippet ?? null,
    },
  }
}

async function fetchPage(
  cursor: string | undefined,
  sort: SortState,
  filters: ActiveFilter[],
): Promise<Page> {
  const response = await fetchSearchDocuments({ sort, filters, cursor })
  return {
    items: (response.items ?? []).map(toTableRow),
    // The API sends `next_cursor: null` on the wire to mean "no more pages" —
    // normalize to `undefined` here so Page's stated contract ("absent once
    // the last page is reached") holds true rather than merely being assumed.
    next_cursor: response.next_cursor ?? undefined,
    limit: response.limit,
  }
}

// "Add new" (frontend.md § DocumentList toolbar item 5) opens the NC Files
// app's own drag-and-drop/upload UI in a new tab — the ingest folder(s) a
// document lands in are a server-side FilesystemEventListener/group-folder
// concern the frontend has no notion of, so this defers to NC's real upload
// experience rather than guessing at a destination or reimplementing it.
function handleAddNew(): void {
  window.open(generateUrl('/apps/files'), '_blank', 'noopener')
}
</script>

<template>
  <div class="momentum-page momentum-page--recent-documents">
    <DocumentList
      :columns="COLUMNS"
      :fetch-page="fetchPage"
      :filterable-fields="FILTERABLE_FIELDS"
      :default-sort="DEFAULT_SORT"
      persist-key="recent"
      reserve-nav-toggle-corner
      class="momentum-recent-documents__list"
      @add-new="handleAddNew">
      <template #empty>
        <NcEmptyContent
          v-if="hasActiveFilters"
          :name="t('momentum', 'No documents match your filters')"
          :description="t('momentum', 'Remove a filter above to see more documents.')">
          <template #icon>
            <FilterOffOutlineIcon />
          </template>
        </NcEmptyContent>
        <NcEmptyContent
          v-else
          :name="t('momentum', 'No recent documents')"
          :description="t('momentum', 'Documents added to this tenant will appear here.')">
          <template #icon>
            <FileOutlineIcon />
          </template>
        </NcEmptyContent>
      </template>
    </DocumentList>
  </div>
</template>

<style scoped>
/* backlog Phase 93 / M93.1: without this, the content pane's height never
   reaches DocumentList/VirtualTable, so .virtual-table__body never becomes
   the scroller and the virtualiser only ever renders its first window
   (ByTypeDocumentListPage already gets this right — this mirrors it). */
.momentum-page--recent-documents {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.momentum-recent-documents__list {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
