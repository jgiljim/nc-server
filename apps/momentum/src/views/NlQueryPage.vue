<script setup lang="ts">
import IonosGptEmbedPanel from '../components/IonosGptEmbedPanel.vue'
import type { EmbedContext } from '../embed/ionosGptEmbed'

// frontend.md § NL Query Page (M4.17). A full-height IonosGPT iframe
// pre-selecting the Filo Filing agent for corpus-wide questions ("Find all
// invoices from Acme over 10K", …). There is no per-document context — the
// mode is `corpus` — so the panel just mounts the embed and never re-injects
// a document/folder scope. The IonosGPT-side embed layout and the Filo
// agent's MCP tools are the external IonosGPT deliverable (backlog/v1.md
// Phase 4, "IonosGPT team"); this page only owns the host side.
const context: EmbedContext = { mode: 'corpus' }
</script>

<template>
  <div class="momentum-page momentum-page--nl-query">
    <IonosGptEmbedPanel :context="context" />
  </div>
</template>

<style scoped>
/* Full available viewport height — the iframe fills the page (frontend.md §
   NL Query Page). */
.momentum-page--nl-query {
  display: flex;
  height: 100%;
  min-height: 0;
  /* Reserve NcAppContent's collapse-navigation toggle footprint (a
     --default-clickable-area square in the content pane's top-left corner —
     backlog Phase 75 / M75.1): the embed panel fills the whole page with no
     heading row to absorb it, so the reserve goes on the corner directly. */
  padding-inline-start: var(--default-clickable-area, 44px);
  padding-block-start: var(--default-clickable-area, 44px);
}

.momentum-page--nl-query :deep(.momentum-ionosgpt-embed-panel) {
  flex: 1 1 auto;
  min-height: 0;
}

.momentum-page--nl-query :deep(.momentum-ionosgpt-embed) {
  width: 100%;
  height: 100%;
  border: none;
}
</style>
