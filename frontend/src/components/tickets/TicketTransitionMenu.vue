<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { ApiError } from '../../services/http';
import * as ticketsService from '../../services/tickets.service';
import type { Ticket, TicketStatus } from '../../services/tickets.service';

/**
 * Renders ONLY the moves the server says are available.
 *
 * This component holds NO copy of the lifecycle table. A front-end copy would
 * drift, and the direction it drifts is offering a button that then fails —
 * the interface promising authority it cannot deliver.
 */
const props = defineProps<{ ticket: Ticket }>();
const emit = defineEmits<{ moved: [Ticket] }>();

const { t } = useI18n();

const available = ref<TicketStatus[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

/** Escalation must say why (FR-029), so it opens a prompt rather than firing. */
const escalating = ref(false);
const reason = ref('');
const submitting = ref(false);

async function load(): Promise<void> {
  loading.value = true;

  try {
    available.value = (await ticketsService.transitions(props.ticket.id)).transitions;
  } catch {
    available.value = [];
  } finally {
    loading.value = false;
  }
}

// `immediate` because the component is mounted with a ticket already loaded; a
// plain watch fires only on CHANGE and would leave the first render empty.
watch(() => props.ticket.id, load, { immediate: true });
watch(() => props.ticket.status, load);

function messageFor(cause: unknown): string {
  if (cause instanceof ApiError) {
    const refused = ticketsService.refusedTransitionFrom(cause);

    if (refused) {
      // A refusal that names nothing leaves the user guessing. This should not
      // normally be reachable — the buttons come from the server — but if the
      // ticket moved under us, say where it can go now.
      return t('ticket.transition.refused', {
        allowed: refused.allowed.map((status) => t(`ticket.status.${status}`)).join('، '),
      });
    }

    if (cause.code === 'CONFLICT') return t('error.conflict');
    if (cause.code === 'FORBIDDEN') return t('error.forbidden');

    return cause.message;
  }

  return t('error.unexpected');
}

async function move(to: TicketStatus): Promise<void> {
  if (to === 'escalated') {
    escalating.value = true;
    return;
  }

  await send(to);
}

async function send(to: TicketStatus): Promise<void> {
  submitting.value = true;
  error.value = null;

  try {
    const updated = await ticketsService.transition(props.ticket.id, {
      to,
      version: props.ticket.version,
      reason: to === 'escalated' ? reason.value : undefined,
    });

    escalating.value = false;
    reason.value = '';
    emit('moved', updated);
  } catch (cause) {
    error.value = messageFor(cause);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="space-y-3" :aria-label="t('ticket.transition.label')">
    <p
      v-if="error"
      class="rounded-md bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
    >
      {{ error }}
    </p>

    <div v-if="!loading && available.length > 0" class="flex flex-wrap gap-2">
      <button
        v-for="status in available"
        :key="status"
        type="button"
        class="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600"
        :disabled="submitting"
        @click="move(status)"
      >
        {{ t(`ticket.transition.to.${status}`) }}
      </button>
    </div>

    <p v-else-if="!loading" class="text-sm text-slate-600 dark:text-slate-300">
      {{ t('ticket.transition.none') }}
    </p>

    <div v-if="escalating" class="space-y-2 rounded-md border p-3">
      <label class="block text-sm font-medium" for="escalation-reason">
        {{ t('ticket.escalation.reason') }}
      </label>
      <textarea
        id="escalation-reason"
        v-model="reason"
        rows="3"
        required
        class="w-full rounded-md border border-slate-300 px-3 py-2 text-start dark:border-slate-600 dark:bg-slate-800"
      ></textarea>
      <p class="text-xs text-slate-600 dark:text-slate-300">
        {{ t('ticket.escalation.reasonHint') }}
      </p>
      <div class="flex gap-2">
        <button
          type="button"
          class="rounded-md bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
          :disabled="submitting || reason.trim() === ''"
          @click="send('escalated')"
        >
          {{ t('ticket.escalation.submit') }}
        </button>
        <button
          type="button"
          class="rounded-md border px-3 py-2 text-sm"
          @click="
            escalating = false;
            reason = '';
          "
        >
          {{ t('action.cancel') }}
        </button>
      </div>
    </div>
  </section>
</template>
