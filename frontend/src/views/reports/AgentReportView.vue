<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import ExportMenu from '../../components/reports/ExportMenu.vue';
import PeriodFilter from '../../components/reports/PeriodFilter.vue';
import BarChart from '../../components/viz/BarChart.vue';
import FigureFrame from '../../components/viz/FigureFrame.vue';
import { ApiError, request } from '../../services/http';
import type { FigureEnvelope } from '../../services/reports.service';
import { useReportsStore } from '../../stores/reports.store';

/**
 * Agent performance (Phase 10, US5).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ATTRIBUTION RULE IS ON THE PAGE, NOT IN A TOOLTIP (FR-031, T087).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A supervisor reading these figures needs to know what they mean, and the
 * agent they describe cannot ask — Clarifications Q1 put the report out of their
 * reach. A rule behind a hover is a rule most readers never see, and the one
 * misreading that matters here ("tickets they worked on" versus "tickets they
 * hold now") is invisible without it. So it is a paragraph above the figures,
 * rendered from the field the server sends.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A TABLE PAST ROUGHLY SEVEN AGENTS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Beyond that a chart needs more colours than can be distinguished, and the
 * honest form is the one that scales (research D7). Below it, horizontal
 * sequential bars — sequential rather than categorical because agent volume is
 * a magnitude, and giving each agent an identity colour would invite reading the
 * chart as a league table.
 */
interface AgentRow {
  agentId: number;
  name: string;
  active: boolean;
  activeFrom: string;
  activeTo: null;
  assigned: number;
  settled: number;
  settledRate: number | null;
  responseCompliance: number | null;
  resolutionCompliance: number | null;
  suppressed: boolean;
}

interface AgentResponse {
  noData?: boolean;
  attributionRule: { key: string; countsOnce: boolean };
  agents: FigureEnvelope<AgentRow[]>;
}

/** Past this many agents the chart stops distinguishing anything (research D7). */
const CHART_LIMIT = 7;

const { t, n, d } = useI18n();
const store = useReportsStore();

const report = ref<AgentResponse | null>(null);
const noData = ref(false);
const loading = ref(true);
/** 404 means the report is ABSENT for this reader, not withheld (FR-030b). */
const absent = ref(false);
const failed = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  failed.value = false;
  absent.value = false;

  try {
    const response = await request<AgentResponse>(
      `/reports/agents?from=${store.from}&to=${store.to}`,
    );

    noData.value = Boolean(response.noData);
    report.value = noData.value ? null : response;
  } catch (caught) {
    // The 404 is the server telling this reader the report does not exist for
    // them. Rendering it as an error would contradict that; rendering it as
    // "not found" is the same answer the router would give.
    if (caught instanceof ApiError && caught.status === 404) {
      absent.value = true;
    } else {
      failed.value = true;
    }

    report.value = null;
  } finally {
    loading.value = false;
  }
}

const rows = computed(() => report.value?.agents.value ?? []);

const useTable = computed(() => rows.value.length > CHART_LIMIT);

const volumeRows = computed(() =>
  rows.value.map((row) => ({ label: row.name, value: row.assigned })),
);

const tableRows = computed(() =>
  rows.value.map((row) => ({
    agent: row.name,
    assigned: row.assigned,
    settled: row.settled,
    // A withheld rate is an EM DASH, never 0%. Zero would read as "resolved
    // nothing" (FR-036).
    settledRate: row.settledRate === null ? '—' : n(row.settledRate, 'percent'),
    responseCompliance:
      row.responseCompliance === null ? '—' : n(row.responseCompliance, 'percent'),
    resolutionCompliance:
      row.resolutionCompliance === null ? '—' : n(row.resolutionCompliance, 'percent'),
  })),
);

function onPeriodChange(from: string, to: string): void {
  store.setPeriod(from, to);
  void load();
}

onMounted(load);
</script>

