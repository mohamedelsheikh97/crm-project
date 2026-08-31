<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { useDuration } from '../../composables/useDuration';
import { ApiError } from '../../services/http';
import {
  activatePolicy,
  createPolicy,
  deactivatePolicy,
  listPolicies,
  updatePolicy,
  type SlaPolicy,
} from '../../services/sla.service';

/**
 * SLA policies.
 *
 * THE LIST ORDER IS THE PRECEDENCE ORDER (FR-013), so this screen explains
 * precedence by DEMONSTRATING it rather than by prose that could drift from
 * what the matcher does. The line above the table names the rule; the table
 * shows it. Nothing here re-sorts what the server returned.
 *
 * THERE IS NO DELETE CONTROL, and its absence is FR-019 rather than an
 * oversight: a policy tickets were measured against stays readable, so a ticket
 * never points at a promise nobody can look up. The tooltip says so.
 */

const { t } = useI18n();
const { duration } = useDuration();

const policies = ref<SlaPolicy[]>([]);
const loading = ref(false);
const saving = ref(false);
const editing = ref<SlaPolicy | null>(null);
const drawerOpen = ref(false);
const warningKey = ref<string | null>(null);
const fieldErrors = ref<Record<string, string>>({});

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
const CATEGORIES = ['general', 'technical', 'billing', 'complaint'] as const;

/**
 * A NUMBER AND A UNIT, not a raw minute field.
 *
 * "2400 minutes" is what a five-working-day target looks like in storage, and
 * asking an administrator to compute that by hand is asking them to get it
 * wrong. The unit converts on submit; the wire still carries working minutes.
 */
type Unit = 'minutes' | 'hours' | 'days';

const MINUTES_PER: Record<Unit, number> = { minutes: 1, hours: 60, days: 480 };

const draft = ref({
  name: '',
  nameAr: '',
  priority: '' as string,
  category: '' as string,
  responseValue: 4,
  responseUnit: 'hours' as Unit,
  resolutionValue: 1,
  resolutionUnit: 'days' as Unit,
});

