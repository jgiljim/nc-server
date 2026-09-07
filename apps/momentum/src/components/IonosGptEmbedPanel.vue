<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { EmbedContext, IonosGptEmbedHandle } from '../embed/ionosGptEmbed'
import { mountIonosGptEmbed } from '../embed/ionosGptEmbed'

// Vue wrapper around the framework-agnostic embed primitive (src/embed/ionosGptEmbed.ts) —
// for Vue-routed pages (e.g. the NL Query Page, M4.17). The Ask AI sidebar tab (M4.16) mounts
// via NC's own registerSidebarTab(el, fileInfo) API instead, so it calls mountIonosGptEmbed
// directly rather than through this component.
const props = defineProps<{ context?: EmbedContext }>()

const container = ref<HTMLElement | null>(null)
let handle: IonosGptEmbedHandle | null = null

onMounted(() => {
  if (container.value) {
    handle = mountIonosGptEmbed(container.value, props.context)
  }
})

watch(
  () => props.context,
  (nextContext) => {
    if (handle && nextContext) handle.updateContext(nextContext)
  },
)

onBeforeUnmount(() => {
  handle?.destroy()
  handle = null
})
</script>

<template>
  <div ref="container" class="momentum-ionosgpt-embed-panel" />
</template>
