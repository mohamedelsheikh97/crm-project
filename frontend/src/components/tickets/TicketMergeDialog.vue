<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { ApiError } from '../../services/http';
import * as ticketsService from '../../services/tickets.service';
import type { Ticket, TicketSummary } from '../../services/tickets.service';

/**
 * Merging is PERMANENT and cannot be undone, so this dialog is deliberately
 * slower than it could be: it names both tickets, says plainly that the merge
 * is irreversible, and does NOT default focus to the confirm control.
 * Destructive confirmation should require a deliberate move, not an accidental
 * Enter.
 */
const props = defineProps<{ open: boolean; ticket: Ticket }>();
const emit = defineEmits<{ close: []; merged: [Ticket] }>();

const { t } = useI18n();

const search = ref('');
const candidates = ref<TicketSummary[]>([]);
const targetId = ref<number | null>(null);
const note = ref('');
const submitting = ref(false);
const error = ref<string | null>(null);

const dialog = ref<HTMLElement | null>(null);
const cancelButton = ref<HTMLButtonElement | null>(null);

/**
 * `immediate` matters: a dialog mounted already-open would otherwise focus
 * nothing, because a plain watch fires only on CHANGE. Phase 2 shipped exactly
 * that bug once.
 */
watch(
  () => props.open,
  async (open) => {
    if (!open) return;

    error.value = null;
    targetId.value = null;
    note.value = '';
    await searchTickets();
    await nextTick();
    // Cancel, not confirm.
    cancelButton.value?.focus();
  },
  { immediate: true },
);

async function searchTickets(): Promise<void> {
  try {
    const result = await ticketsService.list({ q: search.value || undefined, pageSize: 20 });
    candidates.value = result.items.filter((item) => item.id !== props.ticket.id);
  } catch {
    candidates.value = [];
  }
}

function messageFor(cause: unknown): string {
  if (cause instanceof ApiError) {
    const survivor = ticketsService.survivorFrom(cause);
    if (survivor) return t('ticket.merge.alreadyMerged', { reference: survivor.survivorReference });
    if (cause.code === 'CONFLICT') return t('error.conflict');
    if (cause.details[0]) return t(cause.details[0].message.split(':')[0]);
    return cause.message;
  }

  return t('error.unexpected');
}

async function confirm(): Promise<void> {
  if (targetId.value === null) return;

  submitting.value = true;
  error.value = null;

  try {
    const updated = await ticketsService.merge(props.ticket.id, {
      intoTicketId: targetId.value,
      version: props.ticket.version,
      note: note.value || undefined,
    });

    emit('merged', updated);
  } catch (cause) {
    error.value = messageFor(cause);
  } finally {
    submitting.value = false;
  }
}

/** Focus stays inside while the dialog is open, and Escape closes it. */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    emit('close');
    return;
  }

  if (event.key !== 'Tab' || !dialog.value) return;

  const focusable = dialog.value.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );

  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    @keydown="onKeydown"
  >
    <div
      ref="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="merge-dialog-title"
      class="w-full max-w-lg space-y-4 rounded-lg bg-white p-6 dark:bg-slate-900"
    >
      <h2 id="merge-dialog-title" class="text-lg font-semibold">
        {{ t('ticket.merge.title') }}
      </h2>

      <p class="text-sm">
        {{ t('ticket.merge.intro', { reference: ticket.reference, subject: ticket.subject }) }}
      </p>

      <!-- Stated plainly, because it is true. -->
      <p
        class="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
      >
        {{ t('ticket.merge.permanent') }}
      </p>

      <p
        v-if="error"
        class="rounded-md bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
      >
        {{ error }}
      </p>

      <div>
        <label class="block text-sm font-medium" for="merge-search">
          {{ t('ticket.merge.findTarget') }}
        </label>
        <input
          id="merge-search"
          v-model="search"
          type="search"
          class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-start dark:border-slate-600 dark:bg-slate-800"
          @keyup.enter.prevent="searchTickets"
        />
      </div>

      <div>
        <label class="block text-sm font-medium" for="merge-target">
          {{ t('ticket.merge.target') }}
        </label>
        <select
          id="merge-target"
          v-model.number="targetId"
          class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-start dark:border-slate-600 dark:bg-slate-800"
        >
          <option :value="null">{{ t('ticket.merge.selectTarget') }}</option>
          <option v-for="candidate in candidates" :key="candidate.id" :value="candidate.id">
            {{ candidate.reference }} — {{ candidate.subject }}
          </option>
        </select>
      </div>

      <div>
        <label class="block text-sm font-medium" for="merge-note">
          {{ t('ticket.merge.note') }}
        </label>
        <textarea
          id="merge-note"
          v-model="note"
          rows="2"
          class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-start dark:border-slate-600 dark:bg-slate-800"
        ></textarea>
      </div>

      <div class="flex justify-end gap-3">
        <button
          ref="cancelButton"
          type="button"
          class="rounded-md border px-4 py-2 text-sm"
          @click="emit('close')"
        >
          {{ t('action.cancel') }}
        </button>
        <button
          type="button"
          class="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          :disabled="submitting || targetId === null"
          @click="confirm"
        >
          {{ t('ticket.merge.confirm') }}
        </button>
      </div>
    </div>
  </div>
</template>
