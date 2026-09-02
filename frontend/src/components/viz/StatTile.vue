<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * A single headline number (Phase 10, research D7).
 *
 * NOT A ONE-BAR BAR CHART. A stat tile is the form for a single current value,
 * and a handful of them is a KPI row — not a grouped bar chart of four numbers.
 * Reaching for a chart here is the commonest way a dashboard becomes harder to
 * read than the numbers it contains.
 *
 * `delta` is optional and, when present, uses the STATUS palette rather than a
 * series colour — with a label, never colour alone.
 */
const props = defineProps<{
  label: string;
  value: number | null;
  /** Change against the previous comparable period, as a signed number. */
  delta?: number | null;
  /** Whether a rise is good. Determines which status colour a delta wears. */
  riseIsGood?: boolean;
  /** Shown instead of the value when the sample cannot support one. */
  suppressedNote?: string | null;
  /**
   * The sample the value rests on, shown BESIDE it (FR-005, FR-029).
   *
   * Not a tooltip and not a hover. "4.2" reads identically over six responses
   * and six hundred; the count is what separates a statistic from a
   * coincidence, and a reader who has to hover for it will not.
   */
  caption?: string | null;
  /** Decimal places, where the scale supports fewer than the default. */
  fractionDigits?: number;
}>();

const { n } = useI18n();

/**
 * Through `vue-i18n`, always — an Arabic screen wants Arabic-Indic digits, and
 * `String(n)` is the easiest place in a codebase to leave Latin ones.
 */
const formatted = computed(() => {
  if (props.value === null) return '—';

  return props.fractionDigits === undefined
    ? n(props.value)
    : n(props.value, {
        minimumFractionDigits: props.fractionDigits,
        maximumFractionDigits: props.fractionDigits,
      });
});

const deltaTone = computed(() => {
  if (props.delta === null || props.delta === undefined || props.delta === 0) return 'flat';
  const rising = props.delta > 0;
  return rising === (props.riseIsGood ?? true) ? 'good' : 'bad';
});
</script>

<template>
  <div class="viz-root stat-tile">
    <p class="stat-tile__label">{{ label }}</p>

    <p v-if="suppressedNote" class="stat-tile__suppressed">{{ suppressedNote }}</p>

    <p v-else class="stat-tile__value">{{ value === null ? '—' : formatted }}</p>

    <p v-if="caption" class="stat-tile__caption">{{ caption }}</p>

    <p
      v-if="delta !== null && delta !== undefined"
      class="stat-tile__delta"
      :class="`stat-tile__delta--${deltaTone}`"
    >
      <!-- The arrow is a LABEL, not decoration: a status colour never carries
           meaning alone. -->
      <span aria-hidden="true">{{ delta > 0 ? '▲' : delta < 0 ? '▼' : '■' }}</span>
      {{ n(Math.abs(delta)) }}
    </p>
  </div>
</template>

<style scoped>
.stat-tile__caption {
  margin: 0.125rem 0 0;
  font-size: 0.75rem;
  color: var(--viz-text-secondary, #52514e);
}

.stat-tile {
  padding: 0.75rem;
  border: 1px solid var(--viz-grid, #e5e7eb);
  border-radius: 0.5rem;
  background: var(--viz-surface, #fcfcfb);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.stat-tile__label {
  margin: 0;
  font-size: 0.75rem;
  color: var(--viz-text-secondary, #52514e);
}

.stat-tile__value {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 600;
  line-height: 1.1;
  color: var(--viz-text-primary, #0b0b0b);
  /* Tabular figures so a refreshing number does not shift the layout. */
  font-variant-numeric: tabular-nums;
}

.stat-tile__suppressed {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--viz-text-muted, #6b7280);
}

.stat-tile__delta {
  margin: 0;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

.stat-tile__delta--good {
  color: var(--viz-status-good, #0ca30c);
}

.stat-tile__delta--bad {
  color: var(--viz-status-critical, #d03b3b);
}

.stat-tile__delta--flat {
  color: var(--viz-text-muted, #6b7280);
}
</style>
