<script setup lang="ts">
import { ref } from 'vue';

import type { TaskInput } from '../../services/tasks.service';

/**
 * Creating a follow-up.
 *
 * NOTE WHAT IS NOT HERE: no owner field. A task is created for the person
 * creating it, and the server rejects an owner in the payload rather than
 * ignoring it (Clarifications Q3) — so there is nothing for this form to send.
 */
const props = defineProps<{ ticketId?: number; customerId?: number; submitting: boolean }>();

const emit = defineEmits<{ (event: 'create', input: TaskInput): void }>();

const title = ref('');
const dueAt = ref('');
const remindAt = ref('');
const error = ref<string | null>(null);

function submit(): void {
  const trimmed = title.value.trim();

  if (trimmed === '') {
    error.value = 'task.error.titleRequired';
    return;
  }

  error.value = null;

  emit('create', {
    title: trimmed,
    // A past date is accepted by the server (FR-024) — backdating something
    // already missed is legitimate, so there is no client-side floor here.
    dueAt: dueAt.value === '' ? null : new Date(dueAt.value).toISOString(),
    remindAt: remindAt.value === '' ? null : new Date(remindAt.value).toISOString(),
    ...(props.ticketId !== undefined ? { ticketId: props.ticketId } : {}),
    ...(props.customerId !== undefined ? { customerId: props.customerId } : {}),
  });

  title.value = '';
  dueAt.value = '';
  remindAt.value = '';
}
</script>

<template>
  <form class="space-y-2" @submit.prevent="submit">
    <div>
      <label for="task-title" class="block text-sm font-medium">{{ $t('task.field.title') }}</label>
      <input
        id="task-title"
        v-model="title"
        type="text"
        class="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-600 dark:bg-slate-900"
        :aria-invalid="error !== null"
        :aria-describedby="error ? 'task-title-error' : undefined"
      />
      <!-- Announced, not merely coloured: a validation error conveyed only by a
           red border is invisible to a screen reader (FR-083). -->
      <p v-if="error" id="task-title-error" role="alert" class="mt-1 text-sm text-red-700">
        {{ $t(error) }}
      </p>
    </div>

    <div class="flex flex-wrap gap-3">
      <div>
        <label for="task-due" class="block text-sm font-medium">{{ $t('task.field.dueAt') }}</label>
        <input
          id="task-due"
          v-model="dueAt"
          type="datetime-local"
          class="mt-1 rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-600 dark:bg-slate-900"
        />
      </div>

      <div>
        <label for="task-remind" class="block text-sm font-medium">
          {{ $t('task.field.remindAt') }}
        </label>
        <input
          id="task-remind"
          v-model="remindAt"
          type="datetime-local"
          class="mt-1 rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-600 dark:bg-slate-900"
        />
      </div>
    </div>

    <button
      type="submit"
      :disabled="submitting"
      class="rounded bg-blue-700 px-3 py-1.5 text-sm text-white disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
    >
      {{ $t('task.add') }}
    </button>
  </form>
</template>
