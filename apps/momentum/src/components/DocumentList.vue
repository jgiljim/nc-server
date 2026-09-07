<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router'
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import TypeaheadSearch from './TypeaheadSearch.vue'
import FilterPill from './FilterPill.vue'
import FilterPicker from './FilterPicker.vue'
import ColumnPicker from './ColumnPicker.vue'
import VirtualTable from './VirtualTable.vue'
import { PlusIcon } from './icons'
import { loadColumnVisibility, saveColumnVisibility } from './columnVisibility'
import {
  URL_PARAM_COLS,
  URL_PARAM_CURSOR,
  URL_PARAM_FILTER,
  URL_PARAM_SORT,
  decodeColsParam,
  decodeCursorParam,
  decodeFilterParams,
  decodeSortParam,
  encodeColsParam,
  encodeFilterParams,
  encodeSortParam,
} from './urlState'
import {
  FIELD_NAME_DIRECTION,
  FIELD_NAME_REVIEWED,
  FIELD_NAME_STATUS,
  type ActiveFilter,
  type ColumnDef,
  type FilterableField,
  type FilterValue,
  type Page,
  type SortState,
} from '../types'

// DocumentList (frontend.md § DocumentList): the primary composite component.
// Bundles the fixed toolbar, filter state, sort state, and column-visibility
// state around VirtualTable into a single reusable unit — both the By-Type
// List (M4.7) and Recent Documents (M4.8) pages mount this with different
// `columns`/`fetchPage`/`filterableFields` configuration; neither duplicates
// toolbar or table behaviour (M4.4).
const props = defineProps<{
  columns: ColumnDef[]
  fetchPage: (
    cursor: string | undefined,
    sort: SortState,
    filters: ActiveFilter[],
  ) => Promise<Page>
  filterableFields: FilterableField[]
  defaultSort: SortState
  persistKey?: string
  // Set by a host page that mounts DocumentList with no heading row above
  // it (RecentDocumentsPage — backlog Phase 75/90 / M75.1/M90.1): reserves
  // NcAppContent's collapse-navigation toggle footprint on the toolbar
  // itself, since it's the element sharing the toggle's band there. Pages
  // that render their own heading above DocumentList (ByTypeDocumentListPage)
  // reserve it on that heading instead and leave this false.
  reserveNavToggleCorner?: boolean
}>()

const emit = defineEmits<{
  (e: 'addNew'): void
}>()

const router = useRouter()
const route = useRoute()

// URL state (frontend.md § URL State Management, M4.5): sort/filters/cols
// and the pagination cursor round-trip through the URL so a shared link,
// browser back/forward, or an AI-Filing deep link restores the exact same
// view. `cols` is frontend-only — it never reaches `fetchPage`/the API
// (urlState.ts's SEARCH_FILTER_FIELD_NAME note covers the parallel case for
// search terms within `f`).
function updateUrlState(patch: Partial<Record<string, string | string[] | undefined>>, mode: 'push' | 'replace'): void {
  const nextQuery: LocationQueryRaw = { ...route.query }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete nextQuery[key]
    else nextQuery[key] = value
  }
  if (mode === 'push') void router.push({ query: nextQuery })
  else void router.replace({ query: nextQuery })
}

// The three built-in filterable fields are always prepended ahead of whatever
// type-specific extracted-field filters the caller supplies (frontend.md §
// DocumentList: "The three built-in filterable columns ... are always
// prepended; extracted-field columns are appended when provided").
// Full operator set the API has supported on these fields since M23.7
// (api.md § Filtering: "Built-in filterable fields").
const BUILT_IN_OPERATORS = ['eq', 'not_eq', 'in', 'not_in']
const BUILT_IN_FILTERABLE_FIELDS: FilterableField[] = [
  {
    field_name: FIELD_NAME_STATUS,
    display_name: t('momentum', 'Status'),
    data_type: 'string',
    operators: BUILT_IN_OPERATORS,
  },
  {
    field_name: FIELD_NAME_REVIEWED,
    display_name: t('momentum', 'Reviewed'),
    data_type: 'boolean',
    operators: BUILT_IN_OPERATORS,
  },
  {
    field_name: FIELD_NAME_DIRECTION,
    display_name: t('momentum', 'Direction'),
    data_type: 'string',
    operators: BUILT_IN_OPERATORS,
  },
]
const allFilterableFields = computed<FilterableField[]>(() => [
  ...BUILT_IN_FILTERABLE_FIELDS,
  ...props.filterableFields,
])

