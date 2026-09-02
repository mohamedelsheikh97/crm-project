<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import ExportMenu from '../../components/reports/ExportMenu.vue';
import PeriodFilter from '../../components/reports/PeriodFilter.vue';
import BarChart from '../../components/viz/BarChart.vue';
import FigureFrame from '../../components/viz/FigureFrame.vue';
import LineChart from '../../components/viz/LineChart.vue';
import RatioMeter from '../../components/viz/RatioMeter.vue';
import { request } from '../../services/http';
import type { FigureEnvelope } from '../../services/reports.service';
import { useReportsStore } from '../../stores/reports.store';

/**
 * SLA performance (Phase 10, US2).
 *
 * TWO METERS, NEVER ONE. Response and resolution are separate promises
 * (FR-020), and a screen that showed a single "SLA compliance" figure would be
 * averaging two different targets into a number that describes neither.
 *
 * DRILL-THROUGH ON EVERY FIGURE (FR-001, User Story 2 scenario 4). A compliance
 * rate a supervisor cannot open is a rate they cannot check — and somebody will
 * ask them to.
 */
interface SlaReport {
  responseCompliance: FigureEnvelope<number | null>;
  resolutionCompliance: FigureEnvelope<number | null>;
  byPolicy: FigureEnvelope<
    Array<{ policyId: number; count: number; response: number | null; resolution: number | null }>
  >;
  byPriority: FigureEnvelope<
    Array<{ priority: string; count: number; response: number | null; resolution: number | null }>
  >;
  overTime: FigureEnvelope<
    Array<{ bucket: string; response: number | null; resolution: number | null }>
  >;
}

const { t, n } = useI18n();
const store = useReportsStore();
const router = useRouter();

const report = ref<SlaReport | null>(null);
const noData = ref(false);
const loading = ref(true);
const failed = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  failed.value = false;

  try {
    const params = new URLSearchParams({ from: store.from, to: store.to });
    const response = await request<SlaReport & { noData?: boolean }>(`/reports/sla?${params}`);

    noData.value = Boolean(response.noData);
    report.value = response.noData ? null : response;
  } catch {
    failed.value = true;
    report.value = null;
  } finally {
    loading.value = false;
  }
}

/**
 * The compliance target the meters are measured against.
 *
 * Not configurable in this phase and not read from a policy: a policy sets a
 * per-ticket TIME target, not an organisational compliance percentage, and
 * inventing one in the reporting layer would be this phase deciding something
 * that belongs to operations. Shown as a reference line only.
 */
const TARGET = 0.9;

const priorityRows = computed(() =>
  (report.value?.byPriority.value ?? []).map((row) => ({
    label: t(`ticket.priority.${row.priority}`),
    value: row.count,
  })),
);

const responseOverTime = computed(() =>
  (report.value?.overTime.value ?? [])
    .filter((row) => row.response !== null)
    .map((row) => ({ bucket: row.bucket, count: Math.round((row.response ?? 0) * 100) })),
);

function openTickets(): void {
  /**
   * Drill-through: the tickets the figure counted, IN THE PERIOD IT COUNTED
   * THEM (FR-001).
   *
   * The period travels in the query. Without it the link lands on an
   * unfiltered queue whose count disagrees with the figure it came from — and
   * that is worse than no link at all, because it looks like a check and
   * quietly fails one.
   */
  void router.push({
    name: 'ticket-list',
    query: { createdFrom: store.from, createdTo: store.to },
  });
}

function onPeriodChange(from: string, to: string): void {
  store.setPeriod(from, to);
  void load();
}

onMounted(load);
</script>

<template>
  <section class="sla">
    <header class="sla__head">
      <h1 class="sla__title">{{ t('reports.sla.title') }}</h1>
      <PeriodFilter :from="store.from" :to="store.to" :busy="loading" @change="onPeriodChange" />

      <!-- The export reads the SAME period the reader is looking at, from the
           store, so a file can never carry filters the screen did not show
           (FR-047). -->
      <ExportMenu :report="'sla'" :query="{ from: store.from, to: store.to }" />
    </header>

    <p v-if="loading" role="status">{{ t('reports.dashboard.loading') }}</p>
    <p v-else-if="failed" role="alert">{{ t('reports.dashboard.unavailable') }}</p>
    <p v-else-if="noData" class="sla__empty">{{ t('reports.noData') }}</p>

    <template v-else-if="report">
      <div class="sla__meters">
        <FigureFrame :title="t('reports.sla.response')" :figure="report.responseCompliance">
          <RatioMeter
            :value="report.responseCompliance.value"
            :target="TARGET"
            :label="t('reports.sla.response')"
            :suppressed-note="report.responseCompliance.suppressed ? t('reports.sla.tooFew') : null"
          />
        </FigureFrame>

        <FigureFrame :title="t('reports.sla.resolution')" :figure="report.resolutionCompliance">
          <RatioMeter
            :value="report.resolutionCompliance.value"
            :target="TARGET"
            :label="t('reports.sla.resolution')"
            :suppressed-note="
              report.resolutionCompliance.suppressed ? t('reports.sla.tooFew') : null
            "
          />
        </FigureFrame>
      </div>

      <p class="sla__drill">
        <button type="button" class="sla__link" @click="openTickets">
          {{ t('reports.sla.drillThrough') }}
        </button>
      </p>

      <!-- No average elapsed time here, deliberately. Research D3: it cannot be
           aggregated in SQL, and the wall-clock approximation would disagree
           with every SLA target in the system while looking plausible. -->
      <p class="sla__note">{{ t('reports.sla.noAverage') }}</p>

      <FigureFrame
        :title="t('reports.sla.overTime')"
        :figure="report.overTime"
        :table-rows="report.overTime.value"
        :table-columns="['bucket', 'response', 'resolution']"
      >
        <LineChart :rows="responseOverTime" :value-label="t('reports.sla.responsePercent')" />
      </FigureFrame>

      <FigureFrame
        :title="t('reports.sla.byPriority')"
        :figure="report.byPriority"
        :table-rows="report.byPriority.value"
        :table-columns="['priority', 'count', 'response', 'resolution']"
      >
        <BarChart :rows="priorityRows" :value-label="t('reports.column.count')" />
      </FigureFrame>

      <FigureFrame
        :title="t('reports.sla.byPolicy')"
        :figure="report.byPolicy"
        :table-rows="report.byPolicy.value"
        :table-columns="['policyId', 'count', 'response', 'resolution']"
      >
        <p class="sla__note">
          {{ t('reports.sla.policyTable', { n: n(report.byPolicy.value.length) }) }}
        </p>
      </FigureFrame>
    </template>
  </section>
</template>

<style scoped>
.sla {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.sla__head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
  justify-content: space-between;
}

.sla__title {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0;
}

.sla__meters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  gap: 1rem;
}

.sla__empty,
.sla__note,
.sla__drill {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--viz-text-secondary, #52514e);
}

.sla__link {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-size: 0.8125rem;
  color: #1d4ed8;
  cursor: pointer;
  text-align: start;
}
</style>
