<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { n, t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcDateTimePicker from '@nextcloud/vue/components/NcDateTimePicker'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import {
  AlertCircleOutlineIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  CloseCircleOutlineIcon,
  HelpCircleOutlineIcon,
} from './icons'
import {
  fetchDocument,
  fetchDocumentTypeSchema,
  patchDocument,
  patchDocumentFields,
  reprocessDocument,
} from '../services/documents'
import type { DocumentTypeSchema } from '../services/documents'

// frontend.md § FieldEditor — renders the field list for a document, manages
// dirty state, and issues save/review API calls. Fetches its schema and
// current field values independently (in parallel); shows a loading skeleton
// until both resolve.
// `refreshToken` is bumped by DocumentViewerPage whenever a matching
// `momentum_status` notify_push event arrives (frontend.md § Processing
// status) — it carries no field data itself, so FieldEditor re-fetches its
// own document/schema on change to pick up the terminal fields/reviewed
// state without waiting for a manual reload.
// `processingStalled` is M129.2: DocumentViewerPage owns the poll, so it owns
// the wait budget and tells this component when the budget has run out
// (frontend.md § Special status states). This component owns what the user is
// then told, and emits `recheck` to ask for the wait to resume.
const props = withDefaults(
  defineProps<{
    docId: string
    docType: string
    // M151.9 (api.md § doc_type_source and the "Undefined" classification
    // outcome) — DocumentViewerPage's own copy of the same field, handed down
    // so this component can tell a not-yet-classified document (blank
    // docType, still `isReprocessing`) apart from an Undefined one (blank
    // docType, `status: "done"`).
    docTypeSource?: string
    refreshToken?: number
    processingStalled?: boolean
  }>(),
  { docTypeSource: '', refreshToken: 0, processingStalled: false },
)

// M68.4 — the header's type dropdown must be disabled while the panel is
// dirty (frontend.md § Type control "Unsaved edits block the type change"),
// and DocumentViewerPage owns that dropdown, not this component. `isDirty`
// below is this component's own source of truth, so it's the one re-emitted
// rather than duplicating the computation in the parent.
const emit = defineEmits<{ 'update:dirty': [boolean]; 'update:reviewed': [boolean]; recheck: [] }>()

type FieldDefinition = NonNullable<DocumentTypeSchema['fields']>[number]

// backend/internal/docseed's applyUniversalFields appends this field to
// every document type (specs/mockup-ai-document-manager.html's `.doc-sum`
// AI-summary callout). It is presented as read-only prose above the field
// list, not as one more editable row — excluded from both sortedFields and
// fieldsCountLabel below.
const SUMMARY_FIELD_NAME = 'document_general_summary'

// specs/document-types/line-items.md: every type that has line items
// declares its container field under this exact name (data_type: string,
// holding a JSON array) — "Line items are always a single JSON string
// field... they count as one field regardless of how many sub-columns they
// contain". Rendered as a table instead of a text input when its value
// actually parses as one.
const LINE_ITEMS_FIELD_NAME = 'line_items'

type LineItemRow = Record<string, unknown>

// Parses a line_items field's raw string value into rows for the table
// below, or null when the value isn't the shape line-items.md declares (not
// yet extracted, or genuinely malformed) — the caller falls back to a plain
// text field in that case rather than showing a broken table.
function parseLineItems(value: unknown): LineItemRow[] | null {
  if (typeof value !== 'string' || !value) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null
  if (!parsed.every((row) => typeof row === 'object' && row !== null && !Array.isArray(row))) return null
  return parsed as LineItemRow[]
}

// Column order: every key across all rows, in first-seen order — a line
// item schema-shaped by an LLM extraction can vary row to row (a field the
// model found nothing for is just omitted from that row's JSON object, per
// extract.go's Extractor contract), so the header set has to be the union,
// not just the first row's keys.
function lineItemColumns(rows: LineItemRow[]): string[] {
  const columns: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key)
    }
  }
  return columns
}

// Mirrors backend/internal/docseed's titleCase (display_name = title-cased
// field_name) so a line item column header reads the same way the field's
// own display_name would if it were declared as a top-level field.
function titleCaseKey(key: string): string {
  return key
    .split('_')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ')
}

