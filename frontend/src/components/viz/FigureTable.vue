<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/**
 * The table view every chart has (Phase 10, research D8).
 *
 * ONE COMPONENT DISCHARGING FOUR OBLIGATIONS, which is why it exists as a
 * primitive rather than being written per report:
 *
 *   1. SCREEN READER. A chart is an SVG; this is the same figures as rows.
 *   2. THE PALETTE'S CONTRAST RELIEF. The validated light-mode palette carries a
 *      WARN — two of the four categorical slots fall below 3:1 against the chart
 *      surface — and that WARN obligates visible labels or a table view. It is
 *      not dismissable, and this is the relief.
 *   3. THE RTL FALLBACK, where a chart's layout is ambiguous in Arabic.
 *   4. GREYSCALE PRINT. Series indistinguishable without colour are readable
 *      here.
 *
 * Numbers go through `vue-i18n`'s formatter rather than `String(n)`. A table is
 * the second-easiest place after an axis label to leave Latin digits on an
 * Arabic screen.
 */
defineProps<{
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
}>();

const { t, n } = useI18n();

function cell(value: string | number | null): string {
  if (value === null) return '—';
  return typeof value === 'number' ? n(value) : value;
}
</script>

<template>
  <div class="figure-table__scroll">
    <table class="figure-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column" scope="col">
            {{ t(`reports.column.${column}`) }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in rows" :key="index">
          <td v-for="column in columns" :key="column">{{ cell(row[column] ?? null) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
/* Wide content scrolls inside its own container — the page body must never
   scroll horizontally. */
.figure-table__scroll {
  overflow-x: auto;
}

.figure-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.figure-table th,
.figure-table td {
  border-bottom: 1px solid var(--viz-grid, #e5e7eb);
  padding: 0.25rem 0.5rem;
  /* `start`, not `left`: RTL mirrors without a per-component override. */
  text-align: start;
}

.figure-table th {
  font-weight: 600;
  color: var(--viz-text-secondary, #52514e);
}
</style>