// Column visibility. `columns` marked `defaultVisible` form the per-instance
// default set the caller defines (frontend.md § DocumentList: "DocumentList
// defines a default visible set per instance"); if a caller marks none, fall
// back to showing everything rather than an empty table. `persistKey`, when
// set, resolves the initial set from localStorage and persists changes —
// ColumnPicker itself stays a pure controlled component (columnVisibility.ts).
const knownColumnKeys = computed(() => props.columns.map((c) => c.key))
const defaultVisibleKeys = computed(() => {
  const marked = props.columns.filter((c) => c.defaultVisible).map((c) => c.key)
  return marked.length > 0 ? marked : knownColumnKeys.value
})
// The URL's `cols` param is read on mount as the primary source of truth for
// restored state (frontend.md § URL State Management: "This is the sole
// source of truth for restored state — localStorage is used only as a
// fallback default for column visibility when cols is absent from the URL");
// only when it's absent do we fall back to the persisted/default set.
const urlCols = decodeColsParam(route.query[URL_PARAM_COLS])
const visibleColumnKeys = ref<string[]>(
  urlCols ??
    (props.persistKey
      ? loadColumnVisibility(props.persistKey, defaultVisibleKeys.value, knownColumnKeys.value)
      : defaultVisibleKeys.value),
)
const displayedColumns = computed(() =>
  props.columns.filter((c) => visibleColumnKeys.value.includes(c.key)),
)

function onColumnsChange(selected: string[]): void {
  visibleColumnKeys.value = selected
  if (props.persistKey) saveColumnVisibility(props.persistKey, selected)
  // Toggling column visibility pushes a new history entry (frontend.md §
  // History strategy) — it's frontend-only state, but still part of the
  // shareable/back-navigable URL.
  updateUrlState({ [URL_PARAM_COLS]: encodeColsParam(selected) }, 'push')
}

// Sort state. Clicking a sortable header sets it active (ascending, the first
// time) or toggles its direction if it's already active (frontend.md §
// DocumentList "Table"). Changing sort resets to page 1 — handled below by
// keying VirtualTable off the combined sort+filter state so it remounts and
// refetches from scratch rather than trying to reset its internal state.
const activeSort = ref<SortState>(decodeSortParam(route.query[URL_PARAM_SORT]) ?? { ...props.defaultSort })

function onSortChange(key: string): void {
  // A committed search term routes the request through `q=` full-text
  // search (services/documents.ts's buildSearchQuery, M34.8), which the API
  // rejects combined with an explicit sort — full-text results rank by
  // relevance, not by column (backend/internal/documents/search.go's
  // ValidateFullTextQuery). Rather than let a header click render an active
  // sort arrow that buildSearchQuery then silently drops from the request,
  // ignore the click outright while a search term is active.
  if (hasActiveSearch.value) return
  activeSort.value =
    activeSort.value.column === key
      ? { column: key, direction: activeSort.value.direction === 'asc' ? 'desc' : 'asc' }
      : { column: key, direction: 'asc' }
  // Changing sort resets to page 1 (frontend.md § DocumentList "Table"),
  // so the restored cursor no longer applies — drop it from both the URL
  // and the value VirtualTable will be remounted with (tableInitialCursor).
  tableInitialCursor.value = undefined
  updateUrlState(
    { [URL_PARAM_SORT]: encodeSortParam(activeSort.value), [URL_PARAM_CURSOR]: undefined },
    'push',
  )
}

// Filter state. Both FilterPicker-composed field constraints and
// TypeaheadSearch-committed search terms live in the same active-filter list —
// each renders as a FilterPill and both feed `fetchPage` (frontend.md §
// DocumentList toolbar items 1–3; § FilterPill render formats).
const activeFilters = ref<ActiveFilter[]>(decodeFilterParams(route.query[URL_PARAM_FILTER]))
const hasActiveSearch = computed(() => activeFilters.value.some((filter) => filter.kind === 'search'))

// Adding, removing, or changing filters resets to page 1 just like sort does
// (frontend.md § History strategy: "Add / remove a filter" → pushState) —
// the previously-restored cursor no longer applies to the new filter set.
function syncFiltersToUrl(): void {
  tableInitialCursor.value = undefined
  const encoded = encodeFilterParams(activeFilters.value)
  updateUrlState(
    { [URL_PARAM_FILTER]: encoded.length > 0 ? encoded : undefined, [URL_PARAM_CURSOR]: undefined },
    'push',
  )
}

function onSearchCommit(term: string): void {
  activeFilters.value = [...activeFilters.value, { kind: 'search', term }]
  syncFiltersToUrl()
}

function onFilterAdd(filter: FilterValue): void {
  activeFilters.value = [...activeFilters.value, { kind: 'field', ...filter }]
  syncFiltersToUrl()
}

function removeFilter(index: number): void {
  activeFilters.value = activeFilters.value.filter((_, i) => i !== index)
  syncFiltersToUrl()
}

function filterLabel(filter: ActiveFilter): string {
  if (filter.kind === 'search') return t('momentum', 'search: {term}', { term: filter.term })
  const field = allFilterableFields.value.find((f) => f.field_name === filter.field_name)
  const displayName = field?.display_name ?? filter.field_name
  return `${displayName} ${filter.operator} ${filter.value}`
}