function lineItemCell(row: LineItemRow, column: string): string {
  const value = row[column]
  if (value === null || value === undefined) return ''
  return String(value)
}

const loading = ref(true)
// A transient failure (a real one seen live: the API's thin-A re-verify call
// to Nextcloud timing out under load) must not fall through to the normal
// "done" branch with whatever stale/empty fields.value happened to be
// sitting there — load() previously had no catch at all, so a rejected
// Promise.all just left loading.value reset to false by the `finally` with
// nothing populated: a silent "0 fields" instead of an error.
const loadFailed = ref(false)
const saving = ref(false)
const reprocessing = ref(false)
const fields = ref<FieldDefinition[]>([])
// specs/mockup-ai-document-manager.html's Document Viewer panel — a
// "<type display name>" / "N fields" summary row sits just above the field
// list. display_name comes from the same schema fetch fields.value is
// already sourced from (load(), below) — this just keeps the piece that
// fetch previously discarded.
const typeDisplayName = ref('')
const originalValues = ref<Record<string, unknown>>({})
const currentValues = ref<Record<string, unknown>>({})
// M151.9 (api.md § field_quality — per-field extraction consistency tags) —
// "verified"/"warning"/"wrong" per field name; a field with no consistency
// signal yet is simply absent, same as the API response it mirrors.
const fieldQuality = ref<Record<string, string>>({})
const reviewed = ref(false)
const status = ref('')

// frontend.md § Special status states — needs_ocr shows an explanatory
// message with no fields/controls; failed shows an error state with a
// Reprocess action. A pending/processing document (either its normal first
// pass, or the M68.4 full-pipeline re-run a doc_type correction triggers)
// shows a loading state in place of the field body, rather than the
// about-to-be-overwritten values from before the re-run started — done is
// the only status that renders the normal editable field body/footer.
const isNeedsOcr = computed(() => status.value === 'needs_ocr')
const isFailed = computed(() => status.value === 'failed')
const isReprocessing = computed(() => status.value === 'pending' || status.value === 'processing')

// M129.2 — the same non-terminal status, but the wait for it has run out. A
// re-run whose job dead-letters leaves the document `pending` for ever, and an
// indefinite spinner cannot say that: it reads as "still working on it" at
// minute one and at minute forty alike. Deliberately NOT presented as a
// failure — the client can see that the wait exceeded its budget, never the
// job's actual outcome — so it says only what is known and offers a recheck
// instead of inventing a verdict.
const isProcessingStalled = computed(() => isReprocessing.value && props.processingStalled)

// M151.9 (api.md § doc_type_source and the "Undefined" classification
// outcome) — reaches `status: "done"` same as any classified document
// (classification finding no match isn't a failure), so it's told apart from
// the pending case purely by docTypeSource, mirroring DocumentViewerPage's
// own computed of the same name. Extraction is skipped for an Undefined
// document (api.md), so there is no field body to render for it.
const isUndefinedType = computed(
  () => !props.docType && props.docTypeSource === 'none' && status.value === 'done',
)

const QUALITY_ICONS: Record<string, unknown> = {
  verified: CheckCircleIcon,
  warning: AlertCircleOutlineIcon,
  wrong: CloseCircleOutlineIcon,
}

const QUALITY_LABELS: Record<string, string> = {
  verified: t('momentum', 'Verified'),
  warning: t('momentum', 'Check field'),
  wrong: t('momentum', 'Wrong'),
}

function qualityFor(fieldName: string | undefined): string | undefined {
  if (!fieldName) return undefined
  return fieldQuality.value[fieldName]
}

function qualityIcon(quality: string) {
  return QUALITY_ICONS[quality]
}

function qualityLabel(quality: string): string {
  return QUALITY_LABELS[quality] ?? quality
}

const sortedFields = computed(() =>
  fields.value
    .filter((field) => field.field_name !== SUMMARY_FIELD_NAME)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
)

const fieldsCountLabel = computed(() =>
  n('momentum', '%n field', '%n fields', sortedFields.value.length),
)

const summaryText = computed(() => {
  const value = currentValues.value[SUMMARY_FIELD_NAME]
  return typeof value === 'string' ? value : ''
})

