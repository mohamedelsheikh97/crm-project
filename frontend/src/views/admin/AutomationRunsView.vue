<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { listRuns, type AutomationRun } from '../../services/automation.service';

/**
 * What automation did, and why (User Story 7).
 *
 * `no_match` ROWS MATTER AS MUCH AS THE REST. User Story 4 requires a non-match
 * to be visibly NOT an error, and a table that hid them would leave a
 * supervisor unable to tell "did not match" from "never ran" — which are
 * different diagnoses that look identical from an empty screen.
 *
 * OUTCOMES CARRY AN ICON AND TEXT, never colour alone: the same rule the SLA
 * state indicator follows, for the same reason.
 *
 * `detail` IS RENDERED FROM ITS KEY, never displayed raw. The row holds
 * `{ key, params }` because the same row may be read by an Arabic user and an
 * English one, so the language cannot be decided at write time.
 */

const { t, d } = useI18n();

const runs = ref<AutomationRun[]>([]);
const total = ref(0);
const loading = ref(false);
const outcome = ref('');

const OUTCOMES = ['acted', 'no_match', 'suppressed', 'failed'] as const;

const GLYPH: Record<string, string> = {
  acted: '✓',
  no_match: '–',
  suppressed: '⊘',
  failed: '⚠',
};

async function load(): Promise<void> {
  loading.value = true;

  try {
    const page = await listRuns(outcome.value === '' ? {} : { outcome: outcome.value });
    runs.value = page.items;
    total.value = page.total;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="space-y-4">
    <header>
      <h1 class="text-xl font-semibold">{{ t('automation.runs.title') }}</h1>
      <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
        {{ t('automation.runs.description') }}
      </p>
    </header>

    <label class="flex items-center gap-2 text-sm">
      {{ t('automation.runs.filter.outcome') }}
      <select v-model="outcome" class="rounded border p-2" @change="load">
        <option value="">{{ t('audit.filter.all') }}</option>
        <option v-for="value in OUTCOMES" :key="value" :value="value">
          {{ t(`automation.outcome.${value}`) }}
        </option>
      </select>
    </label>

    <p v-if="loading">{{ t('table.loading') }}</p>
    <p v-else-if="runs.length === 0" class="text-sm text-slate-600">
      {{ t('automation.runs.empty') }}
    </p>

    <table v-else class="w-full text-sm">
      <thead>
        <tr>
          <th scope="col" class="p-2 text-start">{{ t('automation.runs.column.time') }}</th>
          <th scope="col" class="p-2 text-start">{{ t('automation.runs.column.rule') }}</th>
          <th scope="col" class="p-2 text-start">{{ t('automation.runs.column.ticket') }}</th>
          <th scope="col" class="p-2 text-start">{{ t('automation.runs.column.outcome') }}</th>
          <th scope="col" class="p-2 text-start">{{ t('automation.runs.column.detail') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="run in runs" :key="run.id" class="border-t">
          <td class="p-2">{{ d(new Date(run.createdAt), 'long') }}</td>
          <!-- `ruleName` is present even when the rule is gone (FR-070). -->
          <td class="p-2">{{ run.ruleName }}</td>
          <td class="p-2">{{ run.ticket?.reference ?? '' }}</td>
          <td class="p-2" :data-outcome="run.outcome">
            <span aria-hidden="true">{{ GLYPH[run.outcome] }}</span>
            {{ t(`automation.outcome.${run.outcome}`) }}
          </td>
          <td class="p-2">
            <span v-if="run.detail">{{ t(run.detail.key, run.detail.params ?? {}) }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
