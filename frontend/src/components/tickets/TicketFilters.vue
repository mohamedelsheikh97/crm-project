<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from '../../services/tickets.service';
import { useTicketsStore } from '../../stores/tickets.store';

/**
 * Filters are the primary interaction on the ticket list, so every change is
 * announced and every value ends up in the query string — a filtered queue is
 * shareable and survives a reload.
 */
const emit = defineEmits<{ change: [] }>();

const { t } = useI18n();
const filters = useTicketsStore();

function toggle<T extends string>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function toggleStatus(status: TicketStatus): void {
  filters.status = toggle(filters.status, status);
  filters.page = 1;
  emit('change');
}

function togglePriority(priority: TicketPriority): void {
  filters.priority = toggle(filters.priority, priority);
  filters.page = 1;
  emit('change');
}

function toggleCategory(category: TicketCategory): void {
  filters.category = toggle(filters.category, category);
  filters.page = 1;
  emit('change');
}

function onSearch(): void {
  filters.page = 1;
  emit('change');
}

function onAssignee(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  filters.assigneeId = value === '' ? undefined : value === 'unassigned' ? 'unassigned' : undefined;
  filters.page = 1;
  emit('change');
}

function onIncludeMerged(): void {
  filters.page = 1;
  emit('change');
}

function clear(): void {
  filters.reset();
  emit('change');
}

const active = computed(() => filters.hasFilters());

/**
 * A pill is a toggle button, not a checkbox styled as one — `aria-pressed` is
 * what tells a screen reader it is currently on.
 */
function pillClass(selected: boolean): string {
  return selected
    ? 'border-blue-600 bg-blue-600 text-white'
    : 'border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200';
}
</script>

<template>
  <section class="space-y-4" :aria-label="t('tickets.filters.label')">
    <div class="flex flex-wrap items-end gap-3">
      <div class="grow">
        <label class="block text-sm font-medium" for="ticket-search">
          {{ t('tickets.search') }}
        </label>
        <input
          id="ticket-search"
          v-model="filters.q"
          type="search"
          class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-start dark:border-slate-600 dark:bg-slate-800"
          :placeholder="t('tickets.search.placeholder')"
          @keyup.enter="onSearch"
          @search="onSearch"
        />
      </div>

      <div>
        <label class="block text-sm font-medium" for="ticket-assignee">
          {{ t('tickets.filter.assignee') }}
        </label>
        <select
          id="ticket-assignee"
          class="mt-1 rounded-md border border-slate-300 px-3 py-2 text-start dark:border-slate-600 dark:bg-slate-800"
          @change="onAssignee"
        >
          <option value="">{{ t('tickets.filter.anyAssignee') }}</option>
          <option value="unassigned">{{ t('tickets.filter.unassigned') }}</option>
        </select>
      </div>

      <label class="flex items-center gap-2 pb-2 text-sm">
        <input
          v-model="filters.includeMerged"
          type="checkbox"
          class="size-4"
          @change="onIncludeMerged"
        />
        {{ t('tickets.filter.includeMerged') }}
      </label>

      <button
        v-if="active"
        type="button"
        class="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600"
        @click="clear"
      >
        {{ t('action.clearFilters') }}
      </button>
    </div>

    <fieldset>
      <legend class="text-sm font-medium">{{ t('tickets.filter.status') }}</legend>
      <div class="mt-2 flex flex-wrap gap-2">
        <button
          v-for="status in TICKET_STATUSES"
          :key="status"
          type="button"
          class="rounded-full border px-3 py-1 text-xs"
          :class="pillClass(filters.status.includes(status))"
          :aria-pressed="filters.status.includes(status)"
          @click="toggleStatus(status)"
        >
          {{ t(`ticket.status.${status}`) }}
        </button>
      </div>
    </fieldset>

    <fieldset>
      <legend class="text-sm font-medium">{{ t('tickets.filter.priority') }}</legend>
      <div class="mt-2 flex flex-wrap gap-2">
        <button
          v-for="priority in TICKET_PRIORITIES"
          :key="priority"
          type="button"
          class="rounded-full border px-3 py-1 text-xs"
          :class="pillClass(filters.priority.includes(priority))"
          :aria-pressed="filters.priority.includes(priority)"
          @click="togglePriority(priority)"
        >
          {{ t(`ticket.priority.${priority}`) }}
        </button>
      </div>
    </fieldset>

    <fieldset>
      <legend class="text-sm font-medium">{{ t('tickets.filter.category') }}</legend>
      <div class="mt-2 flex flex-wrap gap-2">
        <button
          v-for="category in TICKET_CATEGORIES"
          :key="category"
          type="button"
          class="rounded-full border px-3 py-1 text-xs"
          :class="pillClass(filters.category.includes(category))"
          :aria-pressed="filters.category.includes(category)"
          @click="toggleCategory(category)"
        >
          {{ t(`ticket.category.${category}`) }}
        </button>
      </div>
    </fieldset>
  </section>
</template>