async function load(): Promise<void> {
  loading.value = true;

  try {
    policies.value = await listPolicies();
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function bestUnit(minutes: number): { value: number; unit: Unit } {
  if (minutes % MINUTES_PER.days === 0) return { value: minutes / MINUTES_PER.days, unit: 'days' };
  if (minutes % MINUTES_PER.hours === 0)
    return { value: minutes / MINUTES_PER.hours, unit: 'hours' };
  return { value: minutes, unit: 'minutes' };
}

function startCreate(): void {
  editing.value = null;
  fieldErrors.value = {};
  draft.value = {
    name: '',
    nameAr: '',
    priority: '',
    category: '',
    responseValue: 4,
    responseUnit: 'hours',
    resolutionValue: 1,
    resolutionUnit: 'days',
  };
  drawerOpen.value = true;
}

function startEdit(policy: SlaPolicy): void {
  editing.value = policy;
  fieldErrors.value = {};

  const response = bestUnit(policy.responseMinutes);
  const resolution = bestUnit(policy.resolutionMinutes);

  draft.value = {
    name: policy.name,
    nameAr: policy.nameAr ?? '',
    priority: policy.priority ?? '',
    category: policy.category ?? '',
    responseValue: response.value,
    responseUnit: response.unit,
    resolutionValue: resolution.value,
    resolutionUnit: resolution.unit,
  };
  drawerOpen.value = true;
}

const payload = computed(() => ({
  name: draft.value.name,
  nameAr: draft.value.nameAr.trim() === '' ? null : draft.value.nameAr,
  priority: draft.value.priority === '' ? null : draft.value.priority,
  category: draft.value.category === '' ? null : draft.value.category,
  responseMinutes: draft.value.responseValue * MINUTES_PER[draft.value.responseUnit],
  resolutionMinutes: draft.value.resolutionValue * MINUTES_PER[draft.value.resolutionUnit],
}));

async function save(): Promise<void> {
  saving.value = true;
  fieldErrors.value = {};

  try {
    if (editing.value) {
      await updatePolicy(editing.value.id, { ...payload.value, version: editing.value.version });
    } else {
      await createPolicy(payload.value);
    }

    drawerOpen.value = false;
    await load();
  } catch (error) {
    if (error instanceof ApiError) {
      // Announced through the field, not only shown — Principle IV.
      for (const detail of error.details) fieldErrors.value[detail.field] = detail.message;
    } else {
      throw error;
    }
  } finally {
    saving.value = false;
  }
}

async function toggleActive(policy: SlaPolicy): Promise<void> {
  const result = policy.isActive
    ? await deactivatePolicy(policy.id)
    : await activatePolicy(policy.id);

  // A WARNING, never a refusal: "no policy" is a valid state (FR-014), so
  // deactivating the last catch-all is allowed and merely reported.
  warningKey.value = result.warning;
  await load();
}
</script>

<template>
  <section class="space-y-4">
    <header class="flex items-start justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold">{{ t('sla.policies.title') }}</h1>
        <p class="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
          {{ t('sla.policies.precedenceExplained') }}
        </p>
      </div>

      <button type="button" class="rounded bg-sky-600 px-3 py-2 text-white" @click="startCreate">
        {{ t('sla.policies.create') }}
      </button>
    </header>

    <p v-if="warningKey" role="status" class="rounded bg-amber-50 p-3 text-sm text-amber-900">
      {{ t(warningKey) }}
    </p>

    <p v-if="loading" class="text-sm">{{ t('table.loading') }}</p>

    <p v-else-if="policies.length === 0" class="text-sm text-slate-600">
      {{ t('sla.policies.empty') }}
    </p>

    <table v-else class="w-full text-sm">
      <caption class="sr-only">
        {{
          t('sla.policies.precedenceExplained')
        }}
      </caption>
      <thead>
        <tr class="text-start">
          <th scope="col" class="p-2 text-start">{{ t('sla.policies.column.name') }}</th>
          <th scope="col" class="p-2 text-start">{{ t('sla.policies.column.matches') }}</th>
          <th scope="col" class="p-2 text-start">{{ t('sla.policies.column.response') }}</th>
          <th scope="col" class="p-2 text-start">{{ t('sla.policies.column.resolution') }}</th>
          <th scope="col" class="p-2 text-start">{{ t('sla.policies.column.openTickets') }}</th>
          <th scope="col" class="p-2 text-start">{{ t('sla.policies.column.status') }}</th>
          <th scope="col" class="p-2 text-start">{{ t('action.edit') }}</th>
        </tr>
      </thead>
      <tbody>
        <!-- IN MATCHING ORDER. Do not sort. -->
        <tr v-for="policy in policies" :key="policy.id" class="border-t">
          <td class="p-2">{{ policy.name }}</td>
          <td class="p-2">{{ t(policy.matchesLabelKey) }}</td>
          <td class="p-2">{{ duration(policy.responseMinutes) }}</td>
          <td class="p-2">{{ duration(policy.resolutionMinutes) }}</td>
          <td class="p-2">{{ policy.openTicketCount }}</td>
          <td class="p-2">
            {{ policy.isActive ? t('sla.policies.active') : t('sla.policies.inactive') }}
          </td>
          <td class="p-2">
            <button type="button" class="underline" @click="startEdit(policy)">
              {{ t('action.edit') }}
            </button>
            <button
              type="button"
              class="ms-3 underline"
              :title="t('sla.policies.noDeleteReason')"
              @click="toggleActive(policy)"
            >
              {{ policy.isActive ? t('sla.policies.deactivate') : t('sla.policies.activate') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <form v-if="drawerOpen" class="space-y-3 rounded border p-4" @submit.prevent="save">
      <div>
        <label class="block text-sm" for="policy-name">{{ t('sla.field.name') }}</label>
        <input
          id="policy-name"
          v-model="draft.name"
          class="w-full rounded border p-2"
          :aria-invalid="Boolean(fieldErrors.name)"
          :aria-describedby="fieldErrors.name ? 'policy-name-error' : undefined"
        />
        <p v-if="fieldErrors.name" id="policy-name-error" role="alert" class="text-sm text-red-700">
          {{ t(fieldErrors.name) }}
        </p>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-sm" for="policy-priority">{{ t('sla.field.priority') }}</label>
          <select id="policy-priority" v-model="draft.priority" class="w-full rounded border p-2">
            <option value="">{{ t('sla.field.anyPriority') }}</option>
            <option v-for="priority in PRIORITIES" :key="priority" :value="priority">
              {{ t(`ticket.priority.${priority}`) }}
            </option>
          </select>
        </div>

        <div>
          <label class="block text-sm" for="policy-category">{{ t('sla.field.category') }}</label>
          <select id="policy-category" v-model="draft.category" class="w-full rounded border p-2">
            <option value="">{{ t('sla.field.anyCategory') }}</option>
            <option v-for="category in CATEGORIES" :key="category" :value="category">
              {{ t(`ticket.category.${category}`) }}
            </option>
          </select>
        </div>
      </div>

      <fieldset class="grid grid-cols-2 gap-3">
        <legend class="text-sm">{{ t('sla.field.responseTarget') }}</legend>
        <input
          v-model.number="draft.responseValue"
          type="number"
          min="1"
          class="rounded border p-2"
        />
        <select v-model="draft.responseUnit" class="rounded border p-2">
          <option value="minutes">{{ t('sla.unit.minutes') }}</option>
          <option value="hours">{{ t('sla.unit.hours') }}</option>
          <option value="days">{{ t('sla.unit.days') }}</option>
        </select>
      </fieldset>

      <fieldset class="grid grid-cols-2 gap-3">
        <legend class="text-sm">{{ t('sla.field.resolutionTarget') }}</legend>
        <input
          v-model.number="draft.resolutionValue"
          type="number"
          min="1"
          class="rounded border p-2"
        />
        <select v-model="draft.resolutionUnit" class="rounded border p-2">
          <option value="minutes">{{ t('sla.unit.minutes') }}</option>
          <option value="hours">{{ t('sla.unit.hours') }}</option>
          <option value="days">{{ t('sla.unit.days') }}</option>
        </select>
      </fieldset>

      <p v-if="fieldErrors.resolutionMinutes" role="alert" class="text-sm text-red-700">
        {{ t(fieldErrors.resolutionMinutes) }}
      </p>

      <div class="flex gap-2">
        <button type="submit" :disabled="saving" class="rounded bg-sky-600 px-3 py-2 text-white">
          {{ t('action.save') }}
        </button>
        <button type="button" class="rounded border px-3 py-2" @click="drawerOpen = false">
          {{ t('action.cancel') }}
        </button>
      </div>
    </form>
  </section>
</template>
