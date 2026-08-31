<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { ApiError } from '../../services/http';
import {
  createRule,
  deleteRule,
  disableRule,
  dryRunRule,
  enableRule,
  getCatalog,
  listRules,
  reorderRules,
  updateRule,
  type AutomationCatalog,
  type AutomationRule,
  type DryRunResult,
  type RuleAction,
  type RuleCondition,
} from '../../services/automation.service';

/**
 * The rule builder — the hardest screen in this phase for accessibility.
 *
 * FOUR THINGS IT MUST GET RIGHT, and each is a way dynamic forms usually fail:
 *
 * 1. REORDERING WITHOUT A POINTER. This list controls EXECUTION ORDER (FR-060),
 *    so a drag handle alone would put a functional decision out of reach of
 *    keyboard users. Move-up and move-down buttons are the primary control; a
 *    drag affordance would be an addition, never the only route.
 *
 * 2. EACH ROW NAMES ITSELF. A fieldset per condition and per action, with a
 *    legend giving its ordinal, so a screen-reader user knows which of five
 *    rows they are in rather than hearing "combo box" five times.
 *
 * 3. FOCUS IS NEVER DROPPED. Adding a row moves focus into it; removing one
 *    moves focus to the next row, or to the add button when it was the last.
 *
 * 4. DEPENDENT SELECTS RESET, AND SAY SO. Changing a condition's field clears
 *    its operator and value to that field's permitted set, and announces it —
 *    a stale operator left selected is how an invalid rule reaches the
 *    validator.
 */

const { t } = useI18n();

const catalog = ref<AutomationCatalog | null>(null);
const rules = ref<AutomationRule[]>([]);
const loading = ref(false);
const saving = ref(false);
const editing = ref<AutomationRule | null>(null);
const builderOpen = ref(false);
const dryRun = ref<DryRunResult | null>(null);
const errorKey = ref<string | null>(null);
const announcement = ref('');

const draft = ref<{
  name: string;
  triggerKey: string;
  conditions: RuleCondition[];
  actions: RuleAction[];
}>({ name: '', triggerKey: 'ticket.created', conditions: [], actions: [] });

