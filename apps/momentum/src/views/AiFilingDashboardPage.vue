<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { t } from '@nextcloud/l10n'
import NcCounterBubble from '@nextcloud/vue/components/NcCounterBubble'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import { fetchDocumentTypes, fetchStatsOverview } from '../services/documents'
import type {
  DocumentTypeDTO,
  MostRecentDocumentDTO,
  MostRecentlyUpdatedDocumentDTO,
  TypeStatsDTO,
} from '../services/documents'

// frontend.md § AI Filing (M4.6) — a summary row per document type with
// total/unreviewed counts, backed by GET /stats/overview. That endpoint's
// per-type breakdown only lists types with at least one document
// (backend/internal/documents/stats.go groups by doc_type on existing rows),
// so it's merged here with the full GET /document-types registry to still
// render a zero-count row for a type with no documents yet (§ AI Filing
// "Empty state").
type Row = { typeName: string; displayName: string; total: number; unreviewed: number }

const router = useRouter()
const loading = ref(true)
const documentTypes = ref<DocumentTypeDTO[]>([])
const typeStats = ref<TypeStatsDTO[]>([])
const hasAnyDocuments = ref(false)
// M36.9 — most_recent_document (M32.4) resolves per type from that type's own
// date field (invoice_date, contract_date, …), never documents.created_at, so
// it's rendered separately from and labelled distinctly against ingest/update
// timestamps (api.md § GET /stats/overview).
const mostRecentDocument = ref<MostRecentDocumentDTO | undefined>(undefined)
// M36.8 — most_recently_updated (the last document written by the pipeline,
// by documents.updated_at) is distinct from most_recent_document above (which
// resolves per type from that type's own date field), so it's rendered as its
// own row rather than folded into the same block (api.md § GET /stats/overview).
const mostRecentlyUpdated = ref<MostRecentlyUpdatedDocumentDTO | undefined>(undefined)

