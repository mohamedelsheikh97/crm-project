<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import TicketFilters from '../../components/tickets/TicketFilters.vue';
import TicketPriorityBadge from '../../components/tickets/TicketPriorityBadge.vue';
import TicketStatusBadge from '../../components/tickets/TicketStatusBadge.vue';
import { usePermissions } from '../../composables/usePermissions';
import { ApiError } from '../../services/http';
import * as ticketsService from '../../services/tickets.service';
import type {
  TicketCategory,
  TicketPriority,
  TicketStatus,
  TicketSummary,
} from '../../services/tickets.service';
import { useTicketsStore } from '../../stores/tickets.store';

const { t, locale } = useI18n();
const { can } = usePermissions();
const route = useRoute();
const router = useRouter();
const filters = useTicketsStore();

const tickets = ref<TicketSummary[]>([]);
const total = ref(0);
const pageSize = ref(20);
const loading = ref(false);
const error = ref<string | null>(null);

/** Announced, so a filter change is perceivable without watching the table. */
const announcement = ref('');

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

function asList<T extends string>(value: unknown): T[] {
  if (typeof value === 'string') return [value as T];
  if (Array.isArray(value)) return value.filter((item): item is T => typeof item === 'string');
  return [];
}

/**
 * The URL is the durable copy of the filter state; the store is what makes
 * back-navigation cheap. On mount the URL wins, so a shared link opens the
 * queue it describes.
 */
function readFromRoute(): void {
  const query = route.query;

  if (typeof query.q === 'string') filters.q = query.q;
  filters.status = asList<TicketStatus>(query.status);
  filters.priority = asList<TicketPriority>(query.priority);
  filters.category = asList<TicketCategory>(query.category);
  filters.includeMerged = query.includeMerged === 'true';
  if (typeof query.sort === 'string') filters.sort = query.sort;
  if (query.assigneeId === 'unassigned') filters.assigneeId = 'unassigned';
  else if (typeof query.assigneeId === 'string' && /^\d+$/.test(query.assigneeId)) {
    // A numeric assignee arrives from a report drill-through. Without this the
    // link would land on an unfiltered queue that disagrees with the figure it
    // came from — worse than no link, because it looks like a check.
    filters.assigneeId = Number(query.assigneeId);
  }
  if (typeof query.createdFrom === 'string') filters.createdFrom = query.createdFrom;
  if (typeof query.createdTo === 'string') filters.createdTo = query.createdTo;
  const page = Number(query.page);
  if (Number.isInteger(page) && page >= 1) filters.page = page;
}

function writeToRoute(): void {
  const query: Record<string, string | string[]> = {};

  if (filters.q.trim() !== '') query.q = filters.q.trim();
  if (filters.status.length) query.status = filters.status;
  if (filters.priority.length) query.priority = filters.priority;
  if (filters.category.length) query.category = filters.category;
  if (filters.assigneeId !== undefined) query.assigneeId = String(filters.assigneeId);
  if (filters.createdFrom) query.createdFrom = filters.createdFrom;
  if (filters.createdTo) query.createdTo = filters.createdTo;
  if (filters.includeMerged) query.includeMerged = 'true';
  if (filters.sort !== '-updatedAt') query.sort = filters.sort;
  if (filters.page > 1) query.page = String(filters.page);

  void router.replace({ query });
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    const result = await ticketsService.list({
      q: filters.q.trim() || undefined,
      status: filters.status,
      priority: filters.priority,
      category: filters.category,
      assigneeId: filters.assigneeId,
      createdFrom: filters.createdFrom,
      createdTo: filters.createdTo,
      includeMerged: filters.includeMerged,
      sort: filters.sort,
      page: filters.page,
    });

    tickets.value = result.items;
    total.value = result.total;
    pageSize.value = result.pageSize;
    announcement.value = t('tickets.resultCount', { count: result.total });
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : t('error.unexpected');
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  readFromRoute();
  void load();
});

function refresh(): void {
  writeToRoute();
  void load();
}

function sortBy(field: string): void {
  filters.sort = filters.sort === `-${field}` ? field : `-${field}`;
  filters.page = 1;
  refresh();
}

function goToPage(page: number): void {
  filters.page = Math.min(Math.max(1, page), totalPages.value);
  refresh();
}

const formatter = computed(
  () => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }),
);

function formatDate(value: string): string {
  return formatter.value.format(new Date(value));
}

