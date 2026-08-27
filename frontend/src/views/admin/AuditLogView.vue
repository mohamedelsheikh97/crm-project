<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import DataTable, { type Column } from '../../components/admin/DataTable.vue';
import TablePagination from '../../components/admin/TablePagination.vue';
import * as adminAudit from '../../services/admin-audit.service';
import type { AuditEntry } from '../../services/admin-audit.service';

const { t, te, locale } = useI18n();

const columns: Column[] = [
  { key: 'createdAt', labelKey: 'audit.column.timestamp' },
  { key: 'actor', labelKey: 'audit.column.actor' },
  { key: 'action', labelKey: 'audit.column.action' },
  { key: 'target', labelKey: 'audit.column.target' },
  { key: 'outcome', labelKey: 'audit.column.outcome' },
];

const rows = ref<AuditEntry[]>([]);
const actionTypes = ref<string[]>([]);
const page = ref(1);
const pageSize = ref(25);
const total = ref(0);
const loading = ref(false);
const error = ref<string | null>(null);
const expanded = ref<Set<number>>(new Set());

const from = ref('');
const to = ref('');
const action = ref('');
const outcome = ref('');

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    const result = await adminAudit.list({
      page: page.value,
      pageSize: pageSize.value,
      from: from.value || undefined,
      to: to.value || undefined,
      action: action.value || undefined,
      outcome: (outcome.value || undefined) as 'success' | 'failure' | undefined,
    });

    rows.value = result.items;
    total.value = result.total;
    pageSize.value = result.pageSize;
  } catch {
    error.value = t('error.unexpected');
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await load();

  try {
    actionTypes.value = await adminAudit.actions();
  } catch {
    // A missing filter list is not worth failing the screen over.
    actionTypes.value = [];
  }
});

watch([from, to, action, outcome], () => {
  page.value = 1;
  void load();
});

watch(page, () => void load());

/**
 * The raw machine key (`user.role.changed`) must never reach a user. If a
 * translation is somehow missing, fall back to the key rather than rendering
 * nothing — but the locale parity test is what stops that happening.
 */
function actionLabel(key: string): string {
  const translationKey = `audit.action.${key}`;
  return te(translationKey) ? t(translationKey) : key;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function hasDetail(entry: AuditEntry): boolean {
  return entry.previousValue !== null || entry.newValue !== null;
}

function toggle(id: number): void {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}
</script>

<template>
  <section>
    <h2 class="mb-2 text-xl font-semibold">{{ t('audit.title') }}</h2>

    <!-- Append-only should be visible in the interface, not merely enforced
         behind it. There is no edit or delete control anywhere on this screen. -->
    <p class="mb-6 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
      {{ t('audit.immutableNotice') }}
    </p>

    <div class="mb-4 flex flex-wrap gap-3">
      <label class="text-sm">
        <span class="mb-1 block text-slate-600">{{ t('audit.filter.from') }}</span>
        <input
          v-model="from"
          type="date"
          class="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      <label class="text-sm">
        <span class="mb-1 block text-slate-600">{{ t('audit.filter.to') }}</span>
        <input
          v-model="to"
          type="date"
          class="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      <label class="text-sm">
        <span class="mb-1 block text-slate-600">{{ t('audit.filter.action') }}</span>
        <select v-model="action" class="rounded-md border border-slate-300 px-3 py-2 text-sm">
          <option value="">{{ t('audit.filter.all') }}</option>
          <option v-for="key in actionTypes" :key="key" :value="key">{{ actionLabel(key) }}</option>
        </select>
      </label>
      <label class="text-sm">
        <span class="mb-1 block text-slate-600">{{ t('audit.filter.outcome') }}</span>
        <select v-model="outcome" class="rounded-md border border-slate-300 px-3 py-2 text-sm">
          <option value="">{{ t('audit.filter.all') }}</option>
          <option value="success">{{ t('audit.outcome.success') }}</option>
          <option value="failure">{{ t('audit.outcome.failure') }}</option>
        </select>
      </label>
    </div>

    <p v-if="error" role="alert" class="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
      {{ error }}
    </p>

    <DataTable
      :columns="columns"
      :rows="rows"
      caption-key="audit.caption"
      :loading="loading"
      empty-title-key="audit.empty.title"
      empty-description-key="audit.empty.description"
    >
      <template #cell-createdAt="{ row }">{{ formatTime(row.createdAt) }}</template>

      <template #cell-actor="{ row }">
        {{ row.actor?.email ?? t('audit.actor.anonymous') }}
      </template>

      <template #cell-action="{ row }">
        <span>{{ actionLabel(row.action) }}</span>
        <button
          v-if="hasDetail(row)"
          type="button"
          class="ms-2 text-xs text-blue-700 underline"
          :aria-expanded="expanded.has(row.id)"
          @click="toggle(row.id)"
        >
          {{ t(expanded.has(row.id) ? 'audit.details.hide' : 'audit.details.show') }}
        </button>

        <dl v-if="expanded.has(row.id)" class="mt-2 text-xs text-slate-600">
          <dt class="font-medium">{{ t('audit.details.previous') }}</dt>
          <dd class="mb-1 font-mono break-all">{{ JSON.stringify(row.previousValue) }}</dd>
          <dt class="font-medium">{{ t('audit.details.new') }}</dt>
          <dd class="font-mono break-all">{{ JSON.stringify(row.newValue) }}</dd>
        </dl>
      </template>

      <template #cell-target="{ row }">{{ row.target.label ?? '—' }}</template>

      <template #cell-outcome="{ row }">
        {{ t(row.outcome === 'success' ? 'audit.outcome.success' : 'audit.outcome.failure') }}
      </template>
    </DataTable>

    <TablePagination
      v-if="total > pageSize"
      :page="page"
      :page-size="pageSize"
      :total="total"
      @update:page="page = $event"
    />
  </section>
</template>
