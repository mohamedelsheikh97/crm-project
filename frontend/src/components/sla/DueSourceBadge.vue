<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/**
 * Who set the due date (FR-024b).
 *
 * BOTH STATES ARE LABELLED, and that is deliberate. Showing a badge only for
 * overrides would make "computed by policy" the unmarked default — and a
 * supervisor asking "why is this date what it is?" needs an answer on both. The
 * question is equally likely either way.
 *
 * The clear control appears only for a manual override, because clearing a
 * computed date is not a thing: it would return to itself (FR-024d).
 */

defineProps<{
  source: 'policy' | 'manual';
  canClear?: boolean;
}>();

defineEmits<{ (event: 'clear'): void }>();

const { t } = useI18n();
</script>

<template>
  <span class="inline-flex items-center gap-2 text-xs">
    <span
      class="rounded px-1.5 py-0.5"
      :class="
        source === 'manual'
          ? 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200'
          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
      "
      :data-due-source="source"
    >
      {{ source === 'manual' ? t('sla.dueSource.manual') : t('sla.dueSource.policy') }}
    </span>

    <button
      v-if="source === 'manual' && canClear"
      type="button"
      class="underline underline-offset-2 hover:no-underline"
      @click="$emit('clear')"
    >
      {{ t('sla.dueSource.clearOverride') }}
    </button>
  </span>
</template>
