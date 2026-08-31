<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { ApiError } from '../../services/http';
import {
  addCalendarException,
  getCalendar,
  listAlertSubscriptions,
  removeCalendarException,
  replaceAlertSubscriptions,
  updateCalendar,
  type AlertEventSubscriptions,
  type BusinessCalendar,
} from '../../services/sla.service';

/**
 * The business calendar, and who is told when a commitment slips.
 *
 * TWO CONCERNS ON ONE SCREEN because they share a permission and an audience:
 * `sla:manage` covers both, and a person who defines a commitment and cannot
 * say who hears about a breach has half a feature.
 *
 * THE REASSURANCE LINE IS LOAD-BEARING. "Editing the calendar changes future
 * targets only" is the first question an administrator will have, and FR-029 is
 * what makes it true — a target's absolute time is stored when computed.
 * Answering it here is cheaper than answering it in support.
 */

const { t } = useI18n();

// Sunday first: it is both the storage order (bit 0) and the correct first day
// for this project's default locale.
const DAYS = [0, 1, 2, 3, 4, 5, 6];

const calendar = ref<BusinessCalendar | null>(null);
const events = ref<AlertEventSubscriptions[]>([]);
const loading = ref(false);
const saving = ref(false);
const savedKey = ref<string | null>(null);
const fieldErrors = ref<Record<string, string>>({});

const workingDays = ref<number[]>([]);
const timeZone = ref('');
const dayStart = ref('09:00');
const dayEnd = ref('17:00');
const newException = ref({ date: '', label: '' });

const zones = computed<string[]>(() => {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf;

  return supported ? supported('timeZone') : [timeZone.value];
});

function toTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function toMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