// Two DIFFERENT empty states. "Nothing matches these filters" and "there are no
// tickets at all" call for different next actions, and offering to clear
// filters that are not set is noise.
const emptyIsFiltered = computed(() => total.value === 0 && filters.hasFilters());
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold">{{ t('tickets.title') }}</h1>
      <RouterLink
        v-if="can('tickets:create')"
        :to="{ name: 'ticket-new' }"
        class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white"
      >
        {{ t('tickets.create') }}
      </RouterLink>
    </header>

    <TicketFilters @change="refresh" />

    <!--
      THE DATE RANGE IS THE ONE FILTER WITH NO CONTROL OF ITS OWN.

      It arrives from a report drill-through, so a reader can land on a narrowed
      queue they did not set. An invisible filter is a trap: the counts look
      wrong, nothing explains why, and there is nothing to switch off. This says
      what is applied and offers the switch.
    -->
    <p
      v-if="filters.createdFrom || filters.createdTo"
      class="flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 p-2 text-sm dark:border-blue-900 dark:bg-blue-950"
    >
      <span>
        {{
          t('tickets.filteredByPeriod', {
            from: filters.createdFrom ?? '—',
            to: filters.createdTo ?? '—',
          })
        }}
      </span>
      <button
        type="button"
        class="rounded-md border px-2 py-1"
        @click="
          filters.createdFrom = undefined;
          filters.createdTo = undefined;
          refresh();
        "
      >
        {{ t('tickets.clearPeriod') }}
      </button>
    </p>

    <p aria-live="polite" class="sr-only">{{ announcement }}</p>

    <p v-if="error" class="rounded-md bg-red-50 p-3 text-red-900 dark:bg-red-950 dark:text-red-100">
      {{ error }}
    </p>

    <p v-else-if="loading">{{ t('table.loading') }}</p>

    <div v-else-if="tickets.length === 0" class="rounded-md border border-dashed p-8 text-center">
      <p class="font-medium">
        {{ emptyIsFiltered ? t('tickets.empty.filtered') : t('tickets.empty.none') }}
      </p>
      <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">
        {{ emptyIsFiltered ? t('tickets.empty.filteredHint') : t('tickets.empty.noneHint') }}
      </p>
      <button
        v-if="emptyIsFiltered"
        type="button"
        class="mt-4 rounded-md border px-3 py-2 text-sm"
        @click="
          filters.reset();
          refresh();
        "
      >
        {{ t('action.clearFilters') }}
      </button>
    </div>

    <!-- The table scrolls inside its own container so the page body never
         scrolls horizontally, in either direction. -->
    <div v-else class="overflow-x-auto">
      <table class="w-full text-start text-sm">
        <caption class="sr-only">
          {{
            t('tickets.caption')
          }}
        </caption>
        <thead class="border-b text-xs uppercase">
          <tr>
            <th scope="col" class="px-3 py-2 text-start">{{ t('tickets.column.reference') }}</th>
            <th scope="col" class="px-3 py-2 text-start">{{ t('tickets.column.subject') }}</th>
            <th scope="col" class="px-3 py-2 text-start">{{ t('tickets.column.customer') }}</th>
            <th scope="col" class="px-3 py-2 text-start">{{ t('tickets.column.status') }}</th>
            <th scope="col" class="px-3 py-2 text-start">
              <button type="button" class="font-inherit" @click="sortBy('priority')">
                {{ t('tickets.column.priority') }}
              </button>
            </th>
            <th scope="col" class="px-3 py-2 text-start">{{ t('tickets.column.assignee') }}</th>
            <th scope="col" class="px-3 py-2 text-start">
              <button type="button" class="font-inherit" @click="sortBy('updatedAt')">
                {{ t('tickets.column.updated') }}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="ticket in tickets" :key="ticket.id" class="border-b">
            <td class="px-3 py-2">
              <!-- Latin-digit and left-to-right in both locales, isolated so
                   bidirectional reordering cannot rearrange it mid-sentence. -->
              <RouterLink
                :to="{ name: 'ticket-detail', params: { id: ticket.id } }"
                class="font-mono text-blue-700 underline dark:text-blue-300"
                dir="ltr"
              >
                {{ ticket.reference }}
              </RouterLink>
            </td>
            <td class="px-3 py-2">{{ ticket.subject }}</td>
            <td class="px-3 py-2">{{ ticket.customer?.displayName ?? '—' }}</td>
            <td class="px-3 py-2"><TicketStatusBadge :status="ticket.status" /></td>
            <td class="px-3 py-2"><TicketPriorityBadge :priority="ticket.priority" /></td>
            <td class="px-3 py-2">
              {{ ticket.assignee?.fullName ?? t('tickets.filter.unassigned') }}
            </td>
            <td class="px-3 py-2">{{ formatDate(ticket.updatedAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <nav
      v-if="totalPages > 1"
      class="flex items-center justify-between"
      :aria-label="t('pagination.label')"
    >
      <!-- The icons are mirrored by the logical layout, not by a conditional:
           in RTL, "next" points left because the row itself is reversed. -->
      <button
        type="button"
        class="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        :disabled="filters.page <= 1"
        @click="goToPage(filters.page - 1)"
      >
        {{ t('pagination.previous') }}
      </button>
      <span class="text-sm">
        {{ t('pagination.position', { page: filters.page, total: totalPages }) }}
      </span>
      <button
        type="button"
        class="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        :disabled="filters.page >= totalPages"
        @click="goToPage(filters.page + 1)"
      >
        {{ t('pagination.next') }}
      </button>
    </nav>
  </div>
</template>