function isFieldDirty(fieldName: string | undefined): boolean {
  if (!fieldName) return false
  return currentValues.value[fieldName] !== originalValues.value[fieldName]
}

const dirtyFieldNames = computed(() =>
  sortedFields.value
    .map((field) => field.field_name)
    .filter((name): name is string => Boolean(name))
    .filter((name) => isFieldDirty(name)),
)

const isDirty = computed(() => dirtyFieldNames.value.length > 0)

watch(isDirty, (value) => emit('update:dirty', value), { immediate: true })
// M139.1 — the top bar's "Reviewed" pill (DocumentViewerPage) mirrors this
// component's own reviewed state rather than a second independent read, the
// same reasoning update:dirty above already uses: this is the one place
// reviewed changes (load(), toggleReviewed(), saveChanges()), so it is the
// one place that re-emits.
watch(reviewed, (value) => emit('update:reviewed', value), { immediate: true })

// A needs_ocr/failed/undefined-type document never reaches the classify
// pipeline step (architecture.md § ⑦ step 4), so docType is legitimately ''
// for as long as its status stays that way — there is no schema to fetch,
// but the status itself (which drives isNeedsOcr/isFailed below) still has
// to come from the document fetch, so that fetch cannot be gated on docType.
async function loadSchema(): Promise<void> {
  if (!props.docType) {
    fields.value = []
    typeDisplayName.value = ''
    return
  }
  const schema = await fetchDocumentTypeSchema(props.docType)
  fields.value = schema.fields ?? []
  typeDisplayName.value = schema.display_name ?? ''
}

