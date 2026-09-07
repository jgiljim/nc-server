<script setup lang="ts">
import NcAppSidebar from '@nextcloud/vue/components/NcAppSidebar'
import NcAppSidebarTab from '@nextcloud/vue/components/NcAppSidebarTab'
import type { BridgeSidebarTab } from '../services/ncFilesBridge'

// M177.3 (backlog/v1.md Phase 177): `M174.7` reached the real, shared Files
// sidebar STORE (`window.OCA.Files._sidebar()`, proxied by
// `services/ncFilesBridge.ts`'s `sidebarAvailable()`/`openSidebar()`) and it
// works — `getTabs()` already returns `momentum-nl` alongside NC's own
// `sharing`/`activity`/`files_versions`. What was missing is this component:
// the STORE is a stateless proxy, and the Vue component that actually RENDERS
// it (`AppSidebar.vue`) lives in the real Files app's own bundle, which only
// mounts on the Files app's own pages — never on this page, since this is a
// parity re-implementation of file browsing (frontend.md § Files & Shares
// Bridge), not the Files app itself. So this page owns its own sidebar UI,
// bound to the SAME tabs the shared registry already returns
// (`ncFilesBridge.ts`'s `sidebarTabsFor`/`prepareSidebarTabs`).
//
// Each tab is the real `@nextcloud/files@4.0.0` Web Components contract
// (`RawSidebarTab` in ncFilesBridge.ts, same source `momentumAskAiSidebar.ts`
// targets for our own `momentum-nl` tab): a `<tagName>` custom element with a
// `node` property the real sidebar sets directly — there is no render
// callback to call ourselves, so `<component :is="tab.tagName">` plus binding
// `:node` is the whole of it.
const props = defineProps<{
  // `undefined` when no row's "Open details" has been clicked yet — closes
  // (unmounts) the sidebar entirely, same as the real Files sidebar's `open`
  // prop with no toggle affordance we need here (this page always reopens via
  // a fresh row action, never a collapsed rail state).
  node?: { basename: string; raw: unknown }
  tabs: BridgeSidebarTab[]
  activeTab: string
}>()

const emit = defineEmits<{
  'update:activeTab': [id: string]
  close: []
}>()
</script>

<template>
  <NcAppSidebar
    v-if="props.node"
    :name="props.node.basename"
    :active="props.activeTab"
    data-testid="files-sidebar"
    @update:active="emit('update:activeTab', $event)"
    @close="emit('close')">
    <NcAppSidebarTab
      v-for="tab in props.tabs"
      :id="tab.id"
      :key="tab.id"
      :name="tab.displayName"
      :order="tab.order"
      :data-testid="`files-sidebar-tab-${tab.id}`">
      <template #icon>
        <span class="files-sidebar__tab-icon" v-html="tab.iconSvgInline" />
      </template>
      <component :is="tab.tagName" :node="props.node.raw" />
    </NcAppSidebarTab>
  </NcAppSidebar>
</template>

<style scoped>
.files-sidebar__tab-icon {
  display: flex;
}
</style>
