<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { useDuration } from '../../composables/useDuration';
import type { SlaTargetView } from '../../services/sla.service';

/**
 * How long is left (FR-020, FR-084).
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT DO:
 *
 * 1. IT DOES NOT TICK. There is no `setInterval` and no local clock. The state
 *    is the server's, computed against the one authoritative clock (FR-011),
 *    and a client-side countdown would drift into disagreeing with the sweep —
 *    showing "2 minutes left" on a ticket the server has already escalated.
 *    It refreshes when the ticket does.
 *
 * 2. IT DOES NOT COUNT DOWN WHILE PAUSED. A ticket waiting on the customer
 *    shows the captured remainder with a pause affordance. A paused ticket that
 *    appears to be burning its clock is the bug User Story 6 exists to prevent,
 *    and it would be an interface bug even with the backend perfectly correct.
 */

const props = defineProps<{
  target: SlaTargetView;
  paused?: boolean;
}>();

const { t, d } = useI18n();
const { remaining, overdueBy } = useDuration();

const text = computed(() => {
  if (props.target.state === 'met') return t('sla.state.met');

  // Breached renders "overdue by X", never a negative number: "-45 minutes
  // left" is arithmetic, not language.
  if (props.target.state === 'breached') {
    if (!props.target.targetAt) return t('sla.state.breached');

    const overdueMinutes = Math.max(
      0,
      Math.round((Date.now() - new Date(props.target.targetAt).getTime()) / 60_000),
    );

    return overdueBy(overdueMinutes);
  }

  if (props.target.remainingMinutes === null) return '';

  return remaining(props.target.remainingMinutes);
});

const title = computed(() =>
  props.target.targetAt ? d(new Date(props.target.targetAt), 'long') : '',
);
</script>

<template>
  <span
    class="inline-flex items-center gap-1 text-sm"
    :title="title"
    :data-sla-countdown="target.state"
    :data-sla-paused="paused ? 'true' : 'false'"
  >
    <span>{{ text }}</span>
    <span v-if="paused" class="text-xs opacity-80">{{ t('sla.paused') }}</span>
  </span>
</template>
