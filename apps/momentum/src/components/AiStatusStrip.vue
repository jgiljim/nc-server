<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { n, t } from '@nextcloud/l10n'
import { CreationOutlineIcon } from './icons'

// AiStatusStrip (frontend.md § Processing progress: the AI status strip):
// presentational only — no fetch/timer/polling logic. M149.2 wires this up
// with a tenant-wide `GET /stats/overview` poll and a monotonic total/done
// tracker (M157.1); this component just renders whatever { total, done,
// stale } it's given. The three-dot animation intentionally claims only
// "still working", never a percentage — the pipeline's per-document status
// enum has no partial credit, so a progress bar would either sit motionless
// between polls or jump in uneven steps on the next one.
defineProps<{
  total: number
  done: number
  // M157.2: true once the poll has failed
  // MOMENTUM_CONFIG.AI_STRIP_STALE_AFTER_FAILURES times in a row — the count
  // below is no longer substantiated by a fresh read, so it says so instead
  // of continuing to assert stale numbers.
  stale?: boolean
}>()

// M164.1: the dots are the strip's only "still working" signal (never a
// percentage — see above), so reduced motion needs a static equivalent, not
// a removal. Detected in JS rather than left to a CSS `@media
// (prefers-reduced-motion: reduce)` block: this component's own test suite
// runs against jsdom, whose CSS engine never evaluates `@media` conditions
// (confirmed empirically — a media-gated rule stays inert regardless of
// matchMedia), so only a JS-toggled class is something that test suite can
// actually observe.
const prefersReducedMotion = ref(false)
let reducedMotionQuery: MediaQueryList | undefined

function updatePrefersReducedMotion() {
  prefersReducedMotion.value = reducedMotionQuery?.matches ?? false
}

onMounted(() => {
  if (typeof window.matchMedia !== 'function') return
  reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  updatePrefersReducedMotion()
  reducedMotionQuery.addEventListener('change', updatePrefersReducedMotion)
})

onUnmounted(() => {
  reducedMotionQuery?.removeEventListener('change', updatePrefersReducedMotion)
})
</script>

<template>
  <div class="momentum-ai-status-strip">
    <CreationOutlineIcon :size="20" class="momentum-ai-status-strip__icon" />
    <span class="momentum-ai-status-strip__message">
      {{ n('momentum', 'Reading %n document…', 'Reading %n documents…', total) }}
    </span>
    <span v-if="stale" class="momentum-ai-status-strip__count">{{
      t('momentum', 'status unavailable')
    }}</span>
    <span v-else class="momentum-ai-status-strip__count">{{
      t('momentum', '{done} of {total}', { done, total })
    }}</span>
    <span
      class="momentum-ai-status-strip__dots"
      :class="{ 'momentum-ai-status-strip__dots--reduced-motion': prefersReducedMotion }"
      aria-hidden="true"
    >
      <span class="momentum-ai-status-strip__dot" />
      <span class="momentum-ai-status-strip__dot" />
      <span class="momentum-ai-status-strip__dot" />
    </span>
  </div>
</template>

<style scoped>
.momentum-ai-status-strip {
  display: flex;
  align-items: center;
  gap: calc(var(--default-grid-baseline, 4px) * 2);
  padding: calc(var(--default-grid-baseline, 4px) * 2) calc(var(--default-grid-baseline, 4px) * 3);
  background-color: var(--color-main-background);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-large);
  color: var(--color-main-text);
}

.momentum-ai-status-strip__icon {
  color: var(--color-primary-element);
  flex-shrink: 0;
}

.momentum-ai-status-strip__message {
  flex-shrink: 0;
}

.momentum-ai-status-strip__count {
  color: var(--color-text-maxcontrast);
  flex-shrink: 0;
}

.momentum-ai-status-strip__dots {
  display: flex;
  gap: calc(var(--default-grid-baseline, 4px) / 2);
}

.momentum-ai-status-strip__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--color-primary-element);
  animation-name: momentum-ai-status-strip-pulse;
  animation-duration: 1.4s;
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
}

.momentum-ai-status-strip__dot:nth-child(2) {
  animation-delay: 0.2s;
}

.momentum-ai-status-strip__dot:nth-child(3) {
  animation-delay: 0.4s;
}

/* M164.1: static equivalent, not a removal — the dots stay visible at full
   opacity so a reduced-motion user can still tell the strip is "still
   working", the one thing this component exists to signal. */
.momentum-ai-status-strip__dots--reduced-motion .momentum-ai-status-strip__dot {
  animation-name: none;
  opacity: 1;
}

@keyframes momentum-ai-status-strip-pulse {
  0%,
  80%,
  100% {
    opacity: 0.3;
  }
  40% {
    opacity: 1;
  }
}
</style>
