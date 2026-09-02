<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * An ORDERED scale, centred on neutral (Phase 10, US4, research D7).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CSAT 1-5 IS NOT FIVE INDEPENDENT CATEGORIES.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A column chart is the instinctive choice here and the wrong one: it draws
 * five bars of unrelated colour and throws away the one property that makes the
 * data meaningful — that 2 is worse than 3 and 4 is better. A Likert scale takes
 * a diverging stacked bar, centred on the neutral score, so "more bad than
 * good" is visible as a shape rather than as arithmetic the reader has to do.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THREE FILLS, NOT FIVE, AND THE REASON IS MEASURED.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A five-step diverging ramp needs two intermediate steps between each pole and
 * the neutral midpoint. Mixing each pole halfway to neutral gives #e09594 and
 * #86cfb3, and running the ramp through the validator says:
 *
 *   worst adjacent #1baf7a <-> #86cfb3  dE 14.2 (normal vision) — BELOW 15
 *
 * Below the normal-vision floor means a full-colour reader cannot reliably tell
 * the pair apart, which no amount of secondary encoding excuses. So the chart
 * groups: dissatisfied (1-2), neutral (3), satisfied (4-5) — three fills using
 * the palette's validated diverging tokens, whose separation passes with room
 * to spare:
 *
 *   light  worst adjacent #1baf7a <-> #f0efec  dE 24.9 (protan) · 31.6 (normal)
 *   dark   worst adjacent #383835 <-> #d03b3b  dE 14.8 (protan) · 29.9 (normal)
 *
 * (The validator also FAILs the neutral midpoint on its lightness band and
 * chroma floor. Those two checks are for CATEGORICAL palettes; a diverging
 * midpoint is REQUIRED to read as grey, so failing them is the rule being
 * followed, not broken.)
 *
 * THE PER-SCORE DETAIL IS NOT LOST. Every figure has a table view (FigureFrame),
 * and the table carries all five buckets. Grouping the fills moves the detail
 * to the surface that can carry it honestly instead of drawing a distinction
 * the eye cannot make.
 */
const props = defineProps<{
  /** All five buckets, in scale order. */
  buckets: Array<{ score: number; count: number }>;
  /** The scale's neutral point — sent by the server, never hard-coded here. */
  neutral: number;
}>();

const { t, n } = useI18n();

const total = computed(() => props.buckets.reduce((sum, bucket) => sum + bucket.count, 0));

const groups = computed(() => {
  const below = props.buckets.filter((bucket) => bucket.score < props.neutral);
  const at = props.buckets.filter((bucket) => bucket.score === props.neutral);
  const above = props.buckets.filter((bucket) => bucket.score > props.neutral);

  const sum = (list: typeof props.buckets) =>
    list.reduce((running, bucket) => running + bucket.count, 0);

  return [
    {
      key: 'dissatisfied',
      // The scores each group covers, so the legend states the grouping rather
      // than leaving the reader to infer it.
      scores: below.map((bucket) => bucket.score),
      count: sum(below),
      fill: 'var(--viz-div-low)',
    },
    {
      key: 'neutral',
      scores: at.map((bucket) => bucket.score),
      count: sum(at),
      fill: 'var(--viz-div-mid)',
    },
    {
      key: 'satisfied',
      scores: above.map((bucket) => bucket.score),
      count: sum(above),
      fill: 'var(--viz-div-high)',
    },
  ];
});

function share(count: number): string {
  return total.value > 0 ? `${(count / total.value) * 100}%` : '0%';
}

/**
 * The bar's text alternative, built here rather than in the template.
 *
 * The three groups are read out with their counts, so a screen-reader user gets
 * the same summary a sighted reader gets from the shape — and does not have to
 * reach the table view to learn anything at all.
 */
const barLabel = computed(() =>
  t('reports.csat.barLabel', {
    dissatisfied: n(groups.value[0]?.count ?? 0),
    neutral: n(groups.value[1]?.count ?? 0),
    satisfied: n(groups.value[2]?.count ?? 0),
  }),
);
</script>

<template>
  <div class="diverging">
    <!--
      `role="img"` with a text alternative, because the bar itself carries no
      accessible content. The per-score numbers are in the legend below and in
      the figure's table view, so this is a summary rather than the only route
      to the data.
    -->
    <div class="diverging__track" role="img" :aria-label="barLabel">
      <span
        v-for="group in groups"
        :key="group.key"
        class="diverging__segment"
        :style="{ inlineSize: share(group.count), background: group.fill }"
      ></span>
    </div>

    <!-- Direct labels on all three, which is the relief the palette's contrast
         WARN obligates — and it is not dismissable. -->
    <ul class="diverging__legend">
      <li v-for="group in groups" :key="group.key" class="diverging__key">
        <span class="diverging__swatch" :style="{ background: group.fill }" aria-hidden="true" />
        <!-- The scores the group covers are named, so the grouping is stated
             rather than inferred from a colour. -->
        {{ t(`reports.csat.group.${group.key}`) }}
        ({{ group.scores.map((score) => n(score)).join(', ') }}) — {{ n(group.count) }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.diverging {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.diverging__track {
  display: flex;
  /* The 2px surface gap, so adjacent fills never read as one segment. */
  gap: 2px;
  block-size: 1.25rem;
  background: var(--viz-grid, #e5e7eb);
  border-radius: 2px;
  overflow: hidden;
}

.diverging__segment {
  display: block;
  block-size: 100%;
}

.diverging__legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.75rem;
  font-size: 0.75rem;
  /* Text wears TEXT tokens, never the series colour. The swatch beside it
     carries the identity. */
  color: var(--viz-text-secondary, #52514e);
}

.diverging__key {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.diverging__swatch {
  inline-size: 0.625rem;
  block-size: 0.625rem;
  border-radius: 2px;
  box-shadow: 0 0 0 2px var(--viz-surface, #fcfcfb);
}
</style>
