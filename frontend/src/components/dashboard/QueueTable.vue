<script setup lang="ts">
import { computed } from 'vue';

import type { QueueItem, QueueSort } from '../../services/dashboard.service';
import TicketPriorityBadge from '../tickets/TicketPriorityBadge.vue';
import TicketStatusBadge from '../tickets/TicketStatusBadge.vue';
import DueDateBadge from './DueDateBadge.vue';

/**
 * The queue itself: everything an agent needs to decide what to touch first,
 * without opening anything (FR-002).
 *
 * There is deliberately NO assign or claim control on this table. Phase 3 fixed
 * assignment as Supervisor-only, and stated that this dashboard is read-only
 * with respect to it (FR-012). The absence is the requirement, not an
 * oversight — do not add one here.
 */
const props = defineProps<{
  items: QueueItem[];
  loading: boolean;
  sort: QueueSort;
  direction: 'asc' | 'desc';
  /** Distinguishes "nothing to do" from "your filter hid everything". */
  hasFilters: boolean;
}>();

const emit = defineEmits<{
  (event: 'sort', field: QueueSort): void;
  (event: 'clear-filters'): void;
}>();

interface Column {
  key: QueueSort | null;
  labelKey: string;
}

const COLUMNS: Column[] = [
  { key: null, labelKey: 'dashboard.column.reference' },
  { key: null, labelKey: 'dashboard.column.subject' },
  { key: null, labelKey: 'dashboard.column.customer' },
  { key: 'status', labelKey: 'dashboard.column.status' },
  { key: 'priority', labelKey: 'dashboard.column.priority' },
  { key: 'age', labelKey: 'dashboard.column.waiting' },
  { key: 'dueAt', labelKey: 'dashboard.column.dueAt' },
];

const isEmpty = computed(() => !props.loading && props.items.length === 0);

/**
 * Announced to assistive technology as well as shown, so sorting is not a
 * visual-only affordance.
 */
function ariaSort(column: Column): 'ascending' | 'descending' | 'none' | undefined {
  if (column.key === null) return undefined;
  if (column.key !== props.sort) return 'none';
  return props.direction === 'asc' ? 'ascending' : 'descending';
}

function waitedSince(value: string): Date {
  return new Date(value);
}
</script>

<template>
  <div>
    <table class="w-full border-collapse text-start text-sm">
      <caption class="sr-only">
        {{
          $t('dashboard.queue.caption')
        }}
      </caption>
      <thead>
        <tr class="border-b border-slate-200 dark:border-slate-700">
          <th
            v-for="column in COLUMNS"
            :key="column.labelKey"
            scope="col"
            :aria-sort="ariaSort(column)"
            class="px-3 py-2 text-start font-medium text-slate-600 dark:text-slate-300"
          >
            <!-- Sortable headers are real buttons: reachable by keyboard, with
                 a visible focus ring in both text directions (FR-082). -->
            <button
              v-if="column.key"
              type="button"
              class="inline-flex items-center gap-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              @click="emit('sort', column.key)"
            >
              {{ $t(column.labelKey) }}
              <span v-if="column.key === sort" aria-hidden="true">
                {{ direction === 'asc' ? '↑' : '↓' }}
              </span>
            </button>
            <span v-else>{{ $t(column.labelKey) }}</span>
          </th>
        </tr>
      </thead>

      <tbody>
        <tr v-if="loading">
          <td :colspan="COLUMNS.length" class="px-3 py-6 text-center text-slate-500">
            {{ $t('table.loading') }}
          </td>
        </tr>

        <tr
          v-for="item in items"
          v-else
          :key="item.id"
          class="border-b border-slate-100 dark:border-slate-800"
        >
          <td class="px-3 py-2">
            <RouterLink
              :to="{ name: 'ticket-detail', params: { id: item.id } }"
              class="rounded font-mono text-blue-700 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-blue-300"
            >
              {{ item.reference }}
            </RouterLink>
          </td>
          <td class="px-3 py-2">{{ item.subject }}</td>
          <td class="px-3 py-2">
            <span v-if="item.customer">{{ item.customer.displayName }}</span>
            <span v-else class="text-slate-500">—</span>
          </td>
          <td class="px-3 py-2"><TicketStatusBadge :status="item.status" /></td>
          <td class="px-3 py-2"><TicketPriorityBadge :priority="item.priority" /></td>
          <td class="px-3 py-2">
            <i18n-d
              tag="span"
              :value="waitedSince(item.waitingSince)"
              :format="{ dateStyle: 'medium' }"
            />
          </td>
          <td class="px-3 py-2">
            <DueDateBadge :due-at="item.dueAt" :is-overdue="item.isOverdue" />
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Two DIFFERENT empty states. "You have nothing to do" and "your filter
         hid everything" are not the same news, and showing the wrong one sends
         an agent looking for work that is right in front of them. -->
    <div v-if="isEmpty && hasFilters" class="px-3 py-8 text-center">
      <p class="font-medium">{{ $t('dashboard.queue.noMatches') }}</p>
      <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
        {{ $t('dashboard.queue.noMatchesHint') }}
      </p>
      <button
        type="button"
        class="mt-3 rounded border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-600"
        @click="emit('clear-filters')"
      >
        {{ $t('action.clearFilters') }}
      </button>
    </div>

    <div v-else-if="isEmpty" class="px-3 py-8 text-center">
      <p class="font-medium">{{ $t('dashboard.queue.empty') }}</p>
      <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
        {{ $t('dashboard.queue.emptyHint') }}
      </p>
    </div>
  </div>
</template>
