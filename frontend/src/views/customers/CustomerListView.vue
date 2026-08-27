<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import ConfirmDialog from '../../components/admin/ConfirmDialog.vue';
import DataTable, { type Column } from '../../components/admin/DataTable.vue';
import TablePagination from '../../components/admin/TablePagination.vue';
import { usePermissions } from '../../composables/usePermissions';
import * as customersService from '../../services/customers.service';
import type { CustomerSummary } from '../../services/customers.service';
import { ApiError } from '../../services/http';
import { useCustomersStore } from '../../stores/customers.store';

const { t } = useI18n();
const { can } = usePermissions();
const store = useCustomersStore();

const columns: Column[] = [
  { key: 'displayName', labelKey: 'customers.column.name' },
  { key: 'company', labelKey: 'customers.column.company' },
  { key: 'phone', labelKey: 'customers.column.phone' },
  { key: 'email', labelKey: 'customers.column.email' },
  { key: 'status', labelKey: 'customers.column.status' },
  { key: 'actions', labelKey: 'customers.column.actions' },
];

const rows = ref<CustomerSummary[]>([]);
const total = ref(0);
const pageSize = ref(25);
const loading = ref(false);
const error = ref<string | null>(null);
const exporting = ref(false);

const pending = ref<CustomerSummary | null>(null);
const dialogError = ref<string | null>(null);
const dialogBusy = ref(false);

/** The search box holds focus on load, so typing works immediately. */
const searchInput = ref<HTMLInputElement | null>(null);

let debounce: ReturnType<typeof setTimeout> | undefined;

const hasFilters = computed(() => Boolean(store.search || store.company || store.includeInactive));

function messageFor(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === 'FORBIDDEN') return t('error.forbidden');
    if (cause.code === 'CONFLICT') return t('error.conflict');
  }

  return t('error.unexpected');
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    const result = await customersService.list({
      search: store.search || undefined,
      company: store.company || undefined,
      isActive: store.includeInactive ? 'all' : true,
      page: store.page,
      pageSize: pageSize.value,
    });

    rows.value = result.items;
    total.value = result.total;
    pageSize.value = result.pageSize;
  } catch (cause) {
    error.value = messageFor(cause);
  } finally {
    loading.value = false;
  }
}

// Debounced: a request per keystroke is wasteful and arrives out of order.
watch(
  () => [store.search, store.company, store.includeInactive],
  () => {
    store.page = 1;
    clearTimeout(debounce);
    debounce = setTimeout(load, 250);
  },
);

watch(
  () => store.page,
  () => void load(),
);

onMounted(async () => {
  await load();
  searchInput.value?.focus();
});

function matchLabel(row: CustomerSummary): string | null {
  return row.matchedOn ? t(`customers.matched.${row.matchedOn}`) : null;
}

function clearFilters(): void {
  store.reset();
}

async function reactivate(row: CustomerSummary): Promise<void> {
  try {
    await customersService.reactivate(row.id);
    await load();
  } catch (cause) {
    error.value = messageFor(cause);
  }
}

async function confirmDeactivate(): Promise<void> {
  if (!pending.value) return;

  dialogBusy.value = true;
  dialogError.value = null;

  try {
    await customersService.deactivate(pending.value.id);
    pending.value = null;
    await load();
  } catch (cause) {
    dialogError.value = messageFor(cause);
  } finally {
    dialogBusy.value = false;
  }
}

/**
 * Exports what is CURRENTLY FILTERED, and the control says so. An export that
 * silently returns everything is a data-leak-shaped surprise.
 */