async function load(): Promise<void> {
  if (!props.docId) return
  loading.value = true
  loadFailed.value = false
  try {
    const document = await fetchDocument(props.docId)
    originalValues.value = { ...(document.fields ?? {}) }
    currentValues.value = { ...(document.fields ?? {}) }
    fieldQuality.value = { ...(document.field_quality ?? {}) }
    reviewed.value = document.reviewed ?? false
    status.value = document.status ?? ''
    await loadSchema()
  } catch {
    loadFailed.value = true
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => [props.docId, props.refreshToken], load)
// docType can change on its own (e.g. DocumentViewerPage learning it after
// its own initial fetch resolves, independently of a refreshToken bump) —
// that only needs a schema re-fetch, not a redundant document re-fetch.
watch(
  () => props.docType,
  () => {
    if (!props.docId) return
    loadSchema().catch(() => {
      loadFailed.value = true
    })
  },
)

function setFieldValue(fieldName: string, value: unknown): void {
  currentValues.value = { ...currentValues.value, [fieldName]: value }
}

function dateToIsoDate(value: Date | [Date, Date] | null): string | null {
  if (!value || Array.isArray(value)) return null
  return value.toISOString().slice(0, 10)
}

function isoDateToDate(value: unknown): Date | null {
  return typeof value === 'string' && value ? new Date(value) : null
}

async function saveChanges(): Promise<void> {
  if (!isDirty.value || saving.value) return
  saving.value = true
  try {
    const patch: Record<string, unknown> = {}
    for (const name of dirtyFieldNames.value) patch[name] = currentValues.value[name]
    const response = await patchDocumentFields(props.docId, patch)
    originalValues.value = { ...(response.fields ?? currentValues.value) }
    currentValues.value = { ...originalValues.value }
    fieldQuality.value = { ...(response.field_quality ?? fieldQuality.value) }
    reviewed.value = response.reviewed ?? true
  } finally {
    saving.value = false
  }
}

// M68.4 — the one way out of the dirty-state block on the type dropdown that
// isn't Save Changes (frontend.md § Type control "This requires a Discard
// changes control"). Reverts every field to the last value fetched from the
// server and clears dirty state; issues no request.
function discardChanges(): void {
  currentValues.value = { ...originalValues.value }
}

async function toggleReviewed(): Promise<void> {
  const next = !reviewed.value
  await patchDocument(props.docId, { reviewed: next })
  reviewed.value = next
}

async function reprocess(): Promise<void> {
  if (reprocessing.value) return
  reprocessing.value = true
  try {
    await reprocessDocument(props.docId)
    await load()
  } finally {
    reprocessing.value = false
  }
}
</script>

<template>
  <div class="momentum-document-viewer__fields">
    <div v-if="loading" class="momentum-field-editor__skeleton" aria-busy="true">
      <NcLoadingIcon :size="32" />
    </div>
    <NcEmptyContent
      v-else-if="loadFailed"
      data-testid="load-error"
      :name="t('momentum', 'Could not load this document')"
      :description="t('momentum', 'Something went wrong fetching its fields. Please try again.')"
    >
      <template #action>
        <NcButton data-testid="load-error-retry" @click="load">
          {{ t('momentum', 'Retry') }}
        </NcButton>
      </template>
    </NcEmptyContent>
    <NcEmptyContent
      v-else-if="isUndefinedType"
      data-testid="undefined-type-message"
      :name="t('momentum', 'Undefined')"
      :description="
        t(
          'momentum',
          'No document type in the registry matched this document, so it has no extracted fields. Pick a type above to file it and extract its fields.',
        )
      "
    >
      <template #icon>
        <HelpCircleOutlineIcon :size="64" />
      </template>
    </NcEmptyContent>
    <NcEmptyContent
      v-else-if="isNeedsOcr"
      data-testid="needs-ocr-message"
      :name="t('momentum', 'This document needs OCR')"
      :description="
        t(
          'momentum',
          'This document could not be read automatically and needs OCR before its fields can be extracted.',
        )
      "
    />
    <NcEmptyContent
      v-else-if="isFailed"
      data-testid="failed-message"
      :name="t('momentum', 'Processing failed')"
      :description="t('momentum', 'This document failed to process. You can try reprocessing it.')"
    >
      <template #action>
        <NcButton data-testid="reprocess" :disabled="reprocessing" @click="reprocess">
          {{ t('momentum', 'Reprocess') }}
        </NcButton>
      </template>
    </NcEmptyContent>
    <NcEmptyContent
      v-else-if="isProcessingStalled"
      data-testid="processing-stalled-message"
      :name="t('momentum', 'This is taking longer than expected')"
      :description="
        t(
          'momentum',
          'This document is still queued for reprocessing. The fields from its previous run are kept and will be replaced when the new one finishes; if it never does, an administrator can check the processing queue.',
        )
      "
    >
      <template #action>
        <NcButton data-testid="recheck" @click="emit('recheck')">
          {{ t('momentum', 'Check again') }}
        </NcButton>
      </template>
    </NcEmptyContent>
    <div v-else-if="isReprocessing" data-testid="reprocessing-message" class="momentum-field-editor__skeleton" aria-busy="true">
      <NcLoadingIcon :size="32" />
      <p>{{ t('momentum', 'Reprocessing this document…') }}</p>
      <p>
        {{
          t(
            'momentum',
            'Hand-corrected fields you already saved are kept where the new type still has them.',
          )
        }}
      </p>
    </div>
    <template v-else>
      <div data-testid="type-summary" class="momentum-field-editor__type-summary">
        <span data-testid="type-summary-label" class="momentum-field-editor__type-summary-label">
          {{ typeDisplayName }}
        </span>
        <span data-testid="type-summary-count" class="momentum-field-editor__type-summary-count">
          {{ fieldsCountLabel }}
        </span>
      </div>
      <p v-if="summaryText" data-testid="document-summary" class="momentum-field-editor__summary">
        {{ summaryText }}
      </p>
      <details data-testid="document-info-disclosure" class="momentum-field-editor__info">
        <summary data-testid="document-info-summary" class="momentum-field-editor__info-summary">
          <ChevronRightIcon :size="17" class="momentum-field-editor__info-chevron" />
          {{ t('momentum', 'Document information') }}
        </summary>
        <div class="momentum-field-editor__info-body">
          <p class="momentum-field-editor__info-hint">
            {{
              t(
                'momentum',
                'You can correct any value here. Changes update the document manager’s data only. The original file in HiDrive Next stays unchanged.',
              )
            }}
          </p>
          <div data-testid="fields-scroll" class="momentum-field-editor__fields-scroll">
            <div
              v-for="field in sortedFields"
              :key="field.field_name"
              class="momentum-field-editor__field"
              :class="[
                { 'momentum-field-editor__field--dirty': isFieldDirty(field.field_name) },
                qualityFor(field.field_name)
                  ? `momentum-field-editor__field--quality-${qualityFor(field.field_name)}`
                  : '',
              ]"
              :data-field-name="field.field_name"
            >
              <div
                v-if="
                  field.field_name === LINE_ITEMS_FIELD_NAME &&
                  parseLineItems(currentValues[field.field_name!])
                "
              >
                <label class="momentum-field-editor__line-items-label">{{ field.display_name }}</label>
                <div class="momentum-field-editor__line-items-wrap">
                  <table data-testid="line-items-table" class="momentum-field-editor__line-items-table">
                    <thead>
                      <tr>
                        <th
                          v-for="col in lineItemColumns(parseLineItems(currentValues[field.field_name!])!)"
                          :key="col"
                        >
                          {{ titleCaseKey(col) }}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="(row, rowIndex) in parseLineItems(currentValues[field.field_name!])!"
                        :key="rowIndex"
                      >
                        <td
                          v-for="col in lineItemColumns(parseLineItems(currentValues[field.field_name!])!)"
                          :key="col"
                        >
                          {{ lineItemCell(row, col) }}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <template v-else-if="field.data_type === 'string'">
                <label class="momentum-field-editor__field-label">{{ field.display_name }}</label>
                <NcTextField
                  label-outside
                  :label="field.display_name"
                  :model-value="(currentValues[field.field_name!] as string | undefined) ?? ''"
                  @update:model-value="(value) => setFieldValue(field.field_name!, value)"
                />
              </template>
              <template v-else-if="field.data_type === 'int64'">
                <label class="momentum-field-editor__field-label">{{ field.display_name }}</label>
                <NcTextField
                  type="number"
                  step="1"
                  label-outside
                  :label="field.display_name"
                  :model-value="(currentValues[field.field_name!] as number | undefined) ?? ''"
                  @update:model-value="
                    (value) => setFieldValue(field.field_name!, value === '' ? null : Number(value))
                  "
                />
              </template>
              <template v-else-if="field.data_type === 'double'">
                <label class="momentum-field-editor__field-label">{{ field.display_name }}</label>
                <NcTextField
                  type="number"
                  label-outside
                  :label="field.display_name"
                  :model-value="(currentValues[field.field_name!] as number | undefined) ?? ''"
                  @update:model-value="
                    (value) => setFieldValue(field.field_name!, value === '' ? null : Number(value))
                  "
                />
              </template>
              <div v-else-if="field.data_type === 'date'" class="momentum-field-editor__date-field">
                <NcDateTimePicker
                  type="date"
                  :label="field.display_name"
                  :model-value="isoDateToDate(currentValues[field.field_name!])"
                  @update:model-value="(value) => setFieldValue(field.field_name!, dateToIsoDate(value))"
                />
              </div>
              <NcCheckboxRadioSwitch
                v-else-if="field.data_type === 'boolean'"
                type="switch"
                :model-value="Boolean(currentValues[field.field_name!])"
                @update:model-value="(value) => setFieldValue(field.field_name!, value)"
              >
                {{ field.display_name }}
              </NcCheckboxRadioSwitch>
              <span
                v-if="qualityFor(field.field_name)"
                data-testid="field-quality-badge"
                class="momentum-field-editor__quality"
                :class="`momentum-field-editor__quality--${qualityFor(field.field_name)}`"
              >
                <component :is="qualityIcon(qualityFor(field.field_name)!)" :size="14" />
                {{ qualityLabel(qualityFor(field.field_name)!) }}
              </span>
            </div>
          </div>
        </div>
      </details>
    </template>
  </div>

  <footer
    v-if="!loadFailed && !isNeedsOcr && !isFailed && !isReprocessing && !isUndefinedType"
    class="momentum-document-viewer__actions"
  >
    <NcButton
      data-testid="save-changes"
      :disabled="!isDirty || saving"
      @click="saveChanges"
    >
      {{ t('momentum', 'Save Changes') }}
    </NcButton>
    <NcButton
      v-if="isDirty"
      data-testid="discard-changes"
      @click="discardChanges"
    >
      {{ t('momentum', 'Discard Changes') }}
    </NcButton>
    <NcButton data-testid="toggle-reviewed" @click="toggleReviewed">
      {{ reviewed ? t('momentum', 'Mark Unreviewed') : t('momentum', 'Mark Reviewed') }}
    </NcButton>
  </footer>
