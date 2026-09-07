<script setup lang="ts">
import { ref } from 'vue'
import { t } from '@nextcloud/l10n'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcButton from '@nextcloud/vue/components/NcButton'
import { CloseIcon } from './icons'
import { dismissNewlySharedHint, isNewlySharedHintDismissed } from './newlySharedHintStorage'

// NewlySharedHint (frontend.md § Newly-shared items: eventual-consistency
// affordance): a subtle, dismissible hint that a just-shared document may
// not appear in list/search results yet (access-projection lag, review.md
// G5) — v1 exposes no computed staleness field, so this is a static
// affordance, not a live indicator. Mount once on each of the Recent /
// By-Type / search-results surfaces (frontend.md names all three); the
// dismissal is shared across them via localStorage so dismissing on one
// surface dismisses it everywhere.
const dismissed = ref(isNewlySharedHintDismissed())

function dismiss(): void {
  dismissNewlySharedHint()
  dismissed.value = true
}
</script>

<template>
  <NcNoteCard v-if="!dismissed" type="info" class="momentum-newly-shared-hint">
    <div class="momentum-newly-shared-hint__row">
      <span>{{ t('momentum', 'Recently shared items may take a moment to appear.') }}</span>
      <NcButton
        variant="tertiary"
        :aria-label="t('momentum', 'Dismiss')"
        @click="dismiss">
        <template #icon>
          <CloseIcon :size="20" />
        </template>
      </NcButton>
    </div>
  </NcNoteCard>
</template>

<style scoped>
.momentum-newly-shared-hint__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: calc(var(--default-grid-baseline, 4px) * 2);
}
</style>
