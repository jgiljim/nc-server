<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import NcChip from '@nextcloud/vue/components/NcChip'

// FilterPill (frontend.md § FilterPill): a compact dismissible chip
// representing one active constraint — one per active filter or search term in
// the DocumentList toolbar (frontend.md § DocumentList toolbar item 2). The
// caller composes the human-readable `label` (the spec's two render formats,
// "{field} {operator} {value}" and "search: {term}", are the caller's concern,
// not this component's) and removes the pill from filter state when the ×
// fires. This component only renders the text and surfaces the dismiss.
//
// The spec lists an `onRemove: () => void` prop; the Vue-idiomatic equivalent
// (and what the sibling toolbar components use) is a `remove` emit — a parent's
// `@remove="..."` is exactly the `onRemove` the spec names. FilterPill is
// single-root (just NcChip), so a caller's `class`/`style` auto-merges onto the
// chip root; the multi-root forwarding pitfall does not apply.
defineProps<{
  label: string
}>()

const emit = defineEmits<{
  (e: 'remove'): void
}>()
</script>

<template>
  <NcChip
    :text="label"
    :aria-label-close="t('momentum', 'Remove filter')"
    @close="emit('remove')" />
</template>
