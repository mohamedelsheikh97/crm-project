<script setup lang="ts">
import { computed } from 'vue';

import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketPriority,
  type TicketStatus,
} from '../../services/tickets.service';

/**
 * Status, priority, and overdue filters, combinable (FR-007).
 *
 * Every one of these calls the SERVER — nothing here filters the loaded page.
 * Filtering the page would silently answer a different question than the agent
 * asked, and the answer would change with the page size (FR-008).
 */
defineProps<{
  status: TicketStatus[];
  priority: TicketPriority[];
  overdueOnly: boolean;
  includeClosed: boolean;
  hasFilters: boolean;
  total: number;
}>();

const emit = defineEmits<{
  (event: 'update:status', value: TicketStatus[]): void;
  (event: 'update:priority', value: TicketPriority[]): void;
  (event: 'update:overdueOnly', value: boolean): void;
  (event: 'update:includeClosed', value: boolean): void;
  (event: 'clear'): void;
}>();

// Closed has its own switch rather than sitting in the status list, because it
// is excluded by DEFAULT (FR-003) — presenting it as just another status would
// make its absence look like a bug.
const selectableStatuses = computed(() => TICKET_STATUSES.filter((status) => status !== 'closed'));

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}
</script>

<template>
  <section :aria-label="$t('dashboard.filters.label')" class="space-y-3">
    <fieldset>
      <legend class="text-sm font-medium">{{ $t('tickets.filter.status') }}</legend>
      <div class="mt-1 flex flex-wrap gap-2">
        <label
          v-for="option in selectableStatuses"
          :key="option"
          class="inline-flex items-center gap-1.5 rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-600"
        >
          <input
            type="checkbox"
            class="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            :checked="status.includes(option)"
            @change="emit('update:status', toggle(status, option))"
          />
          {{ $t(`ticket.status.${option}`) }}
        </label>
      </div>
    </fieldset>

    <fieldset>
      <legend class="text-sm font-medium">{{ $t('tickets.filter.priority') }}</legend>
      <div class="mt-1 flex flex-wrap gap-2">
        <label
          v-for="option in TICKET_PRIORITIES"
          :key="option"
          class="inline-flex items-center gap-1.5 rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-600"
        >
          <input
            type="checkbox"
            class="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            :checked="priority.includes(option)"
            @change="emit('update:priority', toggle(priority, option))"
          />
          {{ $t(`ticket.priority.${option}`) }}
        </label>
      </div>
    </fieldset>

    <div class="flex flex-wrap items-center gap-4">
      <label class="inline-flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          class="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          :checked="overdueOnly"
          @change="emit('update:overdueOnly', !overdueOnly)"
        />
        {{ $t('dashboard.filter.overdueOnly') }}
      </label>

      <label class="inline-flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          class="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          :checked="includeClosed"
          @change="emit('update:includeClosed', !includeClosed)"
        />
        {{ $t('dashboard.filter.includeClosed') }}
      </label>

      <!-- Visible whenever anything is narrowing the queue, so the agent can
           always tell that they are looking at a subset. -->
      <button
        v-if="hasFilters"
        type="button"
        class="rounded border border-slate-300 px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-600"
        @click="emit('clear')"
      >
        {{ $t('action.clearFilters') }}
      </button>

      <p aria-live="polite" class="text-sm text-slate-600 dark:text-slate-400">
        {{ $t('dashboard.queue.resultCount', { count: total }) }}
      </p>
    </div>
  </section>
</template>
