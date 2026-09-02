<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * Trend over time (Phase 10, research D7).
 *
 * INLINE SVG, one series, 2px stroke. A single series needs no legend — the
 * figure title names it — so there is none, per the palette rules.
 *
 * NEVER A SECOND Y-AXIS. Two measures of different scale go in two charts or are
 * indexed to a common base. A dual-axis chart makes any apparent relationship
 * between the lines an artefact of the scales chosen, and it is the single most
 * common reporting mistake.
 *
 * The crosshair and tooltip are shipped by default: an SVG chart in a browser IS
 * interactive, and a reader should be able to get an exact value without
 * measuring against an axis.
 */
const props = defineProps<{
  rows: Array<{ bucket: string; count: number }>;
  valueLabel: string;
}>();

const { n } = useI18n();

const W = 600;
const H = 160;
const PAD = 8;

const max = computed(() => Math.max(1, ...props.rows.map((r) => r.count)));

const points = computed(() =>
  props.rows.map((row, index) => {
    const span = Math.max(1, props.rows.length - 1);
    return {
      ...row,
      x: PAD + (index / span) * (W - PAD * 2),
      y: H - PAD - (row.count / max.value) * (H - PAD * 2),
    };
  }),
);

const path = computed(() =>
  points.value.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
);

const hovered = ref<number | null>(null);
</script>

<template>
  <div class="line-chart">
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      class="line-chart__svg"
      role="img"
      :aria-label="valueLabel"
      preserveAspectRatio="none"
      @mouseleave="hovered = null"
    >
      <!-- Recessive grid: a baseline only, so the marks carry the meaning. -->
      <line :x1="PAD" :y1="H - PAD" :x2="W - PAD" :y2="H - PAD" class="line-chart__axis" />

      <path :d="path" class="line-chart__line" />

      <!-- Markers at >= 8px so they are hittable, with a 2px surface ring so an
           overlapping point still reads as separate. -->
      <circle
        v-for="(point, index) in points"
        :key="point.bucket"
        :cx="point.x"
        :cy="point.y"
        :r="hovered === index ? 5 : 4"
        class="line-chart__marker"
        @mouseenter="hovered = index"
      />
    </svg>

    <p v-if="hovered !== null" class="line-chart__tooltip" role="status">
      {{ points[hovered].bucket }} — {{ n(points[hovered].count) }}
    </p>
    <p v-else class="line-chart__axis-label">{{ valueLabel }}</p>
  </div>
</template>

<style scoped>
.line-chart__svg {
  inline-size: 100%;
  block-size: 10rem;
  /* An SVG has no inherent direction, which is the whole reason this project
     draws its own charts (see the viz README). The series reads left-to-right
     as a time axis in both locales — time is not mirrored by RTL. */
  direction: ltr;
}

.line-chart__line {
  fill: none;
  stroke: var(--viz-series-1, #2a78d6);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.line-chart__marker {
  fill: var(--viz-series-1, #2a78d6);
  stroke: var(--viz-surface, #fcfcfb);
  stroke-width: 2;
}

.line-chart__axis {
  stroke: var(--viz-grid, #e5e7eb);
  stroke-width: 1;
}

.line-chart__tooltip,
.line-chart__axis-label {
  margin: 0.25rem 0 0;
  font-size: 0.6875rem;
  color: var(--viz-text-muted, #6b7280);
  font-variant-numeric: tabular-nums;
  min-height: 1rem;
}
</style>
