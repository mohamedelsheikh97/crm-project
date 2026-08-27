<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import ConfirmDialog from '../../components/admin/ConfirmDialog.vue';
import DataTable, { type Column } from '../../components/admin/DataTable.vue';
import TablePagination from '../../components/admin/TablePagination.vue';
import { usePermissions } from '../../composables/usePermissions';
import { ApiError } from '../../services/http';
import * as adminUsers from '../../services/admin-users.service';
import type { AdminUser } from '../../services/admin-users.service';

const { t } = useI18n();
const { can } = usePermissions();

const columns: Column[] = [
  { key: 'fullName', labelKey: 'users.column.name' },
  { key: 'email', labelKey: 'users.column.email' },
  { key: 'role', labelKey: 'users.column.role' },
  { key: 'status', labelKey: 'users.column.status' },
  { key: 'actions', labelKey: 'users.column.actions' },
];

const rows = ref<AdminUser[]>([]);
const page = ref(1);
const pageSize = ref(25);
const total = ref(0);
const loading = ref(false);
const error = ref<string | null>(null);

const search = ref('');
const roleKey = ref('');
const status = ref('');

const pending = ref<AdminUser | null>(null);
const dialogError = ref<string | null>(null);
const dialogBusy = ref(false);

const hasFilters = computed(() => Boolean(search.value || roleKey.value || status.value));

/**
 * Translates a server error into a message. A 403 reaching here is a real
 * defect — it means the interface offered something the server refused — so it
 * is surfaced rather than swallowed.
 */
function messageFor(cause: unknown): string {
  if (cause instanceof ApiError) {
    const detail = cause.details[0]?.message;

    if (detail) return t(detail);
    if (cause.code === 'CONFLICT') return t('error.lastAdministrator');
    if (cause.code === 'FORBIDDEN') return t('error.forbidden');
  }

  return t('error.unexpected');
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    const result = await adminUsers.list({
      page: page.value,
      pageSize: pageSize.value,
      search: search.value || undefined,
      roleKey: roleKey.value || undefined,
      isActive: status.value === '' ? undefined : status.value === 'active',
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

watch([search, roleKey, status], () => {
  page.value = 1;
  void load();
});

watch(page, () => void load());

onMounted(load);

function statusKey(user: AdminUser): string {
  // Three distinct states: a locked account is a different situation from a
  // deactivated one (data-model.md).
  if (!user.isActive) return 'users.status.inactive';
  if (user.isLocked) return 'users.status.locked';
  return 'users.status.active';
}

function clearFilters(): void {
  search.value = '';
  roleKey.value = '';
  status.value = '';
}

function ask(user: AdminUser): void {
  pending.value = user;
  dialogError.value = null;
}

async function confirm(): Promise<void> {
  if (!pending.value) return;

  dialogBusy.value = true;
  dialogError.value = null;

  try {
    await adminUsers.deactivate(pending.value.id);

    pending.value = null;
    await load();
  } catch (cause) {
    // The server's reason is shown IN the dialog rather than swallowed —
    // refusing to deactivate the last administrator must be legible.
    dialogError.value = messageFor(cause);
  } finally {
    dialogBusy.value = false;
  }
}

async function reactivate(user: AdminUser): Promise<void> {
  try {
    await adminUsers.reactivate(user.id);
    await load();
  } catch (cause) {
    error.value = messageFor(cause);
  }
}

async function unlock(user: AdminUser): Promise<void> {
  try {
    await adminUsers.unlock(user.id);
    await load();
  } catch (cause) {
    error.value = messageFor(cause);
  }
}
</script>

<template>
  <section>
    <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
      <h2 class="text-xl font-semibold">{{ t('users.title') }}</h2>
      <RouterLink
        v-if="can('users:create')"
        :to="{ name: 'admin-user-new' }"
        class="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
      >
        {{ t('users.create') }}
      </RouterLink>
    </div>

    <div class="mb-4 flex flex-wrap gap-3">
      <input
        v-model="search"
        type="search"
        :aria-label="t('users.filter.search')"
        :placeholder="t('users.filter.search')"
        class="min-w-56 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <select
        v-model="roleKey"
        :aria-label="t('users.filter.role')"
        class="rounded-md border border-slate-300 px-3 py-2 text-sm"
      >
        <option value="">{{ t('users.filter.all') }}</option>
        <option value="agent">{{ t('role.name.agent') }}</option>
        <option value="supervisor">{{ t('role.name.supervisor') }}</option>
        <option value="admin">{{ t('role.name.admin') }}</option>
      </select>
      <select
        v-model="status"
        :aria-label="t('users.filter.status')"
        class="rounded-md border border-slate-300 px-3 py-2 text-sm"
      >
        <option value="">{{ t('users.filter.all') }}</option>
        <option value="active">{{ t('users.status.active') }}</option>
        <option value="inactive">{{ t('users.status.inactive') }}</option>
      </select>
    </div>

    <p v-if="error" role="alert" class="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
      {{ error }}
    </p>

    <DataTable
      :columns="columns"
      :rows="rows"
      caption-key="users.caption"
      :loading="loading"
      empty-title-key="users.empty.title"
      empty-description-key="users.empty.description"
    >
      <template #cell-role="{ row }">{{ t(row.role.nameKey) }}</template>

      <template #cell-status="{ row }">{{ t(statusKey(row)) }}</template>

      <template #cell-actions="{ row }">
        <div class="flex flex-wrap gap-2">
          <RouterLink
            v-if="can('users:update')"
            :to="{ name: 'admin-user-edit', params: { id: row.id } }"
            class="rounded-md border border-slate-300 px-2 py-1 text-xs"
          >
            {{ t('action.edit') }}
          </RouterLink>

          <button
            v-if="can('users:update') && row.isLocked"
            type="button"
            class="rounded-md border border-slate-300 px-2 py-1 text-xs"
            @click="unlock(row)"
          >
            {{ t('users.action.unlock') }}
          </button>

          <button
            v-if="can('users:deactivate') && row.isActive"
            type="button"
            class="rounded-md border border-slate-300 px-2 py-1 text-xs"
            @click="ask(row)"
          >
            {{ t('users.action.deactivate') }}
          </button>

          <button
            v-if="can('users:deactivate') && !row.isActive"
            type="button"
            class="rounded-md border border-slate-300 px-2 py-1 text-xs"
            @click="reactivate(row)"
          >
            {{ t('users.action.reactivate') }}
          </button>
        </div>
      </template>

      <template #empty-action>
        <button
          v-if="hasFilters"
          type="button"
          class="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          @click="clearFilters"
        >
          {{ t('action.clearFilters') }}
        </button>
      </template>
    </DataTable>

    <TablePagination
      v-if="total > pageSize"
      :page="page"
      :page-size="pageSize"
      :total="total"
      @update:page="page = $event"
    />

    <ConfirmDialog
      :open="pending !== null"
      title-key="users.deactivate.title"
      message-key="users.deactivate.message"
      :confirm-label="t('users.deactivate.confirm', { name: pending?.fullName ?? '' })"
      :error="dialogError ?? undefined"
      :busy="dialogBusy"
      @confirm="confirm"
      @cancel="pending = null"
    />
  </section>
</template>
