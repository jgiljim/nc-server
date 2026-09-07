<script setup lang="ts">
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcPopover from '@nextcloud/vue/components/NcPopover'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcDateTimePicker from '@nextcloud/vue/components/NcDateTimePicker'
import { FilterIcon } from './icons'
import {
  DOCUMENT_STATUS_VALUES,
  FIELD_NAME_REVIEWED,
  FIELD_NAME_STATUS,
  type FilterableField,
  type FilterValue,
} from '../types'

// FilterPicker (frontend.md § FilterPicker): a popover for composing one new
// filter. Receives a flat list of filterable fields (built-in system fields
// and type-specific extracted fields alike — the caller, DocumentList/M4.4,
// owns which fields appear and their operators). Three sequential steps:
//   1. pick a field   — shows display_name for each entry
//   2. pick an operator — shows operators[] for the chosen field
//   3. enter a value   — widget matches data_type; `status` renders a select
//      of the five known values; `reviewed` renders a true/false toggle
// On confirm it emits `filterAdd` and closes; on cancel or outside-click it
// discards without emitting.
const props = defineProps<{
  fields: FilterableField[]
}>()

const emit = defineEmits<{
  (e: 'filterAdd', filter: FilterValue): void
}>()

const open = ref(false)
const selectedFieldName = ref<string | null>(null)
const selectedOperator = ref<string | null>(null)
const value = ref<string | boolean>('')
// `between`/`not_between` need two bounds rather than the single `value`
// above — kept as separate refs so the single-value widgets above are
// untouched.
const rangeLower = ref<string>('')
const rangeUpper = ref<string>('')

const selectedField = computed(() =>
  props.fields.find((f) => f.field_name === selectedFieldName.value) ?? null,
)

// Field-select options carry the field_name as id and display_name as label.
interface FieldOption {
  id: string
  label: string
}
const fieldOptions = computed<FieldOption[]>(() =>
  props.fields.map((f) => ({ id: f.field_name, label: f.display_name })),
)
const reduceFieldOption = (o: FieldOption): string => o.id

const operators = computed(() => selectedField.value?.operators ?? [])

// Which value widget step 3 renders. A field carrying its own `values` list
// wins (M125.1: document type, from GET /document-types — data-driven rather
// than one more field name hardcoded here); `status`/`reviewed` are then
// special-cased by field name per the spec; everything else keys off the
// field's data_type.
type ValueKind = 'choice' | 'status' | 'reviewed' | 'boolean' | 'date' | 'number' | 'text'
const valueKind = computed<ValueKind>(() => {
  const field = selectedField.value
  if (!field) return 'text'
  if (field.values?.length) return 'choice'
  if (field.field_name === FIELD_NAME_STATUS) return 'status'
  if (field.field_name === FIELD_NAME_REVIEWED) return 'reviewed'
  switch (field.data_type) {
    case 'boolean':
      return 'boolean'
    case 'date':
      return 'date'
    case 'int64':
    case 'double':
      return 'number'
    default:
      return 'text'
  }
})

const isBooleanValue = computed(
  () => valueKind.value === 'reviewed' || valueKind.value === 'boolean',
)

// `between`/`not_between` render two value inputs together instead of one
// (M33.2, mirroring the by-type extracted-field catalog, M23.4). api.md §
// Filtering allows both operators on `date`, `int64` and `double`, so the
// range step renders two date pickers for date fields and two number inputs
// for numeric ones. Any other data_type falls back to the single-value widget
// below — the API rejects ranges there anyway, and leaving the range branch on
// would make confirm permanently unreachable.
const isRangeOperator = computed(
  () => selectedOperator.value === 'between' || selectedOperator.value === 'not_between',
)
const isDateRange = computed(() => valueKind.value === 'date' && isRangeOperator.value)
const isNumberRange = computed(() => valueKind.value === 'number' && isRangeOperator.value)
const isRangeInput = computed(() => isDateRange.value || isNumberRange.value)

const statusOptions = DOCUMENT_STATUS_VALUES as readonly string[]

// NcSelect works in whole option objects; the emitted filter value is the
// option's `value`, so the selection is mapped both ways here rather than
// letting the display label leak into an `f=` expression.
const choiceOptions = computed(() => selectedField.value?.values ?? [])
const choiceModel = computed(
  () => choiceOptions.value.find((option) => option.value === value.value) ?? null,
)

