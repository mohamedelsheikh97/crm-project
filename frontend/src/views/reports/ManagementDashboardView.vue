<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import PeriodFilter from '../../components/reports/PeriodFilter.vue';
import BarChart from '../../components/viz/BarChart.vue';
import FigureFrame from '../../components/viz/FigureFrame.vue';
import KpiRow from '../../components/viz/KpiRow.vue';
import LineChart from '../../components/viz/LineChart.vue';
import StackedBar from '../../components/viz/StackedBar.vue';
import StatTile from '../../components/viz/StatTile.vue';
import { useAutoRefresh } from '../../composables/useAutoRefresh';
import * as reportsService from '../../services/reports.service';
import type { FigureEnvelope } from '../../services/reports.service';
import { useReportsStore } from '../../stores/reports.store';

/**
 * The management dashboard (Phase 10, US1, FR-037 - FR-045).
 *
 * ONE REQUEST FOR EVERY FIGURE, so they all resolve against one period (FR-002).
 * Twelve independent requests would resolve twelve boundaries and produce a
 * dashboard whose total does not match its own breakdown.
 *
 * FIGURES ARE NOT IN AN `aria-live` REGION, deliberately (research D8, FR-045c).
 * An interval-updating region that announces would read numbers aloud every
 * minute, unprompted, interrupting whatever the reader was doing. They get a
 * deliberate refresh control and an explicit statement of when the figures are
 * from — the same information without the interruption.
 *
 * ON A FAILED REFRESH the previous figures stay on screen with their own
 * timestamp (FR-045d). Blanking the dashboard or showing zeroes would both be
 * worse than a stale number that says how stale it is.
 */
const { t, d, n } = useI18n();
const store = useReportsStore();

const figures = ref<Record<string, FigureEnvelope> | null>(null);
const noData = ref(false);

/**
 * The viewer's arrangement (US6, FR-040 - FR-042).
 *
 * Comes back WITH the figures, already filtered by authority — so a tile the
 * reader has lost the permission for is simply not in the list, rather than
 * producing an error on a dashboard they never asked to include it in.
 */
const layout = ref<string[]>([]);
const available = ref<string[]>([]);
const arranging = ref(false);
const saveError = ref<string | null>(null);

/**
 * The refresh interval. FR-045 requires it configurable rather than fixed,
 * because a wall display and a browser tab want different values — Open
 * Question 4 is choosing the defaults per surface.
 */
const REFRESH_MS = 60_000;

async function load(): Promise<void> {
  const response = await reportsService.dashboard({ from: store.from, to: store.to });

  noData.value = Boolean((response as unknown as { noData?: boolean }).noData);
  figures.value = response.figures;
  layout.value = response.layout ?? [];
}

/**
 * Whether a tile is shown.
 *
 * BOTH conditions, and both matter: the figure has to be in the payload (the
 * server withheld it otherwise, FR-042) AND in the arrangement (the reader
 * chose not to show it). Treating either as implying the other would override
 * the reader's choice or render a tile with no data.
 */
function shows(key: string): boolean {
  return layout.value.includes(key) && Boolean(figures.value?.[key]);
}

async function toggleArranging(): Promise<void> {
  arranging.value = !arranging.value;
  saveError.value = null;

  // The catalog is fetched only when the panel opens. It does not change while
  // the dashboard is being read, and the refresh interval should not carry it.
  if (arranging.value && available.value.length === 0) {
    const response = await reportsService.arrangement();

    available.value = response.available;
    layout.value = response.layout;
  }
}

function toggle(key: string): void {
  layout.value = layout.value.includes(key)
    ? layout.value.filter((entry) => entry !== key)
    : [...layout.value, key];
}

/**
 * Moves a tile one place.
 *
 * Buttons rather than drag-and-drop: a drag target is unreachable by keyboard
 * without a parallel mechanism, and this IS that mechanism (Principle IV). It
 * is also the only one that works on a touch screen without a long-press.
 */
function move(key: string, by: -1 | 1): void {
  const index = layout.value.indexOf(key);
  const target = index + by;

  if (index < 0 || target < 0 || target >= layout.value.length) return;

  const next = [...layout.value];

  [next[index], next[target]] = [next[target]!, next[index]!];
  layout.value = next;
}

async function persistArrangement(): Promise<void> {
  saveError.value = null;

  try {
    const response = await reportsService.saveArrangement(layout.value);

    layout.value = response.layout;
    arranging.value = false;
  } catch {
    // The reader keeps their edits on screen. Clearing them on a failed save
    // would lose work they would then have to redo blind.
    saveError.value = t('reports.arrangement.saveFailed');
  }
}

const refresh = useAutoRefresh(load, { intervalMs: REFRESH_MS });

