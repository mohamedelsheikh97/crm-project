<script setup lang="ts">
import { computed, ref, watch } from 'vue';

/**
 * Setting, changing, or clearing a ticket's due date.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT DO:
 *
 *   - It does not refuse a past date (FR-024). Backdating a commitment already
 *     missed is legitimate, and often the whole reason someone is setting one.
 *   - It does not decide whether the ticket is overdue. That comes from the
 *     server's `isOverdue` (FR-020), because a browser clock that is wrong
 *     would make an agent confidently wrong about what is late.
 *
 * It is hidden without `tickets:set_due_date`, and the server refuses the call
 * regardless — hiding a control is never the restriction (FR-073).
 */
const props = defineProps<{
  dueAt: string | null;
  canEdit: boolean;
  saving: boolean;
}>();

const emit = defineEmits<{ (event: 'save', dueAt: string | null): void }>();

const draft = ref('');

/** `datetime-local` wants local wall-clock time, not an ISO instant. */
function toLocalInput(value: string | null): string {
  if (!value) return '';

  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;

  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

watch(
  () => props.dueAt,
  (value) => {
    draft.value = toLocalInput(value);
  },
  { immediate: true },
);

const changed = computed(() => draft.value !== toLocalInput(props.dueAt));

function save(): void {
  emit('save', draft.value === '' ? null : new Date(draft.value).toISOString());
}

function clear(): void {
  draft.value = '';
  emit('save', null);
}
</script>

<template>
  <div v-if="canEdit" class="space-y-1">
    <label for="ticket-due-at" class="block text-sm font-medium">
      {{ $t('ticket.dueDate.label') }}
    </label>

    <div class="flex flex-wrap items-center gap-2">
      <input
        id="ticket-due-at"
        v-model="draft"
        type="datetime-local"
        class="rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-600 dark:bg-slate-900"
      />

      <button
        type="button"
        :disabled="saving || !changed"
        class="rounded bg-blue-700 px-3 py-1.5 text-sm text-white disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        @click="save"
      >
        {{ $t('action.save') }}
      </button>

      <button
        v-if="dueAt"
        type="button"
        :disabled="saving"
        class="rounded border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-600"
        @click="clear"
      >
        {{ $t('ticket.dueDate.clear') }}
      </button>
    </div>

    <p class="text-xs text-slate-500 dark:text-slate-400">{{ $t('ticket.dueDate.hint') }}</p>
  </div>
</template>