</template>

<style scoped>
/* Phase 174 (M174.3): the mockup's `#doc-fields-footer` flows its actions
   in a row anchored to the bottom-right of the column
   (`.momentum-document-viewer__editor` in DocumentViewerPage.vue, already
   `flex-direction: column`); ours defaulted to `display: block`, so the
   three buttons stacked and left-aligned instead, and sat mid-panel rather
   than at the bottom. `margin-top: auto` is the idiomatic anchor for a
   flex-column's last child. The mockup's `gap: 12.8px` is its own
   rem-derived scale and isn't on this instance's 4px baseline, so it's
   expressed here as `calc(var(--default-grid-baseline) * 3)` instead. */
.momentum-document-viewer__actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: calc(var(--default-grid-baseline, 4px) * 3);
  margin-top: auto;
}

.momentum-field-editor__type-summary {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding-bottom: 0.8rem;
  margin-bottom: 0.8rem;
  border-bottom: 1px solid var(--color-border);
}

.momentum-field-editor__type-summary-label {
  display: inline-flex;
  align-items: center;
  background-color: var(--color-background-hover);
  color: var(--color-text-maxcontrast);
  border-radius: var(--border-radius-pill, 16px);
  padding: 0.2rem 0.6rem;
  font-weight: bold;
  font-size: 0.85rem;
}

