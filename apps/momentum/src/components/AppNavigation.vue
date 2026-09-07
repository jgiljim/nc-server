<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { t } from '@nextcloud/l10n'
import NcAppNavigation from '@nextcloud/vue/components/NcAppNavigation'
import NcAppNavigationItem from '@nextcloud/vue/components/NcAppNavigationItem'
import { ncFilesBridge } from '../services/ncFilesBridgeRuntime'
import { CONSOLIDATED_FILE_VIEW_IDS } from '../services/ncFilesBridge'
import type { BridgeNavNode } from '../services/ncFilesBridge'

// frontend.md § Navigation Tree Additions — two flat entries: Documents and
// Chat. There are deliberately NO per-type children (M125.3): document type
// is a sortable, filterable COLUMN of the Documents table instead, so the nav
// no longer grows with the type registry and this component no longer calls
// GET /document-types at all.
//
// "Recent Documents" is gone too (M126.1): it was the same table as Documents
// with the same `created_at DESC` default, so it offered a second way to the
// same place. Its route stays — deep links keep working, and the M93.2
// list-scroll check still targets it — it simply is not a nav entry.

// frontend.md § Files & Shares Bridge — Nextcloud's own file views, read from
// the registry rather than hardcoded: whatever core (and any file-related app)
// registers is what the nav offers, with the registry's own parent/order, so
// "Shares" nests its six children exactly as the Files app does.
//
// The registry is populated by scripts the SERVER adds, whose load order
// relative to this bundle is not guaranteed, so this subscribes rather than
// reading once — a nav that silently lacks Files because our bundle won the
// race would be the exact failure this avoids.
const bridge = ncFilesBridge()
const fileViews = ref<BridgeNavNode[]>(bridge.navTree())
const stopWatching = bridge.onViewsChanged(() => {
  fileViews.value = bridge.navTree()
})
onUnmounted(stopWatching)

// Phase 145 — All files / Personal files / Recent / Favorites are the same
// table under a different filter, so they collapse into a single "Files"
// entry (routed at the `files` view id) rather than four separate rail
// entries; the individual filters live on as tabs INSIDE the Files view
// (FileBrowserPage.vue), not as separate nav entries. The rest of the
// registry (Shares, Tags, Deleted files, …) is untouched.
const consolidatedIds = new Set(CONSOLIDATED_FILE_VIEW_IDS)

// Phase 150 (M150.1) — Tags is a distinct taxonomy with no tab destination
// (unlike Phase 145's four), so it is removed from the rail outright rather
// than consolidated. This is deliberately narrower than Phase 136's reverted
// blanket `HIDDEN_NAV_VIEW_IDS` filter: only this one id, and only the nav
// entry — the `tags` route itself keeps resolving ("hide, don't remove"
// still applies to the route).
const HIDDEN_NAV_VIEW_IDS: readonly string[] = ['tags']
const hiddenIds = new Set(HIDDEN_NAV_VIEW_IDS)

const fileNavNodes = computed<BridgeNavNode[]>(() => {
  const nodes: BridgeNavNode[] = []
  let addedFilesEntry = false
  for (const node of fileViews.value) {
    if (hiddenIds.has(node.view.id)) {
      continue
    }
    if (consolidatedIds.has(node.view.id)) {
      if (!addedFilesEntry) {
        nodes.push({
          view: { ...node.view, id: 'files', name: t('momentum', 'Files') },
          children: [],
        })
        addedFilesEntry = true
      }
      continue
    }
    nodes.push(node)
  }
  return nodes
})
</script>

<template>
  <NcAppNavigation>
    <template #list>
      <NcAppNavigationItem
        data-testid="nav-documents"
        :name="t('momentum', 'Documents')"
        :to="{ name: 'documents' }"
      />
      <NcAppNavigationItem
        data-testid="nav-ask-filo"
        :name="t('momentum', 'Chat')"
        :to="{ name: 'nl-query' }"
      />
      <NcAppNavigationItem
        v-for="node in fileNavNodes"
        :key="node.view.id"
        data-testid="nav-file-view"
        :name="node.view.name"
        :to="{ name: 'file-browser', params: { viewId: node.view.id } }"
        :allow-collapse="node.children.length > 0"
      >
        <template v-if="node.children.length" #default>
          <NcAppNavigationItem
            v-for="child in node.children"
            :key="child.id"
            data-testid="nav-file-view-child"
            :name="child.name"
            :to="{ name: 'file-browser', params: { viewId: child.id } }"
          />
        </template>
      </NcAppNavigationItem>
    </template>
  </NcAppNavigation>
</template>
