<script setup lang="ts">
import type { Task } from '../../services/tasks.service';
import DueDateBadge from './DueDateBadge.vue';

/**
 * The signed-in agent's outstanding commitments (FR-057).
 *
 * There is deliberately no owner column and no "assign to" control: tasks are
 * personal (Clarifications Q3). If a later phase makes them assignable, that is
 * an additive change here — not a field that was left out by accident.
 */
defineProps<{ items: Task[]; loading: boolean }>();

const emit = defineEmits<{
  (event: 'complete', id: number): void;
  (event: 'reopen', id: number): void;
}>();
</script>

<template>
  <section :aria-label="$t('task.list.label')">
    <p v-if="loading" class="py-4 text-sm text-slate-500">{{ $t('table.loading') }}</p>

    <p v-else-if="items.length === 0" class="py-4 text-sm text-slate-600 dark:text-slate-400">
      {{ $t('task.empty') }}
    </p>

    <ul v-else class="divide-y divide-slate-100 dark:divide-slate-800">
      <li v-for="task in items" :key="task.id" class="flex items-center gap-3 py-2">
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium">{{ task.title }}</p>

          <p class="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
            <DueDateBadge :due-at="task.dueAt" :is-overdue="task.isOverdue" />

            <RouterLink
              v-if="task.ticket"
              :to="{ name: 'ticket-detail', params: { id: task.ticket.id } }"
              class="rounded font-mono text-blue-700 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-blue-300"
            >
              {{ task.ticket.reference }}
            </RouterLink>

            <RouterLink
              v-else-if="task.customer"
              :to="{ name: 'customer-profile', params: { id: task.customer.id } }"
              class="rounded text-blue-700 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-blue-300"
            >
              {{ task.customer.displayName }}
            </RouterLink>
          </p>
        </div>

        <button
          v-if="task.completedAt === null"
          type="button"
          class="rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-600"
          @click="emit('complete', task.id)"
        >
          {{ $t('task.complete') }}
        </button>

        <button
          v-else
          type="button"
          class="rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-600"
          @click="emit('reopen', task.id)"
        >
          {{ $t('task.reopen') }}
        </button>
      </li>
    </ul>
  </section>
</template>
