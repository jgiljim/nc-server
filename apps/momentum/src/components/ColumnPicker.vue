<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcPopover from '@nextcloud/vue/components/NcPopover'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import { ColumnsIcon } from './icons'
import type { ColumnDef } from '../types'

// ColumnPicker (frontend.md § ColumnPicker): a popover checklist of all
// available columns — system columns and extracted-field columns alike. Every
// column is toggleable; there are no permanently fixed columns. `DocumentList`
// supplies a sensible default visible set so users don't open the picker to a
// blank table, and owns persistence via `persistKey` (see columnVisibility.ts)
// — this component is purely controlled: `selected` in, `change` out.
const props = defineProps<{
  columns: ColumnDef[]
  selected: string[]
}>()

const emit = defineEmits<{
  (e: 'change', selected: string[]): void
}>()

function isVisible(key: string): boolean {
  return props.selected.includes(key)
}

// Toggle one column, preserving `columns` order in the emitted set so the
// visible-column order is stable and independent of click order.
function toggle(key: string, visible: boolean): void {
  const next = new Set(props.selected)
  if (visible) {
    next.add(key)
  } else {
    next.delete(key)
  }
  emit(
    'change',
    props.columns.map((c) => c.key).filter((k) => next.has(k)),
  )
}
</script>

<template>
  <NcPopover>
    <template #trigger="{ attrs }">
      <NcButton v-bind="attrs" :aria-label="t('momentum', 'Choose columns')">
        <template #icon>
          <ColumnsIcon :size="20" />
        </template>
        {{ t('momentum', 'Columns') }}
      </NcButton>
    </template>
    <div class="momentum-column-picker">
      <fieldset class="momentum-column-picker__list">
        <legend class="momentum-column-picker__legend">
          {{ t('momentum', 'Visible columns') }}
        </legend>
        <NcCheckboxRadioSwitch
          v-for="col in columns"
          :key="col.key"
          :model-value="isVisible(col.key)"
          @update:model-value="(v) => toggle(col.key, v)">
          {{ col.label }}
        </NcCheckboxRadioSwitch>
      </fieldset>
    </div>
  </NcPopover>
</template>

<style scoped>
.momentum-column-picker {
  padding: calc(var(--default-grid-baseline, 4px) * 2);
  min-width: 220px;
}

.momentum-column-picker__list {
  border: none;
  margin: 0;
  padding: 0;
}

.momentum-column-picker__legend {
  font-weight: bold;
  margin-bottom: var(--default-grid-baseline, 4px);
}
</style>
