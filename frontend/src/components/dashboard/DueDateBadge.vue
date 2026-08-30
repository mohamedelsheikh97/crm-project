<script setup lang="ts">
import { computed } from 'vue';

/**
 * A ticket's or task's due date, and whether it has passed.
 *
 * `isOverdue` comes from the SERVER and is never recomputed here (FR-020): two
 * agents in different timezones must agree about what is late, and the one
 * whose device clock is wrong would otherwise be confidently wrong.
 *
 * Overdue carries an icon AND the word, not just a colour (FR-021, FR-084). The
 * colour is the last thing added and the first thing that fails — in greyscale,
 * for a colour-blind reader, and for a screen reader, which sees none of it.
 */
const props = defineProps<{ dueAt: string | null; isOverdue: boolean }>();

const formatted = computed(() => {
  if (!props.dueAt) return null;

  // Formatted for the active locale by the caller's <i18n-d>; this component
  // holds the Date, not a preformatted string.
  return new Date(props.dueAt);
});
</script>

<template>
  <span
    v-if="formatted"
    class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
    :class="
      isOverdue
        ? 'bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100'
        : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
    "
  >
    <!-- aria-hidden: the adjacent text already says "overdue", so announcing
         the icon as well would read it twice. -->
    <span v-if="isOverdue" aria-hidden="true">⚠</span>
    <span v-if="isOverdue" class="sr-only">{{ $t('dashboard.due.overdueLabel') }}</span>
    <i18n-d tag="span" :value="formatted" :format="{ dateStyle: 'medium', timeStyle: 'short' }" />
    <span v-if="isOverdue" aria-hidden="true">· {{ $t('dashboard.due.overdue') }}</span>
  </span>
  <span v-else class="text-xs text-slate-500 dark:text-slate-400">
    {{ $t('dashboard.due.none') }}
  </span>
</template>
