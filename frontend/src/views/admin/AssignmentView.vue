<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { ApiError } from '../../services/http';
import {
  getAssignmentSettings,
  listCompetencies,
  replaceCompetencies,
  updateAssignmentSettings,
  type AssignmentSettings,
  type AssignmentStrategy,
  type CompetencyRow,
} from '../../services/automation.service';

/**
 * Automatic assignment, and the competencies it routes on.
 *
 * ONE SCREEN because one permission covers both: competency exists only to
 * serve routing (research D14), so splitting them would let somebody redirect
 * work without appearing to touch the strategy.
 *
 * THE HEADER NOTE IS NOT DECORATION. Supervisors will otherwise assume that
 * enabling a strategy overrides their own decisions; FR-049 says the opposite,
 * and saying so here is what stops the feature being switched off in week two.
 */

const { t } = useI18n();

const STRATEGIES: AssignmentStrategy[] = ['off', 'round_robin', 'least_loaded', 'competency'];

const settings = ref<AssignmentSettings | null>(null);
const competencies = ref<{ categories: string[]; users: CompetencyRow[] }>({
  categories: [],
  users: [],
});

const loading = ref(false);
const saving = ref(false);
const savedKey = ref<string | null>(null);
const errorKey = ref<string | null>(null);

const strategy = ref<AssignmentStrategy>('off');
// `null` is "no limit" and is NOT the same as 0, which would mean "assign
// nobody anything" — a different intention that `strategy: off` states clearly.
const hasCeiling = ref(false);
const ceiling = ref<number>(15);

async function load(): Promise<void> {
  loading.value = true;

  try {
    const [current, competencyRows] = await Promise.all([
      getAssignmentSettings(),
      listCompetencies(),
    ]);

    settings.value = current;
    strategy.value = current.strategy;
    hasCeiling.value = current.maxOpenPerAgent !== null;
    ceiling.value = current.maxOpenPerAgent ?? 15;
    competencies.value = competencyRows;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function save(): Promise<void> {
  if (!settings.value) return;

  saving.value = true;
  savedKey.value = null;
  errorKey.value = null;

  try {
    await updateAssignmentSettings({
      strategy: strategy.value,
      maxOpenPerAgent: hasCeiling.value ? ceiling.value : null,
      version: settings.value.version,
    });

    savedKey.value = 'assignment.saved';
    await load();
  } catch (error) {
    if (error instanceof ApiError) {
      // FR-051 surfaces here: `assignment.error.requiresAssignAuthority`, which
      // explains a refusal an administrator who just granted the key could not
      // otherwise account for.
      errorKey.value = error.details[0]?.message ?? 'error.noPermission';
    } else {
      throw error;
    }
  } finally {
    saving.value = false;
  }
}

async function toggleCompetency(row: CompetencyRow, category: string): Promise<void> {
  const next = row.categories.includes(category)
    ? row.categories.filter((value) => value !== category)
    : [...row.categories, category];

  await replaceCompetencies(row.userId, next);
  await load();
}
</script>

<template>
  <section class="space-y-6">
    <header>
      <h1 class="text-xl font-semibold">{{ t('assignment.title') }}</h1>
      <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
        {{ t('assignment.description') }}
      </p>
      <p class="mt-2 rounded bg-slate-50 p-2 text-sm dark:bg-slate-800">
        {{ t('assignment.humanAssignmentWins') }}
      </p>
    </header>

    <p v-if="savedKey" role="status" class="rounded bg-emerald-50 p-2 text-sm text-emerald-900">
      {{ t(savedKey) }}
    </p>
    <p v-if="errorKey" role="alert" class="rounded bg-red-50 p-2 text-sm text-red-900">
      {{ t(errorKey) }}
    </p>

    <p v-if="loading">{{ t('table.loading') }}</p>

    <form v-else-if="settings" class="space-y-4" @submit.prevent="save">
      <fieldset>
        <legend class="text-sm font-medium">{{ t('assignment.strategy.label') }}</legend>

        <div class="mt-2 space-y-2">
          <label v-for="option in STRATEGIES" :key="option" class="flex items-start gap-2">
            <input v-model="strategy" type="radio" :value="option" class="mt-1" />
            <span>
              <span class="block text-sm font-medium">{{
                t(`assignment.strategy.${option}`)
              }}</span>
              <!-- A sentence of consequence per option: the difference between
                   choosing and guessing. -->
              <span class="block text-sm text-slate-600 dark:text-slate-400">
                {{ t(`assignment.strategy.${option}.detail`) }}
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      <p class="text-sm" :class="settings.eligibleAgentCount === 0 ? 'text-amber-800' : ''">
        {{
          settings.eligibleAgentCount === 0
            ? t('assignment.noEligibleAgents')
            : t(
                'assignment.eligibleAgents',
                { count: settings.eligibleAgentCount },
                settings.eligibleAgentCount,
              )
        }}
      </p>

      <fieldset>
        <legend class="text-sm font-medium">{{ t('assignment.ceiling.label') }}</legend>
        <label class="mt-1 flex items-center gap-2 text-sm">
          <input v-model="hasCeiling" type="checkbox" />
          <span v-if="!hasCeiling">{{ t('assignment.ceiling.noLimit') }}</span>
        </label>
        <input
          v-if="hasCeiling"
          v-model.number="ceiling"
          type="number"
          min="1"
          class="mt-1 rounded border p-2"
        />
      </fieldset>

      <button type="submit" :disabled="saving" class="rounded bg-sky-600 px-3 py-2 text-white">
        {{ t('action.save') }}
      </button>
    </form>

    <section class="space-y-2">
      <h2 class="font-medium">{{ t('assignment.competencies.title') }}</h2>
      <p class="text-sm text-slate-600 dark:text-slate-400">
        {{ t('assignment.competencies.description') }}
      </p>

      <!--
        Categories as COLUMNS rather than tags: the set is small and fixed, and a
        matrix stays legible in both directions where a tag cloud does not.
      -->
      <table class="w-full text-sm">
        <thead>
          <tr>
            <th scope="col" class="p-2 text-start">
              {{ t('assignment.competencies.column.user') }}
            </th>
            <th
              v-for="category in competencies.categories"
              :key="category"
              scope="col"
              class="p-2 text-start"
            >
              {{ t(`ticket.category.${category}`) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in competencies.users" :key="row.userId" class="border-t">
            <th scope="row" class="p-2 text-start font-normal">{{ row.fullName }}</th>
            <td v-for="category in competencies.categories" :key="category" class="p-2">
              <input
                type="checkbox"
                :checked="row.categories.includes(category)"
                :aria-label="`${row.fullName}: ${t(`ticket.category.${category}`)}`"
                @change="toggleCompetency(row, category)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>
