<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import DocumentList from '../components/DocumentList.vue'
import { excludeStaticColumns } from '../components/columnExclusion'
import { FileOutlineIcon, FilterOffOutlineIcon } from '../components/icons'
import { URL_PARAM_FILTER, decodeFilterParams } from '../components/urlState'
import { fetchDocumentTypeSchema, fetchSearchDocuments, fetchStatsOverview } from '../services/documents'
import type { SearchItemDTO } from '../services/documents'
import type { ActiveFilter, ColumnDef, FilterableField, Page, SortState, TableRow } from '../types'

// By-Type Document List (frontend.md § By-Type Document List, M4.7). Mounts
// DocumentList (M4.4) with a column/filter set derived from the type's
// schema (GET /document-types/:type_name/schema) and rows from the
// type-scoped structured search (GET /search/documents?type_name=...&...) —
// G26 (backlog/v1.md): the query param is `type_name`, verbatim per api.md,
// not `type`.
const route = useRoute()
const typeName = computed(() => String(route.params.typeName ?? ''))

// M178.1 (backlog/v1.md Phase 178): see DocumentsListPage's identical note —
// a read-only look at the `f` URL param DocumentList writes on every filter
// change, used only to distinguish "nothing classified as this type yet"
// from "nothing matches the current filters" below.
const hasActiveFilters = computed(() => decodeFilterParams(route.query[URL_PARAM_FILTER]).length > 0)

const loading = ref(true)
const displayName = ref('')
const totalCount = ref(0)
const extractedFields = ref<{ field_name: string; display_name: string; data_type: string; operators: string[] }[]>([])

// frontend.md § By-Type Document List "default visible: doc id + first 3–4
// extracted fields by sort_order" — 4 is the upper bound of that range.
const DEFAULT_VISIBLE_EXTRACTED_FIELD_COUNT = 4

const columns = computed<ColumnDef[]>(() =>
  excludeStaticColumns([
    { key: 'filename', label: t('momentum', 'Filename'), dataType: 'string', defaultVisible: true },
    { key: 'created_at', label: t('momentum', 'Date added'), dataType: 'date', sortable: true, cursorPaginated: true },
    { key: 'updated_at', label: t('momentum', 'Updated'), dataType: 'date', sortable: true, cursorPaginated: true },
    { key: 'status', label: t('momentum', 'Processing status'), dataType: 'string', sortable: true },
    { key: 'reviewed', label: t('momentum', 'Reviewed'), dataType: 'boolean', sortable: true },
    ...extractedFields.value.map((field, index) => ({
      key: field.field_name,
      label: field.display_name,
      dataType: field.data_type as ColumnDef['dataType'],
      defaultVisible: index < DEFAULT_VISIBLE_EXTRACTED_FIELD_COUNT,
      sortable: true,
    })),
  ]),
)

const filterableFields = computed<FilterableField[]>(() =>
  extractedFields.value.map((field) => ({
    field_name: field.field_name,
    display_name: field.display_name,
    data_type: field.data_type as FilterableField['data_type'],
    operators: field.operators,
  })),
)

const defaultSort: SortState = { column: 'created_at', direction: 'desc' }

function filenameFromPath(path?: string): string {
  if (!path) return ''
  const parts = path.split('/')
  return parts[parts.length - 1] ?? ''
}

function toTableRow(item: SearchItemDTO): TableRow {
  return {
    id: item.public_id ?? '',
    cells: {
      filename: filenameFromPath(item.path),
      mime_type: item.mime_type ?? null,
      created_at: item.created_at ?? null,
      updated_at: item.updated_at ?? null,
      status: item.status ?? null,
      reviewed: item.reviewed ?? null,
      snippet: item.snippet ?? null,
      ...(item.fields ?? {}),
    },
  }
}