function setChoice(next: { value: string; label: string } | null): void {
  value.value = next?.value ?? ''
}

// NcDateTimePicker works in `Date`; the emitted filter value is the string
// `field_name:operator:value` expression's value, so we serialize to an
// ISO date (YYYY-MM-DD) and parse back for display.
const dateModel = computed<Date | null>(() => {
  if (typeof value.value !== 'string' || value.value === '') return null
  const parsed = new Date(value.value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
})

function setDate(next: Date | [Date, Date] | null): void {
  const picked = Array.isArray(next) ? next[0] : next
  value.value =
    picked instanceof Date && !Number.isNaN(picked.getTime())
      ? picked.toISOString().slice(0, 10)
      : ''
}

// Same ISO-date serialization as `dateModel`/`setDate` above, applied to the
// two bounds of a `between`/`not_between` range.
function dateBoundModel(bound: Ref<string>): ComputedRef<Date | null> {
  return computed(() => {
    if (bound.value === '') return null
    const parsed = new Date(bound.value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  })
}

function setDateBound(bound: Ref<string>, next: Date | [Date, Date] | null): void {
  const picked = Array.isArray(next) ? next[0] : next
  bound.value =
    picked instanceof Date && !Number.isNaN(picked.getTime())
      ? picked.toISOString().slice(0, 10)
      : ''
}

const rangeLowerModel = dateBoundModel(rangeLower)
const rangeUpperModel = dateBoundModel(rangeUpper)
const setRangeLower = (next: Date | [Date, Date] | null) => setDateBound(rangeLower, next)
const setRangeUpper = (next: Date | [Date, Date] | null) => setDateBound(rangeUpper, next)

// NcTextField's model is string|number; `value` widens to include boolean for
// the toggle widgets, so narrow to a string for the text/number input.
const textValue = computed(() => (typeof value.value === 'string' ? value.value : ''))

// Confirm is enabled once a field, an operator, and a value are all present.
// Boolean-valued widgets always have a value (false is meaningful), so they
// only need field + operator.
const canConfirm = computed(() => {
  if (!selectedFieldName.value || !selectedOperator.value) return false
  if (isRangeInput.value) return rangeLower.value !== '' && rangeUpper.value !== ''
  if (isBooleanValue.value) return true
  return typeof value.value === 'string' && value.value.trim() !== ''
})

// Changing the field resets the downstream steps and seeds a type-appropriate
// default value (false for boolean toggles, empty otherwise).
watch(selectedFieldName, () => {
  selectedOperator.value = null
  value.value = isBooleanValue.value ? false : ''
  rangeLower.value = ''
  rangeUpper.value = ''
})

// Changing the operator (e.g. `eq` → `between`) resets the value step so a
// stale single value can't leak into a range, or vice versa.
watch(selectedOperator, () => {
  value.value = isBooleanValue.value ? false : ''
  rangeLower.value = ''
  rangeUpper.value = ''
})

function reset(): void {
  selectedFieldName.value = null
  selectedOperator.value = null
  value.value = ''
  rangeLower.value = ''
  rangeUpper.value = ''
}

function confirm(): void {
  if (!canConfirm.value || !selectedFieldName.value || !selectedOperator.value) return
  emit('filterAdd', {
    field_name: selectedFieldName.value,
    operator: selectedOperator.value,
    value: isRangeInput.value ? `${rangeLower.value},${rangeUpper.value}` : value.value,
  })
  open.value = false
  reset()
}

function cancel(): void {
  open.value = false
  reset()
}

// Outside-click / Esc drives `update:shown` false — discard the in-progress
// filter, same as an explicit cancel.
function onShownChange(shown: boolean): void {
  open.value = shown
  if (!shown) reset()
}
</script>

<template>
  <NcPopover
    :shown="open"
    popover-base-class="momentum-filter-picker-popover"
    @update:shown="onShownChange">
    <template #trigger="{ attrs }">
      <NcButton v-bind="attrs" :aria-label="t('momentum', 'Add filter')">
        <template #icon>
          <FilterIcon :size="20" />
        </template>
        {{ t('momentum', 'Filter') }}
      </NcButton>
    </template>
    <div class="momentum-filter-picker">
      <!-- Step 1: field -->
      <!-- append-to-body must be false: NcPopover closes on any click outside
           its own DOM subtree (focus-trap), and NcSelect's dropdown defaults
           to teleporting into <body> — outside that subtree — so picking an
           option was misread as an outside click and silently discarded the
           whole in-progress filter before `filterAdd` could ever fire. -->
      <NcSelect
        :model-value="selectedFieldName"
        :options="fieldOptions"
        :reduce="reduceFieldOption"
        :append-to-body="false"
        label="label"
        :input-label="t('momentum', 'Field')"
        :placeholder="t('momentum', 'Select a field')"
        @update:model-value="(v) => (selectedFieldName = v)" />

      <!-- Step 2: operator -->
      <NcSelect
        v-if="selectedFieldName"
        :model-value="selectedOperator"
        :options="operators"
        :append-to-body="false"
        :input-label="t('momentum', 'Operator')"
        :placeholder="t('momentum', 'Select an operator')"
        @update:model-value="(v) => (selectedOperator = v)" />

      <!-- Step 3: value -->
      <template v-if="selectedFieldName && selectedOperator">
        <NcSelect
          v-if="valueKind === 'choice'"
          data-testid="filter-picker-choice"
          :model-value="choiceModel"
          :options="choiceOptions"
          label="label"
          :append-to-body="false"
          :input-label="t('momentum', 'Value')"
          :placeholder="selectedField?.display_name ?? t('momentum', 'Select a value')"
          @update:model-value="setChoice" />

        <NcSelect
          v-else-if="valueKind === 'status'"
          :model-value="value"
          :options="statusOptions"
          :append-to-body="false"
          :input-label="t('momentum', 'Value')"
          :placeholder="t('momentum', 'Select a status')"
          @update:model-value="(v) => (value = v)" />

        <NcCheckboxRadioSwitch
          v-else-if="isBooleanValue"
          type="switch"
          :model-value="value === true"
          @update:model-value="(v) => (value = v)">
          {{ t('momentum', 'Value') }}
        </NcCheckboxRadioSwitch>

        <template v-else-if="isDateRange">
          <NcDateTimePicker
            :model-value="rangeLowerModel"
            type="date"
            :label="t('momentum', 'From')"
            @update:model-value="setRangeLower" />
          <NcDateTimePicker
            :model-value="rangeUpperModel"
            type="date"
            :label="t('momentum', 'To')"
            @update:model-value="setRangeUpper" />
        </template>

        <template v-else-if="isNumberRange">
          <NcTextField
            :model-value="rangeLower"
            type="number"
            :label="t('momentum', 'From')"
            @update:model-value="(v) => (rangeLower = String(v))" />
          <NcTextField
            :model-value="rangeUpper"
            type="number"
            :label="t('momentum', 'To')"
            @update:model-value="(v) => (rangeUpper = String(v))" />
        </template>

        <NcDateTimePicker
          v-else-if="valueKind === 'date'"
          :model-value="dateModel"
          type="date"
          :label="t('momentum', 'Value')"
          @update:model-value="setDate" />

        <NcTextField
          v-else
          :model-value="textValue"
          :type="valueKind === 'number' ? 'number' : 'text'"
          :label="t('momentum', 'Value')"
          @update:model-value="(v) => (value = String(v))" />
      </template>

      <div class="momentum-filter-picker__actions">
        <NcButton @click="cancel">{{ t('momentum', 'Cancel') }}</NcButton>
        <NcButton variant="primary" :disabled="!canConfirm" @click="confirm">
          {{ t('momentum', 'Add filter') }}
        </NcButton>
      </div>
    </div>
  </NcPopover>
</template>

<style scoped>
.momentum-filter-picker {
  display: flex;
  flex-direction: column;
  gap: calc(var(--default-grid-baseline, 4px) * 2);
  padding: calc(var(--default-grid-baseline, 4px) * 2);
  min-width: 260px;
}

.momentum-filter-picker__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--default-grid-baseline, 4px);
}
</style>

<style>
/* Unscoped: NcPopover's `.v-popper__inner` clips overflow by default (for
   rounded corners), but the step-1 field NcSelect above has
   append-to-body="false" (see the comment on it), so its options dropdown
   renders absolutely-positioned *inside* this popover instead of teleported
   to <body> — without this override, the field list beyond the first option
   or two is invisible, clipped by the popover's own bounds. */
.momentum-filter-picker-popover .v-popper__inner {
  overflow: visible !important;
}
</style>
