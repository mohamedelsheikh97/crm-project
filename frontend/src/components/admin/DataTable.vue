<script setup lang="ts" generic="T extends { id: number | string }">
import { useI18n } from 'vue-i18n';

import EmptyState from './EmptyState.vue';

export interface Column {
  key: string;
  /** i18n key for the header — never a literal. */
  labelKey: string;
}

defineProps<{
  columns: Column[];
  rows: T[];
  /** i18n key describing the table, for the visually-hidden caption. */
  captionKey: string;
  loading?: boolean;
  emptyTitleKey?: string;
  emptyDescriptionKey?: string;
}>();

const { t } = useI18n();

/**
 * The cast lives here rather than inline in the template: Prettier parses
 * templates as HTML and reads `Record<string, unknown>` as a tag.
 */
function cellValue(row: T, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}
</script>

<template>
  <!--
    A real <table>, not a grid of <div>s: screen readers navigate by row and
    column, and that is free only if the markup is a table (contracts/admin-ui.md).
    Column order follows the root dir automatically — no physical utilities.
  -->
  <div class="overflow-x-auto" :aria-busy="loading ? 'true' : 'false'">
    <table v-if="rows.length > 0" class="w-full border-collapse text-start text-sm">
      <caption class="sr-only">
        {{
          t(captionKey)
        }}
      </caption>
      <thead>
        <tr class="border-b border-slate-200">
          <th
            v-for="column in columns"
            :key="column.key"
            scope="col"
            class="px-3 py-2 text-start font-semibold text-slate-700"
          >
            {{ t(column.labelKey) }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id" class="border-b border-slate-100">
          <td v-for="column in columns" :key="column.key" class="px-3 py-2 align-middle">
            <slot :name="`cell-${column.key}`" :row="row">
              {{ cellValue(row, column.key) }}
            </slot>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Never a bare empty table, and never the words "No data". -->
    <EmptyState
      v-else-if="!loading"
      :title-key="emptyTitleKey ?? 'table.empty.title'"
      :description-key="emptyDescriptionKey ?? 'table.empty.description'"
    >
      <slot name="empty-action" />
    </EmptyState>

    <p v-else class="px-3 py-6 text-sm text-slate-500">{{ t('table.loading') }}</p>
  </div>
</template>
