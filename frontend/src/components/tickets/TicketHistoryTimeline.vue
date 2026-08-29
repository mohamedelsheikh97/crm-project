<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { ApiError } from '../../services/http';
import * as ticketsService from '../../services/tickets.service';
import type { HistoryEntry } from '../../services/tickets.service';

const props = defineProps<{ ticketId: number; ticketReference: string }>();

const { t, locale } = useI18n();

const entries = ref<HistoryEntry[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    entries.value = (await ticketsService.history(props.ticketId, { pageSize: 200 })).items;
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : t('error.unexpected');
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => props.ticketId, load);

defineExpose({ reload: load });

const formatter = computed(
  () => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }),
);

const STATUS_FIELDS = new Set(['status']);
const TAXONOMY_FIELDS: Record<string, string> = { category: 'category', priority: 'priority' };

/**
 * A stored value is a KEY when the field holds one. Showing `new → open` in an
 * Arabic interface would be showing the database to the user.
 */
function renderValue(field: string | null, value: string | null): string {
  if (value === null || value === '') return t('ticket.history.empty');
  if (field && STATUS_FIELDS.has(field)) return t(`ticket.status.${value}`);

  const taxonomy = field ? TAXONOMY_FIELDS[field] : undefined;
  if (taxonomy) return t(`ticket.${taxonomy}.${value}`);

  return value;
}

function labelFor(entry: HistoryEntry): string {
  return t(`ticket.history.event.${entry.event}`);
}

/**
 * Whether this entry happened to a DIFFERENT ticket — one absorbed by a merge.
 * A spanning history stays readable only if each entry says where it came from.
 */
function isForeign(entry: HistoryEntry): boolean {
  return entry.ticketId !== props.ticketId;
}
</script>

<template>
  <section class="space-y-3">
    <h2 class="text-lg font-semibold">{{ t('ticket.history.title') }}</h2>

    <p
      v-if="error"
      class="rounded-md bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
    >
      {{ error }}
    </p>

    <p v-else-if="loading">{{ t('table.loading') }}</p>

    <p v-else-if="entries.length === 0" class="text-sm text-slate-600 dark:text-slate-300">
      {{ t('ticket.history.none') }}
    </p>

    <!-- An ordered list, because it IS an ordered list of events and that is
         what it should announce as. OLDEST FIRST (FR-035): this is read from
         the beginning to understand a ticket, not scanned for the latest. -->
    <ol v-else class="space-y-3 border-s ps-4">
      <li v-for="entry in entries" :key="entry.id" class="relative">
        <div class="flex flex-wrap items-baseline gap-2">
          <span class="font-medium">{{ labelFor(entry) }}</span>
          <span class="text-sm text-slate-600 dark:text-slate-300">
            {{ entry.actorName }}
          </span>
          <time :datetime="entry.createdAt" class="text-xs text-slate-500 dark:text-slate-400">
            {{ formatter.format(new Date(entry.createdAt)) }}
          </time>
          <span
            v-if="isForeign(entry)"
            class="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800"
          >
            {{ t('ticket.history.fromMerged') }}
          </span>
        </div>

        <p v-if="entry.field && (entry.previousValue || entry.newValue)" class="mt-1 text-sm">
          {{ t(`ticket.history.field.${entry.field}`) }}:
          <span class="line-through">{{ renderValue(entry.field, entry.previousValue) }}</span>
          →
          <span class="font-medium">{{ renderValue(entry.field, entry.newValue) }}</span>
        </p>

        <p v-if="entry.note" class="mt-1 text-sm text-slate-700 dark:text-slate-200">
          {{ entry.note }}
        </p>
      </li>
    </ol>
  </section>
</template>