async function load(): Promise<void> {
  loading.value = true;

  try {
    const [current, subscriptions] = await Promise.all([getCalendar(), listAlertSubscriptions()]);

    calendar.value = current;
    workingDays.value = [...current.workingDays];
    timeZone.value = current.timeZone;
    dayStart.value = toTime(current.dayStartMinute);
    dayEnd.value = toTime(current.dayEndMinute);
    events.value = subscriptions;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function toggleDay(day: number): void {
  workingDays.value = workingDays.value.includes(day)
    ? workingDays.value.filter((value) => value !== day)
    : [...workingDays.value, day].sort();
}

async function save(): Promise<void> {
  if (!calendar.value) return;

  saving.value = true;
  fieldErrors.value = {};
  savedKey.value = null;

  try {
    await updateCalendar({
      timeZone: timeZone.value,
      workingDays: workingDays.value,
      dayStartMinute: toMinutes(dayStart.value),
      dayEndMinute: toMinutes(dayEnd.value),
      version: calendar.value.version,
    });

    savedKey.value = 'sla.calendar.saved';
    await load();
  } catch (error) {
    if (error instanceof ApiError) {
      for (const detail of error.details) fieldErrors.value[detail.field] = detail.message;
    } else {
      throw error;
    }
  } finally {
    saving.value = false;
  }
}

async function addException(): Promise<void> {
  if (newException.value.date === '') return;

  await addCalendarException({
    date: newException.value.date,
    label: newException.value.label.trim() === '' ? null : newException.value.label,
  });

  newException.value = { date: '', label: '' };
  await load();
}

async function removeException(id: number): Promise<void> {
  await removeCalendarException(id);
  await load();
}

async function saveAlerts(): Promise<void> {
  await replaceAlertSubscriptions(events.value);
  savedKey.value = 'alerts.saved';
}
</script>

<template>
  <section class="space-y-6">
    <header>
      <h1 class="text-xl font-semibold">{{ t('sla.calendar.title') }}</h1>
      <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
        {{ t('sla.calendar.description') }}
      </p>
      <!-- FR-029, stated where it will be asked. -->
      <p class="mt-2 rounded bg-slate-50 p-2 text-sm dark:bg-slate-800">
        {{ t('sla.calendar.noRetroactiveChange') }}
      </p>
    </header>

    <p v-if="savedKey" role="status" class="rounded bg-emerald-50 p-2 text-sm text-emerald-900">
      {{ t(savedKey) }}
    </p>

    <p v-if="loading">{{ t('table.loading') }}</p>

    <form v-else-if="calendar" class="space-y-4" @submit.prevent="save">
      <fieldset>
        <legend class="text-sm font-medium">{{ t('sla.calendar.workingDays') }}</legend>
        <div class="mt-2 flex flex-wrap gap-3">
          <label v-for="day in DAYS" :key="day" class="flex items-center gap-2 text-sm">
            <input type="checkbox" :checked="workingDays.includes(day)" @change="toggleDay(day)" />
            {{ t(`sla.day.${day}`) }}
          </label>
        </div>
        <p v-if="fieldErrors.workingDays" role="alert" class="text-sm text-red-700">
          {{ t(fieldErrors.workingDays) }}
        </p>
      </fieldset>

      <div class="grid grid-cols-3 gap-3">
        <div>
          <label class="block text-sm" for="day-start">{{ t('sla.calendar.dayStart') }}</label>
          <input id="day-start" v-model="dayStart" type="time" class="w-full rounded border p-2" />
        </div>
        <div>
          <label class="block text-sm" for="day-end">{{ t('sla.calendar.dayEnd') }}</label>
          <input id="day-end" v-model="dayEnd" type="time" class="w-full rounded border p-2" />
          <p v-if="fieldErrors.dayEndMinute" role="alert" class="text-sm text-red-700">
            {{ t(fieldErrors.dayEndMinute) }}
          </p>
        </div>
        <div>
          <label class="block text-sm" for="time-zone">{{ t('sla.calendar.timeZone') }}</label>
          <select id="time-zone" v-model="timeZone" class="w-full rounded border p-2">
            <option v-for="zone in zones" :key="zone" :value="zone">{{ zone }}</option>
          </select>
          <p v-if="fieldErrors.timeZone" role="alert" class="text-sm text-red-700">
            {{ t(fieldErrors.timeZone) }}
          </p>
        </div>
      </div>

      <button type="submit" :disabled="saving" class="rounded bg-sky-600 px-3 py-2 text-white">
        {{ t('action.save') }}
      </button>
    </form>

    <section v-if="calendar" class="space-y-2">
      <h2 class="font-medium">{{ t('sla.calendar.exceptions') }}</h2>

      <p v-if="calendar.exceptions.length === 0" class="text-sm text-slate-600">
        {{ t('sla.calendar.noExceptions') }}
      </p>

      <ul v-else class="space-y-1 text-sm">
        <li v-for="exception in calendar.exceptions" :key="exception.id" class="flex gap-3">
          <span>{{ exception.date }}</span>
          <span class="text-slate-600">{{ exception.label }}</span>
          <button type="button" class="underline" @click="removeException(exception.id)">
            {{ t('sla.calendar.removeException') }}
          </button>
        </li>
      </ul>

      <form class="flex flex-wrap items-end gap-2" @submit.prevent="addException">
        <div>
          <label class="block text-sm" for="exception-date">
            {{ t('sla.calendar.exceptionDate') }}
          </label>
          <input
            id="exception-date"
            v-model="newException.date"
            type="date"
            class="rounded border p-2"
          />
        </div>
        <div>
          <label class="block text-sm" for="exception-label">
            {{ t('sla.calendar.exceptionLabel') }}
          </label>
          <input id="exception-label" v-model="newException.label" class="rounded border p-2" />
        </div>
        <button type="submit" class="rounded border px-3 py-2">
          {{ t('sla.calendar.addException') }}
        </button>
      </form>
    </section>

    <section class="space-y-2">
      <h2 class="font-medium">{{ t('alerts.title') }}</h2>
      <p class="text-sm text-slate-600 dark:text-slate-400">{{ t('alerts.description') }}</p>
      <!-- FR-073 said out loud, so a disabled control does not read as broken. -->
      <p class="text-sm text-slate-600 dark:text-slate-400">{{ t('alerts.inAppAlwaysOn') }}</p>

      <table class="w-full text-sm">
        <thead>
          <tr>
            <th scope="col" class="p-2 text-start">{{ t('alerts.column.event') }}</th>
            <th scope="col" class="p-2 text-start">{{ t('alerts.column.recipient') }}</th>
            <th scope="col" class="p-2 text-start">{{ t('alerts.column.inApp') }}</th>
            <th scope="col" class="p-2 text-start">{{ t('alerts.column.email') }}</th>
            <th scope="col" class="p-2 text-start">{{ t('alerts.column.sms') }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="event in events" :key="event.eventKey">
            <tr v-for="(row, index) in event.subscriptions" :key="index" class="border-t">
              <td class="p-2">{{ t(`alerts.event.${event.eventKey}`) }}</td>
              <td class="p-2">
                {{
                  row.recipientKind === 'assignee'
                    ? t('alerts.recipient.assignee')
                    : t('alerts.recipient.role', { role: t(`role.name.${row.roleKey}`) })
                }}
              </td>
              <td class="p-2">
                <!--
                  SHOWN DISABLED, NEVER HIDDEN. A control that appears
                  adjustable and is not is worse than one shown as fixed.
                -->
                <input type="checkbox" checked disabled :aria-label="t('alerts.inAppAlwaysOn')" />
              </td>
              <td class="p-2"><input v-model="row.byEmail" type="checkbox" /></td>
              <td class="p-2">
                <input v-model="row.bySms" type="checkbox" />
                <span
                  v-if="row.bySms && row.unreachableForSms > 0"
                  class="ms-2 text-xs text-amber-700"
                >
                  {{
                    t(
                      'alerts.unreachableForSms',
                      { count: row.unreachableForSms },
                      row.unreachableForSms,
                    )
                  }}
                </span>
              </td>
            </tr>
          </template>
        </tbody>
      </table>

      <button type="button" class="rounded bg-sky-600 px-3 py-2 text-white" @click="saveAlerts">
        {{ t('action.save') }}
      </button>
    </section>
  </section>
</template>
