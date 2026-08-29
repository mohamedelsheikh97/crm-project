<script setup lang="ts">
import { computed } from 'vue';

import type { TicketPriority } from '../../services/tickets.service';

/** As with status: a key in, a translated label out. */
const props = defineProps<{ priority: TicketPriority }>();

const TONE: Record<TicketPriority, string> = {
  low: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  normal: 'bg-sky-100 text-sky-900 dark:bg-sky-900 dark:text-sky-100',
  high: 'bg-orange-100 text-orange-900 dark:bg-orange-900 dark:text-orange-100',
  urgent: 'bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100',
};

const tone = computed(() => TONE[props.priority]);
</script>

<template>
  <span
    class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
    :class="tone"
  >
    {{ $t(`ticket.priority.${priority}`) }}
  </span>
</template>
