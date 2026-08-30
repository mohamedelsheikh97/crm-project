import { defineStore } from 'pinia';
import { ref } from 'vue';

import type { Task } from '../services/tasks.service';
import * as tasksService from '../services/tasks.service';

/**
 * The signed-in user's own tasks.
 *
 * There is no notion of "whose tasks" here, and there must not be: tasks are
 * personal (Clarifications Q3), so the only list this store can hold is the
 * caller's.
 */
export const useTasksStore = defineStore('tasks', () => {
  const items = ref<Task[]>([]);
  const loading = ref(false);

  async function load(): Promise<void> {
    loading.value = true;

    try {
      items.value = (await tasksService.fetchTasks({ status: 'open' })).items;
    } finally {
      loading.value = false;
    }
  }

  async function create(input: tasksService.TaskInput): Promise<void> {
    await tasksService.createTask(input);
    await load();
  }

  async function complete(id: number): Promise<void> {
    await tasksService.completeTask(id);
    // Reloaded rather than filtered locally, so the ordering rule stays in one
    // place — the server's.
    await load();
  }

  async function reopen(id: number): Promise<void> {
    await tasksService.reopenTask(id);
    await load();
  }

  return { items, loading, load, create, complete, reopen };
});