async function fetchPage(cursor: string | undefined, sort: SortState, filters: ActiveFilter[]): Promise<Page> {
  const response = await fetchSearchDocuments({
    typeName: typeName.value,
    sort,
    filters,
    cursor,
  })
  return {
    items: (response.items ?? []).map(toTableRow),
    // The API sends `next_cursor: null` on the wire to mean "no more pages" —
    // normalize to `undefined` here so Page's stated contract ("absent once
    // the last page is reached") holds true rather than merely being assumed.
    next_cursor: response.next_cursor ?? undefined,
    limit: response.limit,
  }
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const [schema, overview] = await Promise.all([
      fetchDocumentTypeSchema(typeName.value),
      fetchStatsOverview(),
    ])
    displayName.value = schema.display_name ?? typeName.value
    extractedFields.value = [...(schema.fields ?? [])]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((field) => ({
        field_name: field.field_name ?? '',
        display_name: field.display_name ?? field.field_name ?? '',
        data_type: field.data_type ?? 'string',
        operators: field.operators ?? [],
      }))
    const stats = overview.types?.find((s) => s.type_name === typeName.value)
    totalCount.value = stats?.total ?? 0
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(typeName, load)

// "Add new" (frontend.md § DocumentList toolbar item 5) opens the NC Files
// app's own drag-and-drop/upload UI in a new tab — see RecentDocumentsPage's
// identical handler for why this defers to NC's native upload flow rather
// than a type-scoped destination the frontend has no way to resolve.
function handleAddNew(): void {
  window.open(generateUrl('/apps/files'), '_blank', 'noopener')
}
</script>

<template>
  <div class="momentum-page momentum-page--by-type-document-list">
    <div v-if="loading" data-testid="loading" class="momentum-by-type__loading" aria-busy="true">
      <NcLoadingIcon :size="32" />
    </div>
    <template v-else>
      <header class="momentum-by-type__header">
        <h2 data-testid="display-name" class="momentum-by-type__title">{{ displayName }}</h2>
        <span data-testid="total-count" class="momentum-by-type__total">
          {{ t('momentum', '{count} documents', { count: totalCount }) }}
        </span>
      </header>
      <DocumentList
        :columns="columns"
        :fetch-page="fetchPage"
        :filterable-fields="filterableFields"
        :default-sort="defaultSort"
        :persist-key="typeName"
        @add-new="handleAddNew"
        class="momentum-by-type__list">
        <template #empty>
          <NcEmptyContent
            v-if="hasActiveFilters"
            :name="t('momentum', 'No {type} documents match your filters', { type: displayName })"
            :description="t('momentum', 'Remove a filter above to see more documents.')">
            <template #icon>
              <FilterOffOutlineIcon />
            </template>
          </NcEmptyContent>
          <NcEmptyContent
            v-else
            :name="t('momentum', 'No {type} documents yet', { type: displayName })">
            <template #icon>
              <FileOutlineIcon />
            </template>
          </NcEmptyContent>
        </template>
      </DocumentList>
    </template>
  </div>
</template>

<style scoped>
.momentum-page--by-type-document-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.momentum-by-type__header {
  display: flex;
  align-items: baseline;
  gap: calc(var(--default-grid-baseline, 4px) * 2);
  padding: calc(var(--default-grid-baseline, 4px) * 2);
  flex: 0 0 auto;
}

.momentum-by-type__total {
  color: var(--color-text-maxcontrast);
}

/* Reserve NcAppContent's collapse-navigation toggle footprint (a
   --default-clickable-area square in the content pane's top-left corner —
   backlog Phase 75/90 / M75.1/M90.1) on the heading it overlaps, not on the
   page container, so DocumentList's table below stays left-aligned. Must be
   `margin`, not `padding`: padding only moves the heading's visible text
   inward, it does not move the heading element's own bounding box, so the
   M75.2 smoke check (which measures getBoundingClientRect intersection, not
   visible content) still sees an overlap — margin-inline-start actually
   displaces the box. */
.momentum-by-type__title {
  margin-inline-start: var(--default-clickable-area, 44px);
}

.momentum-by-type__list {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