.momentum-field-editor__type-summary-count {
  margin-inline-start: auto;
  font-size: 0.85rem;
  color: var(--color-text-maxcontrast);
  font-variant-numeric: tabular-nums;
}

/* specs/mockup-ai-document-manager.html's `.doc-sum` AI-summary callout —
   aliased onto real NC tokens (color-primary-element/border-radius-large)
   per CLAUDE.md's design-token rule rather than the mockup's own
   product-specific --mm-ai-accent/--r-card, which don't exist here. */
.momentum-field-editor__summary {
  margin: 0 0 1rem;
  padding: 0.9rem 1rem;
  border-radius: var(--border-radius-large, 8px);
  background-color: color-mix(in srgb, var(--color-primary-element) 6%, var(--color-main-background));
  color: var(--color-main-text);
  font-weight: bold;
  line-height: 1.45;
}

.momentum-field-editor__line-items-label {
  display: block;
  font-size: 0.8rem;
  color: var(--color-text-maxcontrast);
  margin-bottom: 0.3rem;
}

/* M173.1 — NcTextField's own floating label (NcInputField) sits at exactly
   the input's text position/size when empty and unfocused, so it reads as
   already-filled content rather than an empty labeled field. Render our own
   label outside the control (label-outside) instead. */
.momentum-field-editor__field-label {
  display: block;
  font-size: 0.8rem;
  color: var(--color-text-maxcontrast);
  margin-bottom: 0.3rem;
}

/* Line items can carry more columns than the fixed-width right panel is
   wide — scroll the table horizontally within its own box rather than
   letting it overflow the panel. */
.momentum-field-editor__line-items-wrap {
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius, 4px);
}

.momentum-field-editor__line-items-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
  white-space: nowrap;
}

.momentum-field-editor__line-items-table th,
.momentum-field-editor__line-items-table td {
  padding: 0.4rem 0.6rem;
  text-align: start;
  border-bottom: 1px solid var(--color-border);
}

.momentum-field-editor__line-items-table th {
  color: var(--color-text-maxcontrast);
  font-weight: 600;
  background-color: var(--color-background-hover);
}

.momentum-field-editor__line-items-table tbody tr:last-child td {
  border-bottom: none;
}

.momentum-field-editor__info {
  border-top: 1px solid var(--color-border);
  padding-top: 0.8rem;
}

.momentum-field-editor__info-summary {
  list-style: none;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: bold;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-maxcontrast);
}

.momentum-field-editor__info-summary::-webkit-details-marker {
  display: none;
}

.momentum-field-editor__info-summary:hover {
  color: var(--color-main-text);
}

.momentum-field-editor__info-chevron {
  flex: none;
  transition: transform 0.15s ease;
}