// Remounting VirtualTable on sort/filter change is what gives us "resets to
// page 1": a fresh instance always fetches its first page (cursor=undefined)
// on mount, which is exactly the reset behaviour without VirtualTable needing
// to expose an imperative reset API of its own.
const tableKey = computed(() => JSON.stringify({ sort: activeSort.value, filters: activeFilters.value }))

// The cursor VirtualTable is (re)mounted with: the URL's `cursor` param on
// first load, reset to undefined whenever sort/filters change (a fresh
// remount always starts at page 1 — see onSortChange/syncFiltersToUrl).
const tableInitialCursor = ref<string | undefined>(decodeCursorParam(route.query[URL_PARAM_CURSOR]))

function fetchTablePage(cursor?: string): Promise<Page> {
  // Pagination is not a navigation step (frontend.md § History strategy:
  // "Scroll loads next page" → replaceState) — reflect the page being
  // requested in the URL without creating a back-button stop for it. Only
  // an actual page-advancing cursor is written: the first-page call (either
  // the true initial load or a fresh remount after a sort/filter change)
  // never needs to touch the URL — it's either already correct (restored
  // from `cursor` on mount) or was just cleared by onSortChange/
  // syncFiltersToUrl's own navigation, and writing it here too would race
  // that in-flight navigation and could drop it (both resolve against
  // `route.query` snapshots taken at call time).
  if (cursor !== undefined) updateUrlState({ [URL_PARAM_CURSOR]: cursor }, 'replace')
  return props.fetchPage(cursor, activeSort.value, activeFilters.value)
}

function onRowClick(docId: string): void {
  void router.push({ name: 'document-viewer', params: { docId } })
}
</script>

<template>
  <div class="momentum-document-list">
    <div
      class="momentum-document-list__toolbar"
      :class="{ 'momentum-document-list__toolbar--reserve-nav-toggle': props.reserveNavToggleCorner }">
      <TypeaheadSearch
        :placeholder="t('momentum', 'Search')"
        :disabled="false"
        @search-commit="onSearchCommit" />

      <FilterPill
        v-for="(filter, index) in activeFilters"
        :key="index"
        :label="filterLabel(filter)"
        @remove="removeFilter(index)" />

      <FilterPicker :fields="allFilterableFields" @filter-add="onFilterAdd" />

      <ColumnPicker :columns="columns" :selected="visibleColumnKeys" @change="onColumnsChange" />

      <!-- Hidden for now (product decision pending on what it should do,
           2026-07-31) — wiring/logic kept intact (addNew still emits,
           RecentDocumentsPage/ByTypeDocumentListPage still listen), only the
           button itself is visually hidden. Remove
           momentum-document-list__add-new--hidden once that's decided. -->
      <NcButton class="momentum-document-list__add-new momentum-document-list__add-new--hidden" @click="emit('addNew')">
        <template #icon>
          <PlusIcon :size="20" />
        </template>
        {{ t('momentum', 'Add new') }}
      </NcButton>
    </div>

    <VirtualTable
      :key="tableKey"
      :columns="displayedColumns"
      :all-columns="columns"
      :fetch-page="fetchTablePage"
      :active-sort="activeSort"
      :initial-cursor="tableInitialCursor"
      class="momentum-document-list__table"
      @sort-change="onSortChange"
      @row-click="onRowClick">
      <template #empty>
        <slot name="empty" />
      </template>
    </VirtualTable>
  </div>
</template>

<style scoped>
.momentum-document-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.momentum-document-list__toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: calc(var(--default-grid-baseline, 4px) * 2);
  padding: calc(var(--default-grid-baseline, 4px) * 2);
  flex: 0 0 auto;
}

/* Reserve NcAppContent's collapse-navigation toggle footprint (a
   --default-clickable-area square in the content pane's top-left corner —
   backlog Phase 75/90 / M75.1/M90.1) on this toolbar, for host pages with no
   heading row above it (RecentDocumentsPage). Declared here, on the
   toolbar's own scoped rule, rather than as a `:deep()` override from the
   host page: a cross-component `:deep()` override ties in CSS specificity
   with this component's own `.momentum-document-list__toolbar` rule above,
   so which one wins depends on unstable module-bundling/style-injection
   order — it silently lost that tie on the real page, leaving the toggle
   overlapping the search field with no visual or functional change. Must be
   `margin`, not `padding`: padding only moves the toolbar's visible content
   inward, it does not move the toolbar element's own bounding box, so the
   M75.2 smoke check (which measures getBoundingClientRect intersection, not
   visible content) still sees an overlap. */
.momentum-document-list__toolbar--reserve-nav-toggle {
  margin-inline-start: var(--default-clickable-area, 44px);
}

.momentum-document-list__add-new--hidden {
  display: none;
}

.momentum-document-list__table {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
