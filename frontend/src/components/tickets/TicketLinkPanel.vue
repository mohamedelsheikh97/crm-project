<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

import TicketStatusBadge from './TicketStatusBadge.vue';
import { usePermissions } from '../../composables/usePermissions';
import { ApiError } from '../../services/http';
import * as ticketsService from '../../services/tickets.service';
import type { Ticket, TicketSummary } from '../../services/tickets.service';

/**
 * Linking relates two tickets without either losing its identity — the whole
 * difference from merging, which is why removing a link is a plain action and
 * merging needs a confirmation dialog.
 */
const props = defineProps<{ ticket: Ticket }>();
const emit = defineEmits<{ changed: [Ticket] }>();

const { t } = useI18n();
const { can } = usePermissions();

const search = ref('');
const candidates = ref<TicketSummary[]>([]);
const targetId = ref<number | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);

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
    if (cause.details[0]) return t(cause.details[0].message.split(':')[0]);
    return cause.message;
  }

  return t('error.unexpected');
}

async function add(): Promise<void> {
  if (targetId.value === null) return;

  busy.value = true;
  error.value = null;

  try {
    emit('changed', await ticketsService.link(props.ticket.id, targetId.value));
    targetId.value = null;
  } catch (cause) {
    error.value = messageFor(cause);
  } finally {
    busy.value = false;
  }
}

async function remove(linkedTicketId: number): Promise<void> {
  busy.value = true;
  error.value = null;

  try {
    emit('changed', await ticketsService.unlink(props.ticket.id, linkedTicketId));
  } catch (cause) {
    error.value = messageFor(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="space-y-3">
    <h2 class="text-lg font-semibold">{{ t('ticket.links.title') }}</h2>

    <p
      v-if="error"
      class="rounded-md bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
    >
      {{ error }}
    </p>

    <ul v-if="ticket.links.length > 0" class="space-y-2">
      <li
        v-for="link in ticket.links"
        :key="link.id"
        class="flex flex-wrap items-center gap-3 rounded-md border p-2"
      >
        <RouterLink
          :to="{ name: 'ticket-detail', params: { id: link.ticket.id } }"
          class="font-mono text-blue-700 underline dark:text-blue-300"
          dir="ltr"
        >
          {{ link.ticket.reference }}
        </RouterLink>
        <span class="grow">{{ link.ticket.subject }}</span>
        <TicketStatusBadge :status="link.ticket.status" />
        <button
          v-if="can('tickets:link') && ticket.mergedIntoTicketId === null"
          type="button"
          class="rounded-md border px-2 py-1 text-xs"
          :disabled="busy"
          @click="remove(link.ticket.id)"
        >
          <!-- Not icon-only: the action is named, so it announces as itself. -->
          {{ t('ticket.links.remove') }}
        </button>
      </li>
    </ul>

    <p v-else class="text-sm text-slate-600 dark:text-slate-300">
      {{ t('ticket.links.none') }}
    </p>

    <div
      v-if="can('tickets:link') && ticket.mergedIntoTicketId === null"
      class="flex flex-wrap items-end gap-2"
    >
      <div class="grow">
        <label class="block text-sm font-medium" for="link-search">
          {{ t('ticket.links.find') }}
        </label>
        <input
          id="link-search"
          v-model="search"
          type="search"
          class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-start dark:border-slate-600 dark:bg-slate-800"
          @keyup.enter.prevent="searchTickets"
        />
      </div>
      <select
        v-model.number="targetId"
        class="rounded-md border border-slate-300 px-3 py-2 text-start dark:border-slate-600 dark:bg-slate-800"
        :aria-label="t('ticket.links.target')"
      >
        <option :value="null">{{ t('ticket.links.selectTarget') }}</option>
        <option v-for="candidate in candidates" :key="candidate.id" :value="candidate.id">
          {{ candidate.reference }} — {{ candidate.subject }}
        </option>
      </select>
      <button
        type="button"
        class="rounded-md border px-3 py-2 text-sm"
        :disabled="busy || targetId === null"
        @click="add"
      >
        {{ t('ticket.links.add') }}
      </button>
    </div>
  </section>
</template>
