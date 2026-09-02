<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/**
 * One filter row, above the figures (Phase 10, FR-038).
 *
 * The period lives in the store rather than here, because FR-038 requires the
 * filter to apply to EVERY figure on the surface — and a period held
 * per-component is how two figures end up showing different months.
 */
const props = defineProps<{ from: string; to: string; busy?: boolean }>();

const emit = defineEmits<{ (event: 'change', from: string, to: string): void }>();

const { t } = useI18n();
</script>

<template>
  <form class="period-filter" @submit.prevent>
    <label class="period-filter__field">
      <span>{{ t('reports.period.from') }}</span>
      <input
        type="date"
        :value="from"
        :disabled="busy"
        @change="emit('change', ($event.target as HTMLInputElement).value, props.to)"
      />
    </label>

    <label class="period-filter__field">
      <span>{{ t('reports.period.to') }}</span>
      <input
        type="date"
        :value="to"
        :disabled="busy"
        @change="emit('change', props.from, ($event.target as HTMLInputElement).value)"
      />
    </label>
  </form>
</template>

<style scoped>
.period-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}

.period-filter__field {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  font-size: 0.75rem;
  color: var(--viz-text-secondary, #52514e);
}

.period-filter__field input {
  border: 1px solid #d1d5db;
  border-radius: 0.25rem;
  padding: 0.25rem 0.375rem;
  font: inherit;
}

/* Filters are chrome, not content: they do not belong in an exported PDF. */
@media print {
  .period-filter {
    display: none;
  }
}
</style>