function figureAt(key: string): FigureEnvelope | null {
  return figures.value?.[key] ?? null;
}

function numberValue(key: string): number | null {
  const value = figureAt(key)?.value;
  return typeof value === 'number' ? value : null;
}

function rowsOf<T>(key: string): T[] {
  const value = figureAt(key)?.value;
  return Array.isArray(value) ? (value as T[]) : [];
}

const statusSegments = computed(() =>
  rowsOf<{ status: string; count: number }>('volume.byStatus')
    .filter((row) => row.count > 0)
    .map((row) => ({ label: t(`ticket.status.${row.status}`), value: row.count })),
);

const categoryRows = computed(() =>
  rowsOf<{ category: string; count: number }>('volume.byCategory').map((row) => ({
    label: t(`ticket.category.${row.category}`),
    value: row.count,
  })),
);

const channelRows = computed(() =>
  rowsOf<{ channel: string; count: number }>('volume.byChannel')
    .filter((row) => row.count > 0)
    .map((row) => ({ label: row.channel, value: row.count })),
);

function onPeriodChange(from: string, to: string): void {
  store.setPeriod(from, to);
  void refresh.refreshNow();
}
</script>

<template>
  <section class="dashboard">
    <header class="dashboard__head">
      <h1 class="dashboard__title">{{ t('reports.dashboard.title') }}</h1>

      <div class="dashboard__controls">
        <PeriodFilter
          :from="store.from"
          :to="store.to"
          :busy="refresh.inFlight.value"
          @change="onPeriodChange"
        />

        <button
          type="button"
          class="dashboard__refresh"
          :aria-expanded="arranging"
          @click="toggleArranging"
        >
          {{ t('reports.arrangement.arrange') }}
        </button>

        <!-- The deliberate control that replaces an announcing live region. -->
        <button
          type="button"
          class="dashboard__refresh"
          :disabled="refresh.inFlight.value"
          @click="refresh.refreshNow()"
        >
          {{
            refresh.inFlight.value
              ? t('reports.dashboard.refreshing')
              : t('reports.dashboard.refresh')
          }}
        </button>
      </div>
    </header>

    <!-- FR-043: the last SUCCESSFUL computation, never the last attempt. -->
    <p class="dashboard__freshness">
      <template v-if="refresh.lastSuccessAt.value">
        {{ t('reports.dashboard.asOf', { at: d(refresh.lastSuccessAt.value, 'long') }) }}
      </template>
      <span v-if="refresh.lastError.value" class="dashboard__stale">
        {{ t('reports.dashboard.refreshFailed') }}
      </span>
      <span v-if="refresh.paused.value" class="dashboard__paused">
        {{ t('reports.dashboard.paused') }}
      </span>
    </p>

    <!--
      The arrangement panel (FR-040).

      `data-print="hide"`: it is chrome, and would otherwise print as a list of
      checkboxes above the figures it arranges.
    -->
    <section v-if="arranging" class="dashboard__arrange" data-print="hide">
      <h2 class="dashboard__arrange-title">{{ t('reports.arrangement.title') }}</h2>

      <ul class="dashboard__arrange-list">
        <li v-for="key in available" :key="key" class="dashboard__arrange-item">
          <label class="dashboard__arrange-label">
            <input type="checkbox" :checked="layout.includes(key)" @change="toggle(key)" />
            {{ t(`reports.figure.name.${key}`) }}
          </label>

          <span v-if="layout.includes(key)" class="dashboard__arrange-order">
            <button
              type="button"
              :disabled="layout.indexOf(key) === 0"
              :aria-label="
                t('reports.arrangement.moveUp', { figure: t(`reports.figure.name.${key}`) })
              "
              @click="move(key, -1)"
            >
              <span aria-hidden="true">&uarr;</span>
            </button>
            <button
              type="button"
              :disabled="layout.indexOf(key) === layout.length - 1"
              :aria-label="
                t('reports.arrangement.moveDown', { figure: t(`reports.figure.name.${key}`) })
              "
              @click="move(key, 1)"
            >
              <span aria-hidden="true">&darr;</span>
            </button>
          </span>
        </li>
      </ul>

      <p v-if="saveError" role="alert" class="dashboard__stale">{{ saveError }}</p>

      <button type="button" class="dashboard__refresh" @click="persistArrangement">
        {{ t('reports.arrangement.save') }}
      </button>
    </section>

    <!-- FR-014: a period the system predates is not a quiet month. -->
    <p v-if="noData" class="dashboard__empty">{{ t('reports.noData') }}</p>

    <template v-else-if="figures">
      <KpiRow v-if="shows('volume.received') || shows('volume.openAtEnd')">
        <StatTile
          v-if="shows('volume.received')"
          :label="t('reports.volume.received')"
          :value="numberValue('volume.received')"
        />
        <StatTile
          v-if="shows('volume.openAtEnd')"
          :label="t('reports.volume.openAtEnd')"
          :value="numberValue('volume.openAtEnd')"
          :rise-is-good="false"
        />
      </KpiRow>

      <div class="dashboard__grid">
        <FigureFrame
          v-if="shows('volume.overTime')"
          :title="t('reports.volume.overTime')"
          :figure="figureAt('volume.overTime')!"
          :table-rows="rowsOf('volume.overTime')"
          :table-columns="['bucket', 'count']"
        >
          <LineChart
            :rows="rowsOf('volume.overTime')"
            :value-label="t('reports.volume.received')"
          />
        </FigureFrame>

        <FigureFrame
          v-if="shows('volume.byStatus')"
          :title="t('reports.volume.byStatus')"
          :figure="figureAt('volume.byStatus')!"
          :table-rows="rowsOf('volume.byStatus')"
          :table-columns="['status', 'count']"
        >
          <StackedBar :segments="statusSegments" />
        </FigureFrame>

        <FigureFrame
          v-if="shows('volume.byCategory')"
          :title="t('reports.volume.byCategory')"
          :figure="figureAt('volume.byCategory')!"
          :table-rows="rowsOf('volume.byCategory')"
          :table-columns="['category', 'count']"
        >
          <BarChart :rows="categoryRows" :value-label="t('reports.column.count')" />
        </FigureFrame>

        <FigureFrame
          v-if="shows('volume.byChannel')"
          :title="t('reports.volume.byChannel')"
          :figure="figureAt('volume.byChannel')!"
          :table-rows="rowsOf('volume.byChannel')"
          :table-columns="['channel', 'count']"
        >
          <BarChart :rows="channelRows" :value-label="t('reports.column.count')" />
        </FigureFrame>
      </div>

      <FigureFrame
        v-if="shows('ai.byFeature')"
        :title="t('reports.ai.title')"
        :figure="figureAt('ai.byFeature')!"
        :table-rows="rowsOf('ai.byFeature')"
        :table-columns="['feature', 'invocations', 'failures', 'tokens']"
      >
        <!-- FR-057: no prompt or completion is retained, and the screen says
             so rather than appearing to have lost it. -->
        <p class="dashboard__note">{{ t('reports.ai.noContent') }}</p>
        <BarChart
          :rows="
            rowsOf<{ feature: string; invocations: number }>('ai.byFeature').map((row) => ({
              label: t(`ai.admin.feature.${row.feature}`),
              value: row.invocations,
            }))
          "
          :value-label="t('reports.ai.invocations')"
        />
      </FigureFrame>
    </template>

    <p v-else-if="refresh.inFlight.value" role="status">{{ t('reports.dashboard.loading') }}</p>

    <p v-else class="dashboard__empty">{{ t('reports.dashboard.unavailable') }} ({{ n(0) }})</p>
  </section>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.dashboard__head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
  justify-content: space-between;
}