@media (prefers-reduced-motion: reduce) {
  .momentum-field-editor__info-chevron {
    transition: none;
  }
}

.momentum-field-editor__info[open] > .momentum-field-editor__info-summary .momentum-field-editor__info-chevron {
  transform: rotate(90deg);
}

.momentum-field-editor__info-body {
  margin-top: 0.7rem;
}

.momentum-field-editor__info-hint {
  font-size: 0.85rem;
  color: var(--color-text-maxcontrast);
  margin: 0 0 0.6rem;
  line-height: 1.45;
}

/* Independent scroll region for the field list — keeps the disclosure's own
   height (and the panel around it) from growing unbounded when a document
   type has many fields. */
.momentum-field-editor__fields-scroll {
  max-height: 24rem;
  overflow-y: auto;
}

/* M174.6 — .vue-date-time-picker (NcDateTimePicker's root, @vuepic/vue-datepicker
   under it) computes to a fractional width against its percentage-width
   ancestors; the browser rounds that up by a whisker on some field counts,
   which .momentum-field-editor__fields-scroll's own scrollWidth then reports
   as a few px of horizontal overflow — because CSS forbids overflow-y: auto
   above without also resolving overflow-x, `auto` gets promoted onto the
   axis nobody asked for, and a scrollbar the design never intended appears.
   Clipping the fractional overflow here, scoped to just the date control,
   fixes it at its source without pinning overflow-x on the shared scroll
   region, which would also silence any real future overflow there. */
.momentum-field-editor__date-field {
  overflow-x: hidden;
}

/* M173.2 — one bordered box per field (specs/mockup-ai-document-manager.html's
   .rv-field-row) holding the label, control, and quality indicator together,
   instead of the indicator reading as an unrelated pill in the gap between
   two stacked fields. The dirty accent is a box-shadow rather than a
   border-left-color so it never collides with the quality tint's
   border-color below — a field that is both dirty and carrying a stale
   quality tag (saveChanges only refreshes fieldQuality on save) shows both
   at once instead of one silently overriding the other. */
.momentum-field-editor__field {
  border: 1px solid transparent;
  border-radius: var(--border-radius, 8px);
  padding: 0.5rem 0.7rem;
  margin-inline-start: 8px;
}

.momentum-field-editor__field--dirty {
  box-shadow: inset 2px 0 0 0 var(--color-warning, #e9a63f);
}

.momentum-field-editor__field--quality-verified {
  background-color: color-mix(in srgb, var(--color-success) 8%, transparent);
  border-color: color-mix(in srgb, var(--color-success) 35%, transparent);
}

.momentum-field-editor__field--quality-warning {
  background-color: color-mix(in srgb, var(--color-warning, #e9a63f) 8%, transparent);
  border-color: color-mix(in srgb, var(--color-warning, #e9a63f) 35%, transparent);
}

.momentum-field-editor__field--quality-wrong {
  background-color: color-mix(in srgb, var(--color-error) 8%, transparent);
  border-color: color-mix(in srgb, var(--color-error) 35%, transparent);
}

/* M151.9 — the per-field quality badge (api.md § field_quality; the
   confidence pill in the operator's screenshot mock, now a tri-state
   verified/warning/wrong indicator instead of a raw confidence percentage).
   Pill styling mirrors FieldEditor's own type-summary label
   (.momentum-field-editor__type-summary-label) rather than inventing a new
   shape; only the color/icon vary per state, aliased onto real NC tokens per
   CLAUDE.md's design-token rule. */
.momentum-field-editor__quality {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  margin-top: 0.3rem;
  padding: 0.1rem 0.55rem;
  border-radius: var(--border-radius-pill, 16px);
  font-size: 0.78rem;
  font-weight: bold;
}

.momentum-field-editor__quality--verified {
  color: var(--color-success);
  background-color: color-mix(in srgb, var(--color-success) 14%, var(--color-main-background));
}

.momentum-field-editor__quality--warning {
  color: var(--color-warning, #e9a63f);
  background-color: color-mix(in srgb, var(--color-warning, #e9a63f) 14%, var(--color-main-background));
}

.momentum-field-editor__quality--wrong {
  color: var(--color-error);
  background-color: color-mix(in srgb, var(--color-error) 14%, var(--color-main-background));
}
</style>
