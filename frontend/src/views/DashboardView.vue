<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import QueueFilters from '../components/dashboard/QueueFilters.vue';
import QueueTable from '../components/dashboard/QueueTable.vue';
import TaskForm from '../components/dashboard/TaskForm.vue';
import TaskList from '../components/dashboard/TaskList.vue';
import { fetchQueue, type QueuePage, type QueueSort } from '../services/dashboard.service';
import * as adminUsersService from '../services/admin-users.service';
import type { AdminUser } from '../services/admin-users.service';
import { usePermissions } from '../composables/usePermissions';
import { useDashboardStore } from '../stores/dashboard.store';
import { useTasksStore } from '../stores/tasks.store';

/**
 * The screen an agent lives in.
 *
 * PLAN.md's Definition of done for this phase is "triage the whole queue from
 * one screen without navigating away", so the three regions below are all
 * visible at once rather than behind tabs — a tab is a navigation with extra
 * steps.
 *
 * THERE IS NO ASSIGN OR CLAIM CONTROL ANYWHERE ON THIS SCREEN. Phase 3 fixed
 * assignment as Supervisor-only and stated that this dashboard is read-only
 * with respect to it (FR-012). That absence is a decision, not an omission.
 */
const { can } = usePermissions();
const filters = useDashboardStore();
const tasks = useTasksStore();

const queue = ref<QueuePage | null>(null);
const loading = ref(false);
const submittingTask = ref(false);

/** Only rendered with dashboard:view_any — and the server refuses regardless. */
const canViewOthers = computed(() => can('dashboard:view_any'));
const viewableUsers = ref<AdminUser[]>([]);

async function load(): Promise<void> {
  loading.value = true;

  try {
    queue.value = await fetchQueue({
      userId: filters.viewUserId,
      status: filters.status,
      priority: filters.priority,
      overdue: filters.overdueOnly,
      includeClosed: filters.includeClosed,
      sort: filters.sort,
      direction: filters.direction,
      page: filters.page,
    });
  } finally {
    loading.value = false;
  }
}

function onSort(field: QueueSort): void {
  // Clicking the active column reverses it; clicking another switches to it.
  if (filters.sort === field) {
    filters.direction = filters.direction === 'asc' ? 'desc' : 'asc';
  } else {
    filters.sort = field;
    filters.direction = field === 'priority' ? 'desc' : 'asc';
  }
}

function clearFilters(): void {
  filters.reset();
}

async function createTask(input: Parameters<typeof tasks.create>[0]): Promise<void> {
  submittingTask.value = true;

  try {
    await tasks.create(input);
  } finally {
    submittingTask.value = false;
  }
}

onMounted(async () => {
  await Promise.all([load(), tasks.load()]);

  if (canViewOthers.value) {
    viewableUsers.value = (await adminUsersService.list({ pageSize: 100 })).items;
  }
});

// Every filter and sort change goes back to the SERVER. Re-sorting the loaded
// page would answer a different question than the agent asked (FR-008).
watch(
  () => [
    filters.status,
    filters.priority,
    filters.overdueOnly,
    filters.includeClosed,
    filters.sort,
    filters.direction,
    filters.page,
    filters.viewUserId,
  ],
  load,
  { deep: true },
);
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-xl font-semibold">{{ $t('dashboard.title') }}</h1>

      <!-- FR-011: whose queue is on screen must be visible, not inferred. -->
      <div v-if="canViewOthers" class="flex items-center gap-2">
        <label for="queue-user" class="text-sm font-medium">
          {{ $t('dashboard.viewingQueueOf') }}
        </label>
        <select
          id="queue-user"
          v-model="filters.viewUserId"
          class="rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-600 dark:bg-slate-900"
        >
          <option :value="undefined">{{ $t('dashboard.myQueue') }}</option>
          <option v-for="user in viewableUsers" :key="user.id" :value="user.id">
            {{ user.fullName }}
          </option>
        </select>
      </div>
    </header>

    <section :aria-label="$t('dashboard.queue.caption')" class="space-y-3">
      <QueueFilters
        :status="filters.status"
        :priority="filters.priority"
        :overdue-only="filters.overdueOnly"
        :include-closed="filters.includeClosed"
        :has-filters="filters.hasFilters()"
        :total="queue?.total ?? 0"
        @update:status="filters.status = $event"
        @update:priority="filters.priority = $event"
        @update:overdue-only="filters.overdueOnly = $event"
        @update:include-closed="filters.includeClosed = $event"
        @clear="clearFilters"
      />

      <QueueTable
        :items="queue?.items ?? []"
        :loading="loading"
        :sort="filters.sort"
        :direction="filters.direction"
        :has-filters="filters.hasFilters()"
        @sort="onSort"
        @clear-filters="clearFilters"
      />
    </section>

    <section class="space-y-3">
      <h2 class="text-lg font-semibold">{{ $t('task.title') }}</h2>
      <TaskForm :submitting="submittingTask" @create="createTask" />
      <TaskList
        :items="tasks.items"
        :loading="tasks.loading"
        @complete="tasks.complete($event)"
        @reopen="tasks.reopen($event)"
      />
    </section>
  </div>
</template>