.dashboard__title {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0;
}

.dashboard__controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}

.dashboard__refresh {
  min-height: 2rem;
  padding-inline: 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 0.25rem;
  background: none;
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
}

.dashboard__freshness {
  margin: 0;
  font-size: 0.75rem;
  color: var(--viz-text-muted, #6b7280);
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.dashboard__stale {
  color: #b91c1c;
}

.dashboard__paused {
  font-style: italic;
}

.dashboard__arrange {
  border: 1px solid var(--viz-grid, #e5e7eb);
  border-radius: 0.5rem;
  padding: 0.75rem;
}

.dashboard__arrange-title {
  margin: 0 0 0.5rem;
  font-size: 0.9375rem;
}

.dashboard__arrange-list {
  list-style: none;
  margin: 0 0 0.75rem;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: 0.25rem 1rem;
}

.dashboard__arrange-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.8125rem;
}

.dashboard__arrange-label {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.dashboard__arrange-order button {
  /* 2rem square: the smallest target that still meets the touch guidance
     alongside the surrounding row padding. */
  min-inline-size: 2rem;
  min-block-size: 2rem;
  border: 1px solid var(--viz-grid, #e5e7eb);
  border-radius: 0.25rem;
  background: none;
  font: inherit;
  cursor: pointer;
}

.dashboard__arrange-order button:disabled {
  opacity: 0.5;
  cursor: default;
}

.dashboard__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr));
  gap: 1rem;
}

.dashboard__empty,
.dashboard__note {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--viz-text-secondary, #52514e);
}

@media print {
  .dashboard__controls,
  .dashboard__refresh {
    display: none;
  }

  .dashboard__grid {
    grid-template-columns: 1fr;
  }
}
</style>
