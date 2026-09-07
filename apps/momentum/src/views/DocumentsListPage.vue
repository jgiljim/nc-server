<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import DocumentList from '../components/DocumentList.vue'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import { excludeStaticColumns } from '../components/columnExclusion'
import { FileOutlineIcon, FilterOffOutlineIcon } from '../components/icons'
import { URL_PARAM_FILTER, decodeFilterParams } from '../components/urlState'
import { fetchDocumentTypes, fetchSearchDocuments } from '../services/documents'
import { t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import type { ActiveFilter, ColumnDef, FilterableField, Page, SortState, TableRow } from '../types'
import type { DocumentTypeDTO, SearchItemDTO } from '../services/documents'

// Documents — the cross-type document table (frontend.md § Documents, M125.2).
// This is what the nav's "Documents" entry opens, and what replaced its
// per-type submenu: document type is a COLUMN here, sortable and filterable,
// rather than a navigation axis with one entry per type.
//
// Same query as Recent Documents (`GET /search/documents`, no `type_name`
// scope); the difference is that type is filterable from a chosen-from list and
// sortable as a real column.

// M178.1 (backlog/v1.md Phase 178): DocumentList owns the active-filter state
// and never exposes it directly, but it does write it into the `f` URL param
// on every add/remove/search-commit (urlState.ts). Reading that param back is
// a read-only signal — not a change to DocumentList's own plumbing — used
// only to tell "nothing ingested yet" apart from "nothing matches the
// current filters" in the empty-state text below.
const route = useRoute()
const hasActiveFilters = computed(() => decodeFilterParams(route.query[URL_PARAM_FILTER]).length > 0)

const DEFAULT_SORT: SortState = { column: 'created_at', direction: 'desc' }

const COLUMNS: ColumnDef[] = excludeStaticColumns([
  { key: 'filename', label: t('momentum', 'Filename'), dataType: 'string', defaultVisible: true },
  {
    key: 'doc_type',
    label: t('momentum', 'Document type'),
    dataType: 'string',
    sortable: true,
    defaultVisible: true,
    // `sort=doc_type:...` is a real indexed built-in column with the same
    // keyset pagination as created_at (api.md § Sort parameter, M33.3), so
    // infinite scroll keeps working under this sort — unlike an extracted-field
    // sort, which is first-page-only.
    cursorPaginated: true,
  },
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
  {
    key: 'status',
    label: t('momentum', 'Status'),
    dataType: 'string',
    sortable: true,
    defaultVisible: true,
    cursorPaginated: true,
  },
  {
    key: 'reviewed',
    label: t('momentum', 'Reviewed'),
    dataType: 'boolean',
    sortable: true,
    defaultVisible: true,
    cursorPaginated: true,
  },
])

// The type list behind the filter's chosen-from values. Default scope
// (`classified`) on purpose: it returns the types this tenant actually has
// documents of, and filtering by a type with zero documents can only return
// zero rows (frontend.md § Documents). The Document Viewer's type control is
// the opposite case and uses `scope=all`.
const documentTypes = ref<DocumentTypeDTO[]>([])

onMounted(async () => {
  documentTypes.value = await fetchDocumentTypes()
})

// `type_name` is the API's own built-in filter field for document type
// (api.md § Filtering) — the same constraint the old per-type nav entry
// expressed, now composable with status/reviewed/direction. `is_null` /
// `is_not_null` are offered too: "not classified yet" is a question worth
// asking of this table, and it is the API's way of asking it.
const FILTERABLE_FIELDS = computed<FilterableField[]>(() => [
  {
    field_name: 'type_name',
    display_name: t('momentum', 'Document type'),
    data_type: 'string',
    operators: ['eq', 'not_eq', 'is_null', 'is_not_null'],
    values: [...documentTypes.value]
      .map((docType) => ({
        value: docType.type_name ?? '',
        label: docType.display_name || docType.type_name || '',
      }))
      .filter((option) => option.value !== '')
      .sort((a, b) => a.label.localeCompare(b.label)),
  },
])

function basename(path: string | undefined): string {
  if (!path) return ''
  const segments = path.split('/')
  return segments[segments.length - 1] || path
}

// The type column shows the type's DISPLAY name where one is known, falling
// back to the raw type_name — the wire value is what sorts and filters, but it
// is not what a user should have to read.
const displayNameByType = computed(
  () =>
    new Map(
      documentTypes.value
        .filter((docType) => docType.type_name)
        .map((docType) => [docType.type_name as string, docType.display_name || docType.type_name]),
    ),
)

// A NULL doc_type reads two different ways: "not classified yet"
// (doc_type_source unset or 'ai') versus the classifier's explicit "no
// registry type fits" outcome (doc_type_source === 'none', M151.3/M179.3,
// backlog/v1.md Phase 179) — DocumentViewerPage's isUndefinedType already
// makes this same distinction; this is its list-surface companion, closing
// the gap M151.9 left open here.
function typeCell(item: SearchItemDTO): string {
  if (item.doc_type) return displayNameByType.value.get(item.doc_type) ?? item.doc_type
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
    next_cursor: response.next_cursor ?? undefined,
    limit: response.limit,
  }
}

// Same reasoning as Recent Documents': the ingest destination is a server-side
// concern, so this defers to NC's own upload experience.
function handleAddNew(): void {
  window.open(generateUrl('/apps/files'), '_blank', 'noopener')
}
</script>

<template>
  <div class="momentum-page momentum-page--documents">
    <DocumentList
      :columns="COLUMNS"
      :fetch-page="fetchPage"
      :filterable-fields="FILTERABLE_FIELDS"
      :default-sort="DEFAULT_SORT"
      persist-key="documents"
      reserve-nav-toggle-corner
      class="momentum-documents__list"
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
          :name="t('momentum', 'No documents yet')"
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
/* Bounded height so VirtualTable's own body is the scroller and not NC's
   content pane — backlog Phase 93 (M93.1/M93.2), the same rule every list page
   here follows. */
.momentum-page--documents {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.momentum-documents__list {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