const rows = computed<Row[]>(() => {
  const statsByType = new Map(typeStats.value.map((s) => [s.type_name, s]))
  return documentTypes.value
    .map((docType) => {
      const stats = docType.type_name ? statsByType.get(docType.type_name) : undefined
      return {
        typeName: docType.type_name ?? '',
        displayName: docType.display_name ?? docType.type_name ?? '',
        total: stats?.total ?? 0,
        unreviewed: stats?.unreviewed ?? 0,
      }
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
})

async function load(): Promise<void> {
  loading.value = true
  try {
    const [types, overview] = await Promise.all([fetchDocumentTypes(), fetchStatsOverview()])
    documentTypes.value = types
    typeStats.value = overview.types ?? []
    hasAnyDocuments.value = (overview.total ?? 0) > 0
    mostRecentDocument.value = overview.most_recent_document
    mostRecentlyUpdated.value = overview.most_recently_updated
  } finally {
    loading.value = false
  }
}

onMounted(load)

function goToType(typeName: string): void {
  if (!typeName) return
  void router.push({ name: 'by-type-document-list', params: { typeName } })
}

function goToUnreviewed(typeName: string): void {
  if (!typeName) return
  void router.push({
    name: 'by-type-document-list',
    params: { typeName },
    query: { f: 'reviewed:eq:false' },
  })
}

function goToDocument(docId: string | undefined): void {
  if (docId === undefined) return
  void router.push({ name: 'document-viewer', params: { docId } })
}
</script>

<template>
  <div class="momentum-page momentum-page--ai-filing">
    <h2 class="momentum-ai-filing__heading">{{ t('momentum', 'AI Filing') }}</h2>

    <div v-if="loading" data-testid="loading" class="momentum-ai-filing__loading" aria-busy="true">
      <NcLoadingIcon :size="32" />
    </div>
    <NcEmptyContent
      v-else-if="!hasAnyDocuments"
      data-testid="empty-state"
      :name="t('momentum', 'No documents yet')"
      :description="t('momentum', 'Upload files in Nextcloud to see them classified here.')"
    />
    <div v-else class="momentum-ai-filing__content">
      <div
        v-if="mostRecentDocument"
        data-testid="most-recent-document"
        class="momentum-ai-filing__most-recent"
      >
        <span class="momentum-ai-filing__most-recent-label">
          {{ t('momentum', "Most recent document (by the document's own date)") }}
        </span>
        <a
          href="#"
          class="momentum-ai-filing__most-recent-link"
          @click.prevent="goToDocument(mostRecentDocument.public_id)"
        >
          {{ mostRecentDocument.path }}
        </a>
        <span class="momentum-ai-filing__most-recent-date">{{ mostRecentDocument.date }}</span>
      </div>

      <div
        v-if="mostRecentlyUpdated"
        data-testid="most-recently-updated"
        class="momentum-ai-filing__most-recent"
      >
        <span class="momentum-ai-filing__most-recent-label">
          {{ t('momentum', 'Most recently updated') }}
        </span>
        <a
          href="#"
          class="momentum-ai-filing__most-recent-link"
          @click.prevent="goToDocument(mostRecentlyUpdated.public_id)"
        >
          {{ mostRecentlyUpdated.path }}
        </a>
        <span class="momentum-ai-filing__most-recent-date">{{ mostRecentlyUpdated.updated_at }}</span>
      </div>

      <div class="momentum-ai-filing__table-wrapper">
        <table class="momentum-ai-filing__table">
          <thead>
            <tr>
              <th>{{ t('momentum', 'Type') }}</th>
              <th class="momentum-ai-filing__numeric-header">{{ t('momentum', 'Total documents') }}</th>
              <th class="momentum-ai-filing__numeric-header">{{ t('momentum', 'Unreviewed') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.typeName"
              data-testid="type-row"
              class="momentum-ai-filing__row"
              tabindex="0"
              @click="goToType(row.typeName)"
              @keydown.enter="goToType(row.typeName)"
            >
              <td class="momentum-ai-filing__type-cell">{{ row.displayName }}</td>
              <td data-testid="total-cell" class="momentum-ai-filing__numeric-cell">
                <NcCounterBubble type="outlined" :count="row.total" raw />
              </td>
              <td
                data-testid="unreviewed-cell"
                class="momentum-ai-filing__numeric-cell momentum-ai-filing__unreviewed"
                :class="{ 'momentum-ai-filing__unreviewed--flagged': row.unreviewed > 0 }"
                @click.stop="goToUnreviewed(row.typeName)"
              >
                <NcCounterBubble :type="row.unreviewed > 0 ? 'highlighted' : 'outlined'" :count="row.unreviewed" raw />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.momentum-page--ai-filing {
  padding: calc(var(--default-grid-baseline, 4px) * 6);
  max-width: 960px;
}

.momentum-ai-filing__heading {
  margin: 0 0 calc(var(--default-grid-baseline, 4px) * 5) 0;
  font-size: 1.5rem;
  font-weight: bold;
  /* Reserve NcAppContent's collapse-navigation toggle footprint (a
     --default-clickable-area square in the content pane's top-left corner —
     backlog Phase 75/90 / M75.1/M90.1) on the heading it overlaps, not on
     the page container, which would also shift the table/cards below it.
     Must be `margin`, not `padding`: padding only moves the heading's
     visible text inward, it does not move the heading element's own
     bounding box, so the M75.2 smoke check (which measures
     getBoundingClientRect intersection, not visible content) still sees an
     overlap — margin-inline-start actually displaces the box. */
  margin-inline-start: var(--default-clickable-area, 44px);
}

.momentum-ai-filing__loading {
  display: flex;
  justify-content: center;
  padding: calc(var(--default-grid-baseline, 4px) * 10) 0;
}

.momentum-ai-filing__most-recent {
  display: flex;
  align-items: baseline;
  gap: calc(var(--default-grid-baseline, 4px) * 2);
  margin-bottom: calc(var(--default-grid-baseline, 4px) * 4);
  padding: calc(var(--default-grid-baseline, 4px) * 3) calc(var(--default-grid-baseline, 4px) * 4);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-large, 8px);
  background-color: var(--color-main-background);
}

.momentum-ai-filing__most-recent-label {
  color: var(--color-text-maxcontrast);
}

.momentum-ai-filing__most-recent-link {
  font-weight: 500;
}

.momentum-ai-filing__most-recent-date {
  color: var(--color-text-maxcontrast);
}

.momentum-ai-filing__table-wrapper {
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-large, 8px);
  overflow: hidden;
  background-color: var(--color-main-background);
}

.momentum-ai-filing__table {
  width: 100%;
  border-collapse: collapse;
}

.momentum-ai-filing__table thead th {
  text-align: left;
  padding: calc(var(--default-grid-baseline, 4px) * 3) calc(var(--default-grid-baseline, 4px) * 4);
  font-weight: bold;
  color: var(--color-text-maxcontrast);
  background-color: var(--color-background-hover);
  border-bottom: 1px solid var(--color-border);
}

.momentum-ai-filing__numeric-header {
  text-align: right !important;
}

.momentum-ai-filing__table tbody td {
  padding: calc(var(--default-grid-baseline, 4px) * 3) calc(var(--default-grid-baseline, 4px) * 4);
  border-bottom: 1px solid var(--color-border);
}

.momentum-ai-filing__table tbody tr:last-child td {
  border-bottom: none;
}

.momentum-ai-filing__type-cell {
  font-weight: 500;
}

.momentum-ai-filing__numeric-cell {
  text-align: right;
}

.momentum-ai-filing__row {
  cursor: pointer;
  transition: background-color 0.1s ease-in-out;
}

@media (prefers-reduced-motion: reduce) {
  .momentum-ai-filing__row {
    transition: none;
  }
}

.momentum-ai-filing__row:hover,
.momentum-ai-filing__row:focus-visible {
  background-color: var(--color-background-hover);
}

.momentum-ai-filing__unreviewed {
  cursor: pointer;
}

.momentum-ai-filing__unreviewed--flagged :deep(.counter-bubble__counter) {
  font-weight: bold;
}
</style>