async function load(): Promise<void> {
  loading.value = true;

  try {
    const [rulesResult, catalogResult] = await Promise.all([listRules(), getCatalog()]);
    rules.value = rulesResult;
    catalog.value = catalogResult;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

/** Fields the chosen trigger can actually evaluate — the validator's rule. */
const availableFields = computed(
  () =>
    catalog.value?.conditionFields.filter(
      (field) => !field.onlyForTriggers || field.onlyForTriggers.includes(draft.value.triggerKey),
    ) ?? [],
);

function fieldFor(key: string) {
  return catalog.value?.conditionFields.find((field) => field.key === key) ?? null;
}

function actionFor(key: string) {
  return catalog.value?.actions.find((action) => action.key === key) ?? null;
}

function startCreate(): void {
  editing.value = null;
  dryRun.value = null;
  errorKey.value = null;
  draft.value = { name: '', triggerKey: 'ticket.created', conditions: [], actions: [] };
  builderOpen.value = true;
}

function startEdit(rule: AutomationRule): void {
  editing.value = rule;
  dryRun.value = null;
  errorKey.value = null;
  draft.value = {
    name: rule.name,
    triggerKey: rule.triggerKey,
    conditions: rule.conditions.map((condition) => ({ ...condition })),
    actions: rule.actions.map((action) => ({ ...action, params: { ...action.params } })),
  };
  builderOpen.value = true;
}

async function focusRow(selector: string): Promise<void> {
  await nextTick();
  document.querySelector<HTMLElement>(selector)?.focus();
}

function addCondition(): void {
  const field = availableFields.value[0];
  if (!field) return;

  draft.value.conditions.push({
    field: field.key,
    operator: field.operators[0] as string,
    value: field.values[0] as string,
  });

  void focusRow(`[data-condition-index="${draft.value.conditions.length - 1}"] select`);
}

function removeCondition(index: number): void {
  draft.value.conditions.splice(index, 1);

  // Focus the row that took its place, or the add button when it was the last.
  void focusRow(
    draft.value.conditions.length > index
      ? `[data-condition-index="${index}"] select`
      : '[data-add-condition]',
  );
}

/**
 * Changing the field RESETS operator and value, and announces it.
 *
 * Leaving a stale operator selected is how an invalid rule reaches the
 * validator — and a silent reset leaves a screen-reader user with no idea their
 * other choices changed underneath them.
 */
function onFieldChange(condition: RuleCondition): void {
  const field = fieldFor(condition.field);
  if (!field) return;

  condition.operator = field.operators[0] as string;
  condition.value = field.values[0] as string;
  announcement.value = t('automation.builder.resetAnnounced');
}

function addAction(): void {
  const action = catalog.value?.actions[0];
  if (!action) return;

  draft.value.actions.push({ action: action.key, params: {} });
  void focusRow(`[data-action-index="${draft.value.actions.length - 1}"] select`);
}

function removeAction(index: number): void {
  draft.value.actions.splice(index, 1);

  void focusRow(
    draft.value.actions.length > index
      ? `[data-action-index="${index}"] select`
      : '[data-add-action]',
  );
}

async function save(): Promise<void> {
  saving.value = true;
  errorKey.value = null;

  try {
    if (editing.value) {
      await updateRule(editing.value.id, { ...draft.value, version: editing.value.version });
    } else {
      await createRule(draft.value);
    }

    builderOpen.value = false;
    await load();
  } catch (error) {
    if (error instanceof ApiError) {
      errorKey.value = error.details[0]?.message ?? 'error.unexpected';
    } else {
      throw error;
    }
  } finally {
    saving.value = false;
  }
}

async function runDryRun(): Promise<void> {
  const id = editing.value?.id ?? 0;
  dryRun.value = await dryRunRule(id, draft.value);
}

async function move(index: number, delta: number): Promise<void> {
  const next = index + delta;
  if (next < 0 || next >= rules.value.length) return;

  const ids = rules.value.map((rule) => rule.id);
  const [moved] = ids.splice(index, 1);
  ids.splice(next, 0, moved as number);

  rules.value = await reorderRules(ids);
  // Keep focus with the row that moved, not with the position it left.
  void focusRow(`[data-rule-index="${next}"] [data-move-up]`);
}

async function toggle(rule: AutomationRule): Promise<void> {
  if (rule.isEnabled) await disableRule(rule.id);
  else await enableRule(rule.id);

  await load();
}

async function remove(rule: AutomationRule): Promise<void> {
  await deleteRule(rule.id);
  await load();
}
</script>

<template>
  <section class="space-y-4">
    <header class="flex items-start justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold">{{ t('automation.title') }}</h1>
        <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {{ t('automation.description') }}
        </p>
      </div>
      <button type="button" class="rounded bg-sky-600 px-3 py-2 text-white" @click="startCreate">
        {{ t('automation.create') }}
      </button>
    </header>

    <!-- Announcements for dependent-select resets and reordering. -->
    <p aria-live="polite" class="sr-only">{{ announcement }}</p>

    <p v-if="loading">{{ t('table.loading') }}</p>
    <p v-else-if="rules.length === 0" class="text-sm text-slate-600">{{ t('automation.empty') }}</p>

    <table v-else class="w-full text-sm">
      <thead>
        <tr>
          <th scope="col" class="p-2 text-start">{{ t('automation.column.order') }}</th>
          <th scope="col" class="p-2 text-start">{{ t('automation.column.name') }}</th>
          <th scope="col" class="p-2 text-start">{{ t('automation.column.trigger') }}</th>
          <th scope="col" class="p-2 text-start">{{ t('automation.column.enabled') }}</th>
          <th scope="col" class="p-2 text-start">{{ t('action.edit') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(rule, index) in rules" :key="rule.id" class="border-t" :data-rule-index="index">
          <td class="p-2">
            <!-- KEYBOARD-OPERABLE REORDERING. This list controls execution
                 order, so it cannot be drag-only. -->
            <button
              type="button"
              data-move-up
              class="px-1"
              :disabled="index === 0"
              :aria-label="`${t('automation.moveUp')}: ${rule.name}`"
              @click="move(index, -1)"
            >
              ↑
            </button>
            <button
              type="button"
              data-move-down
              class="px-1"
              :disabled="index === rules.length - 1"
              :aria-label="`${t('automation.moveDown')}: ${rule.name}`"
              @click="move(index, 1)"
            >
              ↓
            </button>
          </td>
          <td class="p-2">{{ rule.name }}</td>
          <td class="p-2">
            {{
              t(
                catalog?.triggers.find((item) => item.key === rule.triggerKey)?.nameKey ??
                  rule.triggerKey,
              )
            }}
          </td>
          <td class="p-2">
            <button type="button" class="underline" @click="toggle(rule)">
              {{ rule.isEnabled ? t('automation.disable') : t('automation.enable') }}
            </button>
          </td>
          <td class="p-2">
            <button type="button" class="underline" @click="startEdit(rule)">
              {{ t('action.edit') }}
            </button>
            <button type="button" class="ms-3 underline" @click="remove(rule)">
              {{ t('automation.delete') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <form v-if="builderOpen && catalog" class="space-y-4 rounded border p-4" @submit.prevent="save">
      <div>
        <label class="block text-sm" for="rule-name">{{ t('sla.field.name') }}</label>
        <input id="rule-name" v-model="draft.name" class="w-full rounded border p-2" />
      </div>

      <fieldset>
        <legend class="text-sm font-medium">{{ t('automation.builder.when') }}</legend>
        <div class="mt-1 space-y-1">
          <label
            v-for="trigger in catalog.triggers"
            :key="trigger.key"
            class="flex items-center gap-2 text-sm"
          >
            <input v-model="draft.triggerKey" type="radio" :value="trigger.key" />
            {{ t(trigger.nameKey) }}
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend class="text-sm font-medium">{{ t('automation.builder.if') }}</legend>
        <!-- FR-059 in words. And/or is exactly what a user assumes wrongly. -->
        <p class="text-sm text-slate-600 dark:text-slate-400">
          {{ t('automation.builder.allConditionsMustHold') }}
        </p>

        <fieldset
          v-for="(condition, index) in draft.conditions"
          :key="index"
          class="mt-2 flex flex-wrap items-end gap-2 border-s ps-3"
          :data-condition-index="index"
        >
          <legend class="text-xs text-slate-500">
            {{ t('automation.builder.conditionN', { n: index + 1 }) }}
          </legend>

          <select
            v-model="condition.field"
            class="rounded border p-2"
            :aria-label="t('automation.builder.field')"
            @change="onFieldChange(condition)"
          >
            <option v-for="field in availableFields" :key="field.key" :value="field.key">
              {{ t(field.nameKey) }}
            </option>
          </select>

          <select
            v-model="condition.operator"
            class="rounded border p-2"
            :aria-label="t('automation.builder.operator')"
          >
            <option
              v-for="operator in fieldFor(condition.field)?.operators ?? []"
              :key="operator"
              :value="operator"
            >
              {{ t(`automation.operator.${operator}`) }}
            </option>
          </select>

          <select
            v-model="condition.value"
            class="rounded border p-2"
            :aria-label="t('automation.builder.value')"
          >
            <option
              v-for="value in fieldFor(condition.field)?.values ?? []"
              :key="value"
              :value="value"
            >
              {{ value }}
            </option>
          </select>

          <button type="button" class="underline" @click="removeCondition(index)">
            {{ t('automation.builder.removeCondition') }}
          </button>
        </fieldset>

        <button
          type="button"
          data-add-condition
          class="mt-2 rounded border px-2 py-1 text-sm"
          @click="addCondition"
        >
          {{ t('automation.builder.addCondition') }}
        </button>
      </fieldset>

      <fieldset>
        <legend class="text-sm font-medium">{{ t('automation.builder.then') }}</legend>

        <fieldset
          v-for="(action, index) in draft.actions"
          :key="index"
          class="mt-2 flex flex-wrap items-end gap-2 border-s ps-3"
          :data-action-index="index"
        >
          <legend class="text-xs text-slate-500">
            {{ t('automation.builder.actionN', { n: index + 1 }) }}
          </legend>

          <select
            v-model="action.action"
            class="rounded border p-2"
            :aria-label="t('automation.builder.action')"
            @change="action.params = {}"
          >
            <option v-for="option in catalog.actions" :key="option.key" :value="option.key">
              {{ t(option.nameKey) }}
            </option>
          </select>

          <template v-for="param in actionFor(action.action)?.params ?? []" :key="param.key">
            <select
              v-if="param.kind === 'enum'"
              v-model="action.params[param.key]"
              class="rounded border p-2"
              :aria-label="param.key"
            >
              <option v-for="value in param.values ?? []" :key="value" :value="value">
                {{ value }}
              </option>
            </select>
            <input
              v-else
              v-model="action.params[param.key]"
              class="rounded border p-2"
              :aria-label="param.key"
            />
          </template>

          <button type="button" class="underline" @click="removeAction(index)">
            {{ t('automation.builder.removeAction') }}
          </button>
        </fieldset>

        <button
          type="button"
          data-add-action
          class="mt-2 rounded border px-2 py-1 text-sm"
          @click="addAction"
        >
          {{ t('automation.builder.addAction') }}
        </button>
      </fieldset>

      <p v-if="errorKey" role="alert" class="rounded bg-red-50 p-2 text-sm text-red-900">
        {{ t(errorKey) }}
      </p>

      <div class="flex flex-wrap gap-2">
        <button type="submit" :disabled="saving" class="rounded bg-sky-600 px-3 py-2 text-white">
          {{ t('action.save') }}
        </button>
        <button v-if="editing" type="button" class="rounded border px-3 py-2" @click="runDryRun">
          {{ t('automation.dryRun.run') }}
        </button>
        <button type="button" class="rounded border px-3 py-2" @click="builderOpen = false">
          {{ t('action.cancel') }}
        </button>
      </div>

      <section v-if="dryRun" class="rounded bg-slate-50 p-3 text-sm dark:bg-slate-800">
        <h3 class="font-medium">{{ t('automation.dryRun.title') }}</h3>
        <!-- Said plainly, because a preview that looks like an action is worse
             than no preview. -->
        <p>{{ t('automation.dryRun.noChangesMade') }}</p>

        <p v-if="dryRun.matched.length === 0">{{ t('automation.dryRun.none') }}</p>
        <template v-else>
          <p>
            {{
              t('automation.dryRun.matched', {
                count: dryRun.matched.length,
                sample: dryRun.sampleSize,
              })
            }}
          </p>
          <ul class="mt-1 list-disc ps-5">
            <li v-for="entry in dryRun.matched" :key="entry.ticket.id">
              {{ entry.ticket.subject }}
            </li>
          </ul>
        </template>
      </section>
    </form>
  </section>
</template>
