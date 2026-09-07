<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { MOMENTUM_CONFIG } from '../config'

// TypeaheadSearch (frontend.md § TypeaheadSearch): a debounced text input that,
// on commit (Enter), emits its term so the DocumentList toolbar can add it as a
// search FilterPill (toolbar item 1 → item 2). Multiple committed terms coexist
// as separate pills — that's the parent's filter-set concern; this component
// just emits one `searchCommit` per Enter and clears itself, so the next term
// starts clean.
//
// v1 has no suggestion dropdown (commit on Enter only). `debouncedQuery` is the
// seam the v2 autocomplete endpoint will read — the input mirrored after
// `SEARCH_DEBOUNCE_MS` of idle typing. It is exposed (defineExpose) rather than
// left as dead internal state so the debounce is real, tested, and ready to
// wire a suggestion fetch to without reshaping this component.
const props = defineProps<{
  placeholder: string
  disabled: boolean
}>()

const emit = defineEmits<{
  (e: 'searchCommit', term: string): void
}>()

// `query` is the input's own immediate state and the source of truth for what
// Enter commits; `debouncedQuery` lags it by SEARCH_DEBOUNCE_MS.
const query = ref('')
const debouncedQuery = ref('')
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function cancelDebounce(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}

function onInput(value: string | number): void {
  query.value = String(value)
  cancelDebounce()
  debounceTimer = setTimeout(() => {
    debouncedQuery.value = query.value
    debounceTimer = null
  }, MOMENTUM_CONFIG.SEARCH_DEBOUNCE_MS)
}

function commit(): void {
  if (props.disabled) return
  const term = query.value.trim()
  if (term === '') return
  emit('searchCommit', term)
  // Clear both the input and any in-flight debounce so a settled value can't
  // resurface after the field has been emptied.
  cancelDebounce()
  query.value = ''
  debouncedQuery.value = ''
}

onBeforeUnmount(cancelDebounce)

defineExpose({ debouncedQuery })
</script>

<template>
  <NcTextField
    type="search"
    :label="placeholder"
    :placeholder="placeholder"
    :disabled="disabled"
    :model-value="query"
    @update:model-value="onInput"
    @keydown.enter="commit" />
</template>
