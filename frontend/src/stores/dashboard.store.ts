import { defineStore } from 'pinia';
import { ref } from 'vue';

import type { QueueSort } from '../services/dashboard.service';
import type { TicketPriority, TicketStatus } from '../services/tickets.service';

/**
 * Queue filter and sort state.
 *
 * Kept in a store for the reason Phase 2 and 3 established: opening a ticket
 * and coming back must not lose the queue the agent had built. It matters more
 * here than anywhere else, because on this screen the filters ARE the work.
 */
export const useDashboardStore = defineStore('dashboard', () => {
  const status = ref<TicketStatus[]>([]);
  const priority = ref<TicketPriority[]>([]);
  const overdueOnly = ref(false);
  const includeClosed = ref(false);
  // Most urgent first is what an agent opening their queue means by "sort by
  // priority", so it is also the sensible default for the screen itself.
  const sort = ref<QueueSort>('priority');
  const direction = ref<'asc' | 'desc'>('desc');
  const page = ref(1);
  /** Whose queue a supervisor is looking at; undefined means "mine". */
  const viewUserId = ref<number | undefined>(undefined);

  function reset(): void {
    status.value = [];
    priority.value = [];
    overdueOnly.value = false;
    includeClosed.value = false;
    sort.value = 'priority';
    direction.value = 'desc';
    page.value = 1;
  }

  /**
   * True when something is narrowing the queue.
   *
   * The two empty states depend on this: "you have nothing to do" and "your
   * filter hid everything" are not the same news, and showing the wrong one
   * sends an agent looking for work that is right in front of them.
   */
  function hasFilters(): boolean {
    return (
      status.value.length > 0 ||
      priority.value.length > 0 ||
      overdueOnly.value ||
      includeClosed.value
    );
  }

  return {
    status,
    priority,
    overdueOnly,
    includeClosed,
    sort,
    direction,
    page,
    viewUserId,
    reset,
    hasFilters,
  };
});
