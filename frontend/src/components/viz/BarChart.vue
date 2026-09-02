<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * Compare magnitude (Phase 10, research D7).
 *
 * HORIZONTAL BY DEFAULT, because the things this project compares have long
 * names — "awaiting customer", "technical", "whatsapp" — and vertical columns
 * force those labels to rotate or truncate.
 *
 * SEQUENTIAL, ONE HUE, MORE-IS-DARKER. Not categorical: the job here is
 * comparing sizes, not telling identities apart, and categorical hues would
 * imply the categories are distinct subjects while also burying whichever bar
 * actually matters. Sequential is the safe default and this is why.
 *
 * Marks are thin with a 4px rounded data-end anchored to the baseline, and a 2px
 * surface gap between adjacent bars.
 */
const props = defineProps<{
  rows: Array<{ label: string; value: number }>;
  /** Translated axis title. */
  valueLabel: string;
}>();

const { n } = useI18n();

const max = computed(() => Math.max(1, ...props.rows.map((row) => row.value)));

/** Five sequential steps, darkest for the largest bar. */
function step(value: number): string {
  const share = value / max.value;
  if (share > 0.8) return 'var(--viz-seq-700)';
  if (share > 0.6) return 'var(--viz-seq-550)';
  if (share > 0.4) return 'var(--viz-seq-400)';
  if (share > 0.2) return 'var(--viz-seq-250)';
  return 'var(--viz-seq-100)';
}
</script>

<template>
  <div class="bar-chart">
    <div v-for="row in rows" :key="row.label" class="bar-chart__row">
      <span class="bar-chart__label">{{ row.label }}</span>

      <span class="bar-chart__track">
        <span
          class="bar-chart__fill"
          :style="{ inlineSize: `${(row.value / max) * 100}%`, background: step(row.value) }"
        ></span>
      </span>

      <!-- DIRECT LABELS, mandatory rather than optional: the palette's
           light-mode contrast WARN obligates visible values, and a reader
           should never have to measure a bar against an axis. -->
      <span class="bar-chart__value">{{ n(row.value) }}</span>
    </div>

    <p class="bar-chart__axis">{{ valueLabel }}</p>
  </div>
</template>

<style scoped>
.bar-chart {
  display: flex;
  flex-direction: column;
  /* 2px surface gap between adjacent bars. */
  gap: 2px;
}

.bar-chart__row {
  display: grid;
  grid-template-columns: minmax(5rem, 9rem) 1fr auto;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
}

.bar-chart__label,
.bar-chart__value {
  /* Text wears text tokens, never the series colour. */
  color: var(--viz-text-secondary, #52514e);
}

.bar-chart__value {
  font-variant-numeric: tabular-nums;
}

.bar-chart__track {
  display: block;
  block-size: 0.75rem;
  background: var(--viz-grid, #f3f4f6);
  border-radius: 2px;
}

.bar-chart__fill {
  display: block;
  block-size: 100%;
  /* Rounded data-end only; the baseline end stays square so the bar reads as
     anchored rather than floating. */
  border-start-start-radius: 2px;
  border-end-start-radius: 2px;
  border-start-end-radius: 4px;
  border-end-end-radius: 4px;
  min-inline-size: 2px;
}

.bar-chart__axis {
  margin: 0.25rem 0 0;
  font-size: 0.6875rem;
  color: var(--viz-text-muted, #6b7280);
}
</style>