<template>
  <section class="agents">
    <header class="agents__head">
      <h1 class="agents__title">{{ t('reports.agent.title') }}</h1>
      <PeriodFilter :from="store.from" :to="store.to" :busy="loading" @change="onPeriodChange" />
      <ExportMenu :report="'agents'" :query="{ from: store.from, to: store.to }" />
    </header>

    <p v-if="loading" role="status">{{ t('reports.dashboard.loading') }}</p>
    <p v-else-if="absent" role="status">{{ t('reports.agent.absent') }}</p>
    <p v-else-if="failed" role="alert">{{ t('reports.dashboard.unavailable') }}</p>
    <p v-else-if="noData" class="agents__empty">{{ t('reports.noData') }}</p>

    <template v-else-if="report">
      <!--
        THE RULE, PROMINENT. Not a tooltip, not a footnote.

        `data-provenance` so it stays visible in print too — a printed page of
        figures about people, without the definition of what the figures mean, is
        the version most likely to be forwarded.
      -->
      <aside class="agents__rule" data-provenance>
        <h2 class="agents__rule-title">{{ t('reports.agent.ruleTitle') }}</h2>
        <p class="agents__rule-text">
          {{ t(`reports.agent.rule.${report.attributionRule.key}`) }}
        </p>
        <p v-if="report.attributionRule.countsOnce" class="agents__rule-text">
          {{ t('reports.agent.countsOnce') }}
        </p>
      </aside>

      <FigureFrame
        :title="t('reports.agent.volume')"
        :figure="report.agents"
        :table-rows="tableRows"
        :table-columns="[
          'agent',
          'assigned',
          'settled',
          'settledRate',
          'responseCompliance',
          'resolutionCompliance',
        ]"
      >
        <!-- Past the limit the chart is not drawn at all. A chart nobody can
             read is worse than a table, not a nicer alternative to one. -->
        <BarChart v-if="!useTable" :rows="volumeRows" :value-label="t('reports.agent.assigned')" />
        <p v-else class="agents__too-many">
          {{ t('reports.agent.tooMany', { limit: n(CHART_LIMIT) }) }}
        </p>
      </FigureFrame>

      <!-- FR-032: the period each agent was available, so a low count during
           leave or after joining is not read as performance. -->
      <table class="agents__periods">
        <caption>
          {{
            t('reports.agent.activePeriods')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('reports.column.agent') }}</th>
            <th scope="col">{{ t('reports.agent.activeFrom') }}</th>
            <th scope="col">{{ t('reports.agent.status') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.agentId">
            <td>{{ row.name }}</td>
            <td>{{ d(new Date(row.activeFrom), 'short') }}</td>
            <td>
              {{ row.active ? t('reports.agent.active') : t('reports.agent.deactivated') }}
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
.agents {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.agents__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem 1.5rem;
}

.agents__title {
  margin: 0;
  font-size: 1.25rem;
  margin-inline-end: auto;
}

.agents__rule {
  border: 1px solid var(--viz-grid, #e5e7eb);
  border-inline-start: 4px solid var(--viz-series-1, #2a78d6);
  border-radius: 0.375rem;
  padding: 0.625rem 0.75rem;
  background: var(--viz-surface, #fcfcfb);
}

.agents__rule-title {
  margin: 0 0 0.25rem;
  font-size: 0.875rem;
}

.agents__rule-text {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--viz-text-secondary, #52514e);
}

.agents__too-many {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--viz-text-secondary, #52514e);
}

.agents__periods {
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.agents__periods caption {
  text-align: start;
  padding-block-end: 0.25rem;
  color: var(--viz-text-secondary, #52514e);
}

.agents__periods th,
.agents__periods td {
  border: 1px solid var(--viz-grid, #e5e7eb);
  padding: 0.25rem 0.5rem;
  text-align: start;
}

.agents__empty {
  color: var(--viz-text-secondary, #52514e);
}
</style>
