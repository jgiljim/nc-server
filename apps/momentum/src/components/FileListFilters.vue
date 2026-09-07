<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcChip from '@nextcloud/vue/components/NcChip'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcPopover from '@nextcloud/vue/components/NcPopover'
import type { BridgeFilter, BridgeFilterChip } from '../services/ncFilesBridge'

// Renders Nextcloud's own file-list filters — Type, Modified, People
// (frontend.md § Files-app parity, M124.3).
//
// The arrangement is the Files app's own, read from its shipped source
// (`apps/files/src/components/FileListFilter/FileListFilters.vue`): ONE popover
// per filter, whose trigger carries the filter's `iconSvgInline` +
// `displayName`, and whose content is the filter's own web component with the
// filter instance set as a DOM property. That detail is load-bearing — the
// components are inline lists of toggle buttons, not popovers themselves, so
// rendering them directly in the toolbar spills their whole contents across the
// page (seen on the running instance, 2026-08-25, before this was fixed).
//
// Mounting is driven by the HOST DIV'S REF CALLBACK, which is the one signal
// that is always right. Two other approaches were built and measured against
// the running instance first, and both failed (2026-08-25): mounting eagerly
// on `mounted()` finds no host, because an uncontrolled NcPopover renders its
// default slot only once it is opened; and hooking `@update:shown` never fired,
// because binding `:shown` puts the popover in controlled mode where it no
// longer opens itself. Vue calls the ref callback exactly when the popover
// creates (and again when it destroys) that div, so there is nothing left to
// synchronise.
//
// Filters without a `tagName` (`files:hidden`, `files:filename`) have no UI by
// design; they are still part of the chain the page applies, which is where
// NC's hidden-files behaviour comes from.
const props = defineProps<{ filters: BridgeFilter[] }>()

const emit = defineEmits<{
  (e: 'filterChanged'): void
}>()

const hosts = ref<Record<string, HTMLElement | null>>({})
const chips = ref<Record<string, BridgeFilterChip[]>>({})
let unsubscribes: Array<() => void> = []

function withUi(): BridgeFilter[] {
  return props.filters.filter((filter) => !!filter.tagName)
}

// Mounts one filter's element into its host, once per host. `customElements.get`
// is checked rather than assumed: an app can register a filter whose defining
// bundle never loaded, and an unknown tag renders as a silent empty element.
function onHost(filter: BridgeFilter, host: HTMLElement | null): void {
  hosts.value[filter.id] = host
  if (!host || host.childElementCount > 0) return
  if (!customElements.get(filter.tagName as string)) return
  const element = document.createElement(filter.tagName as string)
  filter.attachTo(element as unknown as { filter?: unknown })
  host.appendChild(element)
}

function subscribeAll(): void {
  unsubscribes.forEach((unsubscribe) => unsubscribe())
  unsubscribes = props.filters.map((filter) =>
    filter.subscribe(
      () => emit('filterChanged'),
      () => {
        chips.value = { ...chips.value, [filter.id]: filter.chips() }
      },
    ),
  )
}

onMounted(subscribeAll)

watch(
  () => props.filters.map((filter) => filter.id).join(','),
  () => subscribeAll(),
)

onBeforeUnmount(() => {
  unsubscribes.forEach((unsubscribe) => unsubscribe())
  unsubscribes = []
})
</script>

<template>
  <div class="momentum-file-filters" data-testid="file-list-filters">
    <NcPopover v-for="filter in withUi()" :key="filter.id">
      <template #trigger>
        <NcButton
          variant="tertiary"
          :data-testid="`file-list-filter-${filter.id}`"
          :aria-label="filter.displayName">
          <template v-if="filter.iconSvgInline" #icon>
            <NcIconSvgWrapper :svg="filter.iconSvgInline" />
          </template>
          {{ filter.displayName }}
        </NcButton>
      </template>
      <div
        :ref="(el) => onHost(filter, el as HTMLElement | null)"
        class="momentum-file-filters__host"
        :data-filter-id="filter.id" />
    </NcPopover>
    <NcChip
      v-for="chip in Object.values(chips).flat()"
      :key="chip.text"
      data-testid="file-list-filter-chip"
      :aria-label="t('momentum', 'Remove filter')"
      @close="chip.onclick()">
      {{ chip.text }}
    </NcChip>
  </div>
</template>

<style scoped>
.momentum-file-filters {
  display: flex;
  align-items: center;
  gap: var(--default-grid-baseline, 4px);
  /* nowrap, and never shrink: with wrapping on, the three triggers stacked
     into a three-row column at the top right as soon as the breadcrumbs
     claimed the free space — measured on the running instance, 2026-08-25.
     The breadcrumbs are the element that gives way instead (see
     FileBrowserPage's toolbar rules). */
  flex-wrap: nowrap;
  flex: 0 0 auto;
}

.momentum-file-filters__host {
  /* The filter components are inline lists sized by their own styles; this only
     stops a long list from overflowing the popover. */
  max-height: 50vh;
  overflow-y: auto;
}
</style>
