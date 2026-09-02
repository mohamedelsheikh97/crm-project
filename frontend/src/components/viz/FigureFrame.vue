<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import FigureTable from './FigureTable.vue';

/**
 * Renders a figure WITH its provenance (Phase 10, contracts/figure-contract.md).
 *
 * ONE COMPONENT, so provenance appears on every surface without each surface
 * remembering to show it. Six honesty requirements are discharged here rather
 * than in five report views:
 *
 *   FR-005  the counts beside the value, never a bare percentage
 *   FR-004  exclusions, translated, with their counts
 *   FR-006  a suppressed figure shows its count and withholds the rate
 *   FR-003  the period, timezone and filters that produced it
 *   FR-043  when it was last SUCCESSFULLY computed
 *   FR-011a that it reflects current record state
 *
 * A REPORT SCREEN THAT RENDERS A FIGURE WITHOUT THIS COMPONENT is how the
 * contract gets bypassed, and it is the review question for any new report view.
 */
export interface FigureEnvelope {
  value: unknown;
  count: number;
  total: number;
  excluded: Array<{ reason: string; count: number }>;
  suppressed: boolean;
  period: { from: string; to: string; timeZone: string };
  filters: Record<string, string | number | null>;
  computedAt: string;
  reflectsCurrentState: boolean;
}

const props = defineProps<{
  title: string;
  figure: FigureEnvelope;
  /** Rows for the table view. Every chart supplies them. */
  tableRows?: Array<Record<string, string | number | null>>;
  tableColumns?: string[];
}>();

const { t, d, n } = useI18n();

const showTable = ref(false);

const activeFilters = computed(() =>
  Object.entries(props.figure.filters).filter(([, value]) => value !== null && value !== ''),
);

const hasChart = computed(() => (props.tableRows?.length ?? 0) > 0);
</script>

<template>
  <figure class="viz-root figure-frame" data-figure>
    <figcaption class="figure-frame__head">
      <h3 class="figure-frame__title">{{ title }}</h3>

      <button
        v-if="hasChart"
        type="button"
        class="figure-frame__toggle"
        :aria-pressed="showTable"
        @click="showTable = !showTable"
      >
        {{ showTable ? t('reports.figure.showChart') : t('reports.figure.showTable') }}
      </button>
    </figcaption>

    <!-- FR-006: a suppressed figure shows what it counted and withholds the
         rate. Never a rate over a sample that cannot support one. -->
    <p v-if="figure.suppressed" class="figure-frame__suppressed">
      {{ t('reports.figure.suppressed', { count: figure.count }) }}
    </p>

    <div v-else class="figure-frame__body">
      <!--
        BOTH ARE IN THE DOM; the toggle hides one.

        Rendering the table only when the toggle is on would make it
        unreachable in print, and PDF export IS the browser's print pipeline
        (contracts/export-contract.md). `print.css` reveals every
        `[data-figure-table]` so a printed bar chart always carries its
        numbers — which is simultaneously the greyscale fallback and the
        relief the palette's light-mode contrast WARN requires.

        `hidden` rather than `v-if`, because a hidden element is out of the
        accessibility tree but still in the document for the print rule to find.
      -->
      <div :hidden="showTable" data-figure-chart>
        <slot />
      </div>

      <div v-if="tableRows && tableColumns" :hidden="!showTable" data-figure-table>
        <FigureTable :rows="tableRows" :columns="tableColumns" />
      </div>
    </div>

    <!-- FR-005: the counts travel with the value. "94%" reads identically at
         2-of-3 and 6,700-of-10,000; one is a statistic and the other is not. -->
    <p class="figure-frame__counts">
      {{ t('reports.figure.counts', { count: n(figure.count), total: n(figure.total) }) }}
    </p>

    <!-- FR-004: stated, never silent. An exclusion nobody mentioned is what
         makes a complete-looking figure untrue. -->
    <ul v-if="figure.excluded.length > 0" class="figure-frame__excluded">
      <li v-for="entry in figure.excluded" :key="entry.reason">
        {{ t(`reports.excluded.${entry.reason}`, { count: n(entry.count) }) }}
      </li>
    </ul>

    <footer class="figure-frame__provenance" data-provenance>
      <span>
        {{ d(new Date(figure.period.from), 'short') }} –
        {{ d(new Date(figure.period.to), 'short') }}
        ({{ figure.period.timeZone }})
      </span>

      <span v-if="activeFilters.length > 0">
        {{ t('reports.figure.filtered') }}:
        <template v-for="([key, value], index) in activeFilters" :key="key">
          <template v-if="index > 0">, </template>{{ t(`reports.filter.${key}`) }} = {{ value }}
        </template>
      </span>

      <!-- FR-043: the last SUCCESSFUL computation. A stale number beside a
           current-looking clock is worse than no clock. -->
      <span>{{
        t('reports.figure.computedAt', { at: d(new Date(figure.computedAt), 'long') })
      }}</span>

      <!-- FR-011a: Clarifications Q3's disclosure. This is the whole mitigation
           for a figure that moves between two runs. -->
      <span v-if="figure.reflectsCurrentState" class="figure-frame__disclosure">
        {{ t('reports.figure.currentState') }}
      </span>
    </footer>
  </figure>
</template>

<style scoped>
.figure-frame {
  margin: 0;
  padding: 0.75rem;
  border: 1px solid var(--viz-grid, #e5e7eb);
  border-radius: 0.5rem;
  background: var(--viz-surface, #fcfcfb);
  color: var(--viz-text-primary, #0b0b0b);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.figure-frame__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}

.figure-frame__title {
  font-size: 0.9375rem;
  font-weight: 600;
  margin: 0;
}

.figure-frame__toggle {
  min-height: 1.75rem;
  padding-inline: 0.5rem;
  border: 1px solid var(--viz-grid, #d1d5db);
  border-radius: 0.25rem;
  background: none;
  font: inherit;
  font-size: 0.75rem;
  color: var(--viz-text-secondary, #52514e);
  cursor: pointer;
}

.figure-frame__body {
  min-height: 2rem;
}

/* Text wears TEXT tokens, never a series colour. A coloured mark beside a label
   carries identity; the label itself stays in ink. */
.figure-frame__counts {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--viz-text-secondary, #52514e);
}

.figure-frame__suppressed {
  margin: 0;
  padding: 0.5rem;
  border: 1px dashed var(--viz-grid, #d1d5db);
  border-radius: 0.375rem;
  font-size: 0.8125rem;
  color: var(--viz-text-secondary, #52514e);
}

.figure-frame__excluded {
  margin: 0;
  padding-inline-start: 1rem;
  font-size: 0.75rem;
  color: var(--viz-text-secondary, #52514e);
}

.figure-frame__provenance {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  font-size: 0.6875rem;
  color: var(--viz-text-muted, #6b7280);
}

.figure-frame__disclosure {
  font-style: italic;
}

/* The provenance block is always visible in print, so an exported PDF states
   which filters produced it without a separate template (FR-047). */
@media print {
  .figure-frame__toggle {
    display: none;
  }

  .figure-frame__provenance {
    display: block;
  }
}
</style>
