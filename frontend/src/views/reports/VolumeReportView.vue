<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import ExportMenu from '../../components/reports/ExportMenu.vue';
import PeriodFilter from '../../components/reports/PeriodFilter.vue';
import BarChart from '../../components/viz/BarChart.vue';
import FigureFrame from '../../components/viz/FigureFrame.vue';
import KpiRow from '../../components/viz/KpiRow.vue';
import LineChart from '../../components/viz/LineChart.vue';
import StackedBar from '../../components/viz/StackedBar.vue';
import StatTile from '../../components/viz/StatTile.vue';
import * as reportsService from '../../services/reports.service';
import type { VolumeReport } from '../../services/reports.service';
import { useReportsStore } from '../../stores/reports.store';

/**
 * The volume report (Phase 10, US1).
 *
 * The drill-down counterpart to the dashboard's summary tiles. No auto-refresh
 * here: a reader who navigated to a specific report is reading it, not watching
 * it, and a figure changing under them mid-read would be worse than stale.
 */
const { t } = useI18n();
const router = useRouter();
const store = useReportsStore();

const report = ref<VolumeReport | null>(null);
const noData = ref(false);
const loading = ref(true);
const failed = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  failed.value = false;

  try {
    const response = await reportsService.volume({ from: store.from, to: store.to });
    noData.value = Boolean((response as unknown as { noData?: boolean }).noData);
    report.value = noData.value ? null : response;
  } catch {
    failed.value = true;
    report.value = null;
  } finally {
    loading.value = false;
  }
}

const statusSegments = computed(() =>
  (report.value?.byStatus.value ?? [])
    .filter((row) => row.count > 0)
    .map((row) => ({ label: t(`ticket.status.${row.status}`), value: row.count })),
);

const categoryRows = computed(() =>
  (report.value?.byCategory.value ?? []).map((row) => ({
    label: t(`ticket.category.${row.category}`),
    value: row.count,
  })),
);

const channelRows = computed(() =>
  (report.value?.byChannel.value ?? [])
    .filter((row) => row.count > 0)
    .map((row) => ({ label: row.channel, value: row.count })),
);

/**
 * Drill-through to the tickets a figure counted (FR-001).
 *
 * The period always travels; a category is added when the reader clicked one,
 * so the queue they land on is the population behind the bar rather than the
 * whole month.
 */
function openTickets(category?: string): void {
  void router.push({
    name: 'ticket-list',
    query: {
      createdFrom: store.from,
      createdTo: store.to,
      ...(category ? { category } : {}),
    },
  });
}

function onPeriodChange(from: string, to: string): void {
  store.setPeriod(from, to);
  void load();
}

onMounted(load);
</script>

<template>
  <section class="volume">
    <header class="volume__head">
      <h1 class="volume__title">{{ t('reports.volume.title') }}</h1>
      <PeriodFilter :from="store.from" :to="store.to" :busy="loading" @change="onPeriodChange" />
      <!-- The export reads the SAME period the reader is looking at, from the
           store, so a file can never carry filters the screen did not show
           (FR-047). -->
      <ExportMenu :report="'volume'" :query="{ from: store.from, to: store.to }" />
    </header>

    <p v-if="loading" role="status">{{ t('reports.dashboard.loading') }}</p>
    <p v-else-if="failed" role="alert">{{ t('reports.dashboard.unavailable') }}</p>
    <p v-else-if="noData" class="volume__empty">{{ t('reports.noData') }}</p>

    <template v-else-if="report">
      <KpiRow>
        <StatTile :label="t('reports.volume.received')" :value="report.received.value" />
        <StatTile
          :label="t('reports.volume.openAtEnd')"
          :value="report.openAtEnd.value"
          :rise-is-good="false"
        />
      </KpiRow>

      <FigureFrame
        :title="t('reports.volume.overTime')"
        :figure="report.overTime"
        :table-rows="report.overTime.value"
        :table-columns="['bucket', 'count']"
      >
        <LineChart :rows="report.overTime.value" :value-label="t('reports.volume.received')" />
      </FigureFrame>

      <FigureFrame
        :title="t('reports.volume.byStatus')"
        :figure="report.byStatus"
        :table-rows="report.byStatus.value"
        :table-columns="['status', 'count']"
      >
        <StackedBar :segments="statusSegments" />
      </FigureFrame>

      <FigureFrame
        :title="t('reports.volume.byCategory')"
        :figure="report.byCategory"
        :table-rows="report.byCategory.value"
        :table-columns="['category', 'count']"
      >
        <BarChart :rows="categoryRows" :value-label="t('reports.column.count')" />
      </FigureFrame>

      <FigureFrame
        :title="t('reports.volume.byChannel')"
        :figure="report.byChannel"
        :table-rows="report.byChannel.value"
        :table-columns="['channel', 'count']"
      >
        <BarChart :rows="channelRows" :value-label="t('reports.column.count')" />
      </FigureFrame>
      <!-- FR-001: every figure reaches the records behind it, in one step and
           without a query written. -->
      <p class="volume__drill">
        <button type="button" class="volume__link" @click="openTickets()">
          {{ t('reports.volume.drillThrough') }}
        </button>
      </p>
    </template>
  </section>
</template>

<style scoped>
.volume {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.volume__head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
  justify-content: space-between;
}

.volume__title {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0;
}

.volume__drill {
  margin: 0;
}

.volume__link {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  color: var(--viz-series-1, #2a78d6);
  text-decoration: underline;
  cursor: pointer;
}

.volume__empty {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--viz-text-secondary, #52514e);
}
</style>
