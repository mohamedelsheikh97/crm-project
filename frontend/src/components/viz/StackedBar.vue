<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * Part-to-whole (Phase 10, research D7).
 *
 * HORIZONTAL, for the same reason as BarChart: status names are long. And
 * horizontal is the recommended orientation for a stacked bar with many or
 * long-named categories regardless.
 *
 * CATEGORICAL COLOUR IN FIXED ORDER, NEVER CYCLED. Four slots. A fifth segment
 * folds into "Other" rather than getting a generated hue — a generated ninth
 * hue is indistinguishable from an existing one under colour-vision deficiency
 * and breaks every check the palette passed.
 *
 * A 2px surface gap between segments, so adjacent fills never read as one.
 */
const props = defineProps<{
  segments: Array<{ label: string; value: number }>;
}>();

const { n } = useI18n();

const SLOTS = [
  'var(--viz-series-1)',
  'var(--viz-series-2)',
  'var(--viz-series-3)',
  'var(--viz-series-4)',
] as const;

const total = computed(() => props.segments.reduce((sum, s) => sum + s.value, 0));

/**
 * Folds a fifth-and-beyond segment into "Other" (research D7's series ladder).
 * Colour follows the ENTITY, never its rank, so the fold is by declared order
 * rather than by size — a filter that changes the counts must not repaint the
 * survivors.
 */
const shown = computed(() => {
  if (props.segments.length <= 4) return props.segments;

  const head = props.segments.slice(0, 3);
  const tail = props.segments.slice(3);

  return [...head, { label: 'other', value: tail.reduce((sum, s) => sum + s.value, 0) }];
});
</script>

<template>
  <div class="stacked-bar">
    <div class="stacked-bar__track" role="img">
      <span
        v-for="(segment, index) in shown"
        :key="segment.label"
        class="stacked-bar__segment"
        :style="{
          inlineSize: total > 0 ? `${(segment.value / total) * 100}%` : '0%',
          background: SLOTS[index % SLOTS.length],
        }"
      ></span>
    </div>

    <!-- A legend is ALWAYS present for two or more series, and with four or
         fewer they are direct-labelled too — so identity is never colour
         alone. -->
    <ul class="stacked-bar__legend">
      <li v-for="(segment, index) in shown" :key="segment.label" class="stacked-bar__key">
        <span
          class="stacked-bar__swatch"
          :style="{ background: SLOTS[index % SLOTS.length] }"
          aria-hidden="true"
        ></span>
        {{ segment.label }} — {{ n(segment.value) }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.stacked-bar {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.stacked-bar__track {
  display: flex;
  /* The 2px surface gap between fills. */
  gap: 2px;
  block-size: 1rem;
  background: var(--viz-grid, #f3f4f6);
  border-radius: 2px;
  overflow: hidden;
}

.stacked-bar__segment {
  display: block;
  block-size: 100%;
}

.stacked-bar__legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.75rem;
  font-size: 0.75rem;
  color: var(--viz-text-secondary, #52514e);
}

.stacked-bar__key {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.stacked-bar__swatch {
  inline-size: 0.625rem;
  block-size: 0.625rem;
  border-radius: 2px;
  /* A 2px surface ring, so a swatch on a tinted row still reads as separate. */
  box-shadow: 0 0 0 2px var(--viz-surface, #fcfcfb);
}
</style>
