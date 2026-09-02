<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import ExportMenu from '../../components/reports/ExportMenu.vue';
import PeriodFilter from '../../components/reports/PeriodFilter.vue';
import DivergingStackedBar from '../../components/viz/DivergingStackedBar.vue';
import FigureFrame from '../../components/viz/FigureFrame.vue';
import KpiRow from '../../components/viz/KpiRow.vue';
import StatTile from '../../components/viz/StatTile.vue';
import { request } from '../../services/http';
import type { FigureEnvelope } from '../../services/reports.service';
import { useReportsStore } from '../../stores/reports.store';

/**
 * The satisfaction report (Phase 10, US4).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SAMPLE SIZE IS BESIDE EVERY AVERAGE (FR-029). NOT IN A TOOLTIP.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "4.2" reads identically over six responses and six hundred, and a manager
 * acting on the first is acting on noise. Below the floor the server withholds
 * the average entirely and `FigureFrame` renders the count instead; above it the
 * count still travels alongside. Neither behaviour is this view's decision —
 * both come from the envelope, which is what stops one surface being honest and
 * another not.
 */
interface CsatResponse {
  noData?: boolean;
  scale: number[];
  neutral: number;
  distribution: FigureEnvelope<Array<{ score: number; count: number }>>;
  average: FigureEnvelope<number | null>;
  responseRate: FigureEnvelope<number | null>;
  comments: FigureEnvelope<
    Array<{ ticketReference: string; score: number; comment: string; submittedAt: string }>
  >;
}

const { t, n, d } = useI18n();
const store = useReportsStore();

const report = ref<CsatResponse | null>(null);
const noData = ref(false);
const loading = ref(true);
const failed = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  failed.value = false;

  try {
    const response = await request<CsatResponse>(`/reports/csat?from=${store.from}&to=${store.to}`);

    noData.value = Boolean(response.noData);
    report.value = noData.value ? null : response;
  } catch {
    failed.value = true;
    report.value = null;
  } finally {
    loading.value = false;
  }
}

/**
 * A rate as a PERCENTAGE, or nothing at all.
 *
 * `null` is not zero. "0%" is a claim — nobody responded favourably — and
 * "we cannot say from this sample" is an absence. Rendering them the same way is
 * this phase's hazard in miniature, so the withheld case goes through
 * `suppressedNote` and never through the value.
 */
const ratePercent = computed(() => {
  const value = report.value?.responseRate.value;

  return value === null || value === undefined ? null : value * 100;
});

const averageValue = computed(() => report.value?.average.value ?? null);

const distributionRows = computed(() =>
  (report.value?.distribution.value ?? []).map((bucket) => ({
    score: bucket.score,
    count: bucket.count,
  })),
);

function onPeriodChange(from: string, to: string): void {
  store.setPeriod(from, to);
  void load();
}

onMounted(load);
</script>

<template>
  <section class="csat">
    <header class="csat__head">
      <h1 class="csat__title">{{ t('reports.csat.title') }}</h1>
      <PeriodFilter :from="store.from" :to="store.to" :busy="loading" @change="onPeriodChange" />
      <ExportMenu :report="'csat'" :query="{ from: store.from, to: store.to }" />
    </header>

    <p v-if="loading" role="status">{{ t('reports.dashboard.loading') }}</p>
    <p v-else-if="failed" role="alert">{{ t('reports.dashboard.unavailable') }}</p>
    <p v-else-if="noData" class="csat__empty">{{ t('reports.noData') }}</p>

    <template v-else-if="report">
      <KpiRow>
        <!-- The count is in the label, not hidden behind the number: it is the
             difference between a statistic and a coincidence. -->
        <StatTile
          :label="t('reports.csat.average')"
          :value="averageValue"
          :fraction-digits="1"
          :suppressed-note="report.average.suppressed ? t('reports.figure.withheld') : null"
          :caption="t('reports.csat.responses', { count: n(report.average.count) })"
        />
        <StatTile
          :label="t('reports.csat.responseRate')"
          :value="ratePercent"
          :fraction-digits="0"
          :suppressed-note="report.responseRate.suppressed ? t('reports.figure.withheld') : null"
          :caption="
            t('reports.csat.rateBasis', {
              responses: n(report.responseRate.count),
              rateable: n(report.responseRate.total),
            })
          "
        />
      </KpiRow>

      <FigureFrame
        :title="t('reports.csat.distribution')"
        :figure="report.distribution"
        :table-rows="distributionRows"
        :table-columns="['score', 'count']"
      >
        <DivergingStackedBar :buckets="distributionRows" :neutral="report.neutral" />

        <!-- The grouping is STATED, not left to be inferred from three fills
             where the data has five buckets. The reason it is grouped is in
             DivergingStackedBar; the fact that it is belongs on screen. -->
        <p class="csat__grouped">{{ t('reports.csat.grouped') }}</p>
      </FigureFrame>

      <!--
        COMMENTS ARE CUSTOMER-AUTHORED TEXT, rendered as text.

        Interpolated by Vue, so it is escaped — never `v-html`. And keyed by the
        ticket REFERENCE (FR-028), which is what a reader can act on; an internal
        id would be an enumeration and useless to them besides.
      -->
      <section v-if="report.comments.value.length > 0" class="csat__comments">
        <h2 class="csat__comments-title">
          {{ t('reports.csat.comments', { count: n(report.comments.count) }) }}
        </h2>

        <ul class="csat__comment-list">
          <li
            v-for="entry in report.comments.value"
            :key="entry.ticketReference"
            class="csat__comment"
          >
            <p class="csat__comment-meta">
              <router-link :to="`/tickets?q=${entry.ticketReference}`">
                {{ entry.ticketReference }}
              </router-link>
              — {{ t('reports.csat.score', { score: n(entry.score) }) }} ·
              {{ d(new Date(entry.submittedAt), 'short') }}
            </p>
            <p class="csat__comment-text">{{ entry.comment }}</p>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<style scoped>
.csat {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.csat__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem 1.5rem;
}

.csat__title {
  margin: 0;
  font-size: 1.25rem;
  margin-inline-end: auto;
}

.csat__comments {
  border: 1px solid var(--viz-grid, #e5e7eb);
  border-radius: 0.5rem;
  padding: 0.75rem;
}

.csat__comments-title {
  margin: 0 0 0.5rem;
  font-size: 0.9375rem;
}

.csat__comment-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.csat__comment-meta {
  margin: 0;
  font-size: 0.75rem;
  color: var(--viz-text-secondary, #52514e);
}

.csat__comment-text {
  margin: 0.125rem 0 0;
  font-size: 0.875rem;
  /* Customer text can be long and can be a single unbroken string. */
  overflow-wrap: anywhere;
}

.csat__grouped {
  margin: 0.5rem 0 0;
  font-size: 0.75rem;
  color: var(--viz-text-secondary, #52514e);
}

.csat__empty {
  color: var(--viz-text-secondary, #52514e);
}
</style>