async function exportCsv(): Promise<void> {
  exporting.value = true;
  error.value = null;

  try {
    await customersService.exportCsv({
      search: store.search || undefined,
      company: store.company || undefined,
      isActive: store.includeInactive ? 'all' : true,
    });
  } catch (cause) {
    error.value = messageFor(cause);
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <section class="mx-auto max-w-6xl px-6 py-8">
    <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
      <h1 class="text-2xl font-semibold tracking-tight">{{ t('customers.title') }}</h1>

      <div class="flex flex-wrap items-center gap-3">
        <div v-if="can('customers:export')" class="flex flex-col items-end">
          <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
            :disabled="exporting"
            @click="exportCsv"
          >
            {{ exporting ? t('customers.export.working') : t('customers.export') }}
          </button>
          <span class="mt-1 text-xs text-slate-500">{{ t('customers.export.scope') }}</span>
        </div>

        <RouterLink
          v-if="can('customers:create')"
          :to="{ name: 'customer-new' }"
          class="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
        >
          {{ t('customers.create') }}
        </RouterLink>
      </div>
    </div>

    <!-- One search box, not a field selector: the caller offers a name, a
         number or an email and the Agent types it (FR-010). -->
    <div class="mb-4 flex flex-wrap gap-3">
      <input
        ref="searchInput"
        v-model="store.search"
        type="search"
        :aria-label="t('customers.search')"
        :placeholder="t('customers.search')"
        class="min-w-64 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        v-model="store.company"
        type="search"
        :aria-label="t('customers.filter.company')"
        :placeholder="t('customers.filter.company')"
        class="min-w-48 rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <label class="flex items-center gap-2 text-sm text-slate-700">
        <input v-model="store.includeInactive" type="checkbox" />
        {{ t('customers.filter.includeInactive') }}
      </label>
    </div>

    <p v-if="error" role="alert" class="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
      {{ error }}
    </p>

    <DataTable :columns="columns" :rows="rows" caption-key="customers.caption" :loading="loading">
      <template #cell-displayName="{ row }">
        <RouterLink
          :to="{ name: 'customer-profile', params: { id: row.id } }"
          class="font-medium text-blue-800 underline"
        >
          {{ row.displayName }}
        </RouterLink>
        <!-- Say WHY this row is here — a list of names after searching a number
             is disorienting (contracts/customer-ui.md). -->
        <span v-if="matchLabel(row)" class="ms-2 text-xs text-slate-500">
          {{ matchLabel(row) }}
        </span>
      </template>

      <template #cell-company="{ row }">{{ row.company ?? '—' }}</template>

      <!-- Raw, exactly as typed. Never the normalised form (rule 3). -->
      <template #cell-phone="{ row }">{{ row.primaryPhone?.raw ?? '—' }}</template>
      <template #cell-email="{ row }">{{ row.primaryEmail ?? '—' }}</template>

      <template #cell-status="{ row }">
        {{ t(row.isActive ? 'customers.status.active' : 'customers.status.inactive') }}
      </template>

      <template #cell-actions="{ row }">
        <div class="flex flex-wrap gap-2">
          <RouterLink
            v-if="can('customers:update')"
            :to="{ name: 'customer-edit', params: { id: row.id } }"
            class="rounded-md border border-slate-300 px-2 py-1 text-xs"
          >
            {{ t('action.edit') }}
          </RouterLink>

          <button
            v-if="can('customers:deactivate') && row.isActive"
            type="button"
            class="rounded-md border border-slate-300 px-2 py-1 text-xs"
            @click="pending = row"
          >
            {{ t('customers.action.deactivate') }}
          </button>

          <button
            v-if="can('customers:deactivate') && !row.isActive"
            type="button"
            class="rounded-md border border-slate-300 px-2 py-1 text-xs"
            @click="reactivate(row)"
          >
            {{ t('customers.action.reactivate') }}
          </button>
        </div>
      </template>

      <!--
        Carries the search term and offers to create that customer (FR-016).
        "No results" as a dead end forces the Agent to retype what they just
        typed into a create form.
      -->
      <template #empty-action>
        <div class="flex flex-col items-center gap-3">
          <p class="text-sm text-slate-600">
            {{
              store.search
                ? t('customers.empty.searched', { term: store.search })
                : t('customers.empty.none')
            }}
          </p>
          <div class="flex gap-2">
            <RouterLink
              v-if="can('customers:create')"
              :to="{ name: 'customer-new', query: { name: store.search } }"
              class="rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-white"
            >
              {{ t('customers.empty.createThis') }}
            </RouterLink>
            <button
              v-if="hasFilters"
              type="button"
              class="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              @click="clearFilters"
            >
              {{ t('action.clearFilters') }}
            </button>
          </div>
        </div>
      </template>
    </DataTable>

    <TablePagination
      v-if="total > pageSize"
      :page="store.page"
      :page-size="pageSize"
      :total="total"
      @update:page="store.page = $event"
    />

    <ConfirmDialog
      :open="pending !== null"
      title-key="customers.deactivate.title"
      message-key="customers.deactivate.message"
      :confirm-label="t('customers.deactivate.confirm', { name: pending?.displayName ?? '' })"
      :error="dialogError ?? undefined"
      :busy="dialogBusy"
      @confirm="confirmDeactivate"
      @cancel="pending = null"
    />
  </section>
</template>
