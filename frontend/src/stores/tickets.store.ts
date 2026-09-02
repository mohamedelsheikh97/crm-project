import { defineStore } from 'pinia';
import { ref } from 'vue';

import type { TicketCategory, TicketPriority, TicketStatus } from '../services/tickets.service';

/**
 * Filter state for the ticket list, kept in a store so returning from a ticket
 * does not lose the queue the user had built — the same reasoning Phase 2 used
 * for the customer search, and it matters more here, where filters ARE the
 * primary interaction.
 *
 * The filters are also mirrored into the query string by the list view, so a
 * filtered queue is shareable and survives a reload. The store is what makes
 * back-navigation cheap; the URL is what makes it durable.
 */
export const useTicketsStore = defineStore('tickets', () => {
  const q = ref('');
  const status = ref<TicketStatus[]>([]);
  const priority = ref<TicketPriority[]>([]);
  const category = ref<TicketCategory[]>([]);
  const assigneeId = ref<number | 'unassigned' | undefined>(undefined);
  /**
   * A creation-date range, added for reporting drill-through (Phase 10,
   * FR-001, FR-034).
   *
   * ISO date strings, because that is what a report's period filter already
   * speaks and what the URL has to carry anyway. The server resolves them to
   * instants; nothing here re-parses them.
   */
  const createdFrom = ref<string | undefined>(undefined);
  const createdTo = ref<string | undefined>(undefined);
  const includeMerged = ref(false);
  const sort = ref('-updatedAt');
  const page = ref(1);

  function reset(): void {
    q.value = '';
    status.value = [];
    priority.value = [];
    category.value = [];
    assigneeId.value = undefined;
    createdFrom.value = undefined;
    createdTo.value = undefined;
    includeMerged.value = false;
    sort.value = '-updatedAt';
    page.value = 1;
  }

  /** True when anything is narrowing the list — the empty state depends on it. */
  function hasFilters(): boolean {
    return (
      q.value.trim() !== '' ||
      status.value.length > 0 ||
      priority.value.length > 0 ||
      category.value.length > 0 ||
      assigneeId.value !== undefined ||
      createdFrom.value !== undefined ||
      createdTo.value !== undefined ||
      includeMerged.value
    );
  }

  return {
    q,
    status,
    priority,
    category,
    assigneeId,
    createdFrom,
    createdTo,
    includeMerged,
    sort,
    page,
    reset,
    hasFilters,
  };
});
