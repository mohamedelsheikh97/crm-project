<script setup lang="ts">
import { computed } from 'vue';

import type { TicketStatus } from '../../services/tickets.service';

/**
 * Renders a status KEY through i18n. It never receives a display string —
 * the server sends keys precisely so this is possible (FR-057).
 */
const props = defineProps<{ status: TicketStatus }>();

/**
 * Colour is an addition, never the message. The text label is always present,
 * so the status survives greyscale, colour-blindness, and a screen reader
 * (FR-059).
 */
const TONE: Record<TicketStatus, string> = {
  new: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100',
  open: 'bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100',
  pending: 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
  escalated: 'bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100',
  resolved: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100',
  closed: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100',
};

const tone = computed(() => TONE[props.status]);
</script>

<template>
  <span
    class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
    :class="tone"
  >
    {{ $t(`ticket.status.${status}`) }}
  </span>
</template>
