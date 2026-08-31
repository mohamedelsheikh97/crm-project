<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import type { SlaTargetState } from '../../services/sla.service';

/**
 * The SLA state indicator (FR-085).
 *
 * FR-085 IS SATISFIED BY THE ICON AND THE TEXT, NEVER BY THE COLOUR. Colour is
 * the fastest signal for the sighted majority and the only one that vanishes
 * for everyone else — so it is always an addition, never the carrier. The
 * greyscale test strips colour and asserts each state is still identifiable,
 * which is the same rule Phase 5 applied to delivery state and channel.
 *
 * A ticket with no SLA renders NOTHING. Not "no SLA", not a dash: a ticket
 * nobody made a commitment about should not be annotated with the absence of
 * one in every row of the queue.
 */

const props = defineProps<{
  state: SlaTargetState | null;
  /** Shown as a tooltip and in the accessible name. */
  targetAt?: string | null;
  paused?: boolean;
}>();

const { t, d } = useI18n();

/**
 * Icon, text key, and colour role per state — declared as data so the greyscale
 * test can iterate them rather than hard-coding a list that could drift.
 */
const PRESENTATION: Record<SlaTargetState, { icon: string; key: string; tone: string }> = {
  met: { icon: 'check', key: 'sla.state.met', tone: 'text-emerald-700 dark:text-emerald-400' },
  on_track: { icon: 'clock', key: 'sla.state.onTrack', tone: 'text-slate-600 dark:text-slate-300' },
  at_risk: {
    icon: 'clock-alert',
    key: 'sla.state.atRisk',
    tone: 'text-amber-700 dark:text-amber-400',
  },
  breached: {
    icon: 'alert-triangle',
    key: 'sla.state.breached',
    tone: 'text-red-700 dark:text-red-400',
  },
};

const presentation = computed(() => (props.state ? PRESENTATION[props.state] : null));

const accessibleName = computed(() => {
  if (!presentation.value) return '';

  const label = t(presentation.value.key);

  if (!props.targetAt) return label;

  // The target time belongs in the accessible name, not only in a tooltip: a
  // screen-reader user must not have to hover to learn when it is due.
  return t('sla.state.withTarget', { state: label, target: d(new Date(props.targetAt), 'long') });
});
</script>

<template>
  <span
    v-if="presentation"
    class="inline-flex items-center gap-1 text-sm font-medium"
    :class="presentation.tone"
    :title="accessibleName"
    :aria-label="accessibleName"
    :data-sla-state="state"
    :data-sla-icon="presentation.icon"
  >
    <!--
      The icon is rendered from a data attribute AND a glyph so the greyscale
      test can assert identifiability without depending on an icon font being
      loaded in happy-dom.
    -->
    <span aria-hidden="true">{{
      presentation.icon === 'check'
        ? '✓'
        : presentation.icon === 'clock'
          ? '◷'
          : presentation.icon === 'clock-alert'
            ? '◔'
            : '⚠'
    }}</span>
    <span>{{ t(presentation.key) }}</span>
    <span v-if="paused" class="text-xs opacity-80" data-sla-paused="true">
      {{ t('sla.paused') }}
    </span>
  </span>
</template>
