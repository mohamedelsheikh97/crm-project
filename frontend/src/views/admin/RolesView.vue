<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { usePermissions } from '../../composables/usePermissions';
import * as adminRoles from '../../services/admin-roles.service';
import type { AdminRole, PermissionModule } from '../../services/admin-roles.service';
import { ApiError } from '../../services/http';
import { useAuthStore } from '../../stores/auth.store';

const { t } = useI18n();
const { can } = usePermissions();
const auth = useAuthStore();

/**
 * Removing either of these from every role would lock the system out of its own
 * administration (FR-018). The server refuses it; the interface makes that
 * legible BEFORE submission rather than surprising the user with a rejection.
 */
const PROTECTED = ['users:update', 'roles:update_permissions'];

const roles = ref<AdminRole[]>([]);
const modules = ref<PermissionModule[]>([]);
const selected = ref<Record<number, Set<string>>>({});
const loading = ref(false);
const saving = ref<number | null>(null);
const error = ref<string | null>(null);
const saved = ref<number | null>(null);

const catalogKeys = computed(
  () => new Set(modules.value.flatMap((module) => module.actions.map((action) => action.key))),
);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    const [roleResult, catalogResult] = await Promise.all([
      adminRoles.list(),
      adminRoles.permissionCatalog(),
    ]);

    roles.value = roleResult.items;
    modules.value = catalogResult.modules;
    selected.value = Object.fromEntries(
      roleResult.items.map((role) => [role.id, new Set(role.permissions)]),
    );
  } catch {
    error.value = t('error.unexpected');
  } finally {
    loading.value = false;
  }
}

onMounted(load);

/** Grants held by a role whose key is no longer in the catalog. */
function staleGrants(role: AdminRole): string[] {
  return role.permissions.filter((key) => !catalogKeys.value.has(key));
}

/**
 * True when unticking this box would leave no role holding a protected
 * capability — i.e. when the server would refuse the save.
 */
function wouldOrphan(roleId: number, key: string): boolean {
  if (!PROTECTED.includes(key)) return false;
  if (!selected.value[roleId]?.has(key)) return false;

  return !roles.value.some((role) => role.id !== roleId && selected.value[role.id]?.has(key));
}

/** Unticking a capability the acting user holds would strip their own access. */
function wouldStripSelf(roleId: number, key: string): boolean {
  return (
    PROTECTED.includes(key) &&
    auth.user?.role.key === roles.value.find((role) => role.id === roleId)?.key &&
    Boolean(selected.value[roleId]?.has(key))
  );
}

function toggle(roleId: number, key: string): void {
  const set = selected.value[roleId];
  if (!set) return;

  if (set.has(key)) {
    set.delete(key);
  } else {
    set.add(key);
  }

  // Reassign so Vue sees the change — a Set mutation alone is not reactive.
  selected.value = { ...selected.value, [roleId]: new Set(set) };
}

async function save(role: AdminRole): Promise<void> {
  saving.value = role.id;
  error.value = null;
  saved.value = null;

  try {
    // Stale grants are dropped here: only catalog keys are sent.
    const permissions = [...(selected.value[role.id] ?? [])].filter((key) =>
      catalogKeys.value.has(key),
    );

    await adminRoles.replacePermissions(role.id, permissions, role.version);
    saved.value = role.id;
    await load();
  } catch (cause) {
    error.value =
      cause instanceof ApiError
        ? cause.code === 'CONFLICT'
          ? t('error.conflict')
          : cause.code === 'FORBIDDEN'
            ? t('error.forbidden')
            : t('error.unexpected')
        : t('error.unexpected');
  } finally {
    saving.value = null;
  }
}
</script>

<template>
  <section>
    <h2 class="mb-2 text-xl font-semibold">{{ t('roles.title') }}</h2>

    <!-- The set is fixed by decision, not by omission — say so. -->
    <p class="mb-6 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
      {{ t('roles.fixedNotice') }}
    </p>

    <p v-if="error" role="alert" class="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
      {{ error }}
    </p>

    <p v-if="loading" class="text-sm text-slate-500">{{ t('table.loading') }}</p>

    <div v-for="role in roles" :key="role.id" class="mb-8 rounded-md border border-slate-200 p-5">
      <div class="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h3 class="text-lg font-semibold">{{ t(role.nameKey) }}</h3>
        <span class="text-sm text-slate-500">{{
          t('roles.userCount', { count: role.userCount })
        }}</span>
      </div>
      <p class="mb-4 text-sm text-slate-600">{{ t(role.descriptionKey) }}</p>

      <p
        v-if="staleGrants(role).length > 0"
        class="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800"
      >
        {{ t('roles.staleGrant') }}
      </p>

      <div v-for="module in modules" :key="module.key" class="mb-4">
        <h4 class="mb-2 text-sm font-medium text-slate-700">{{ t(module.nameKey) }}</h4>
        <ul class="flex flex-col gap-1">
          <li v-for="action in module.actions" :key="action.key">
            <label class="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                class="mt-1"
                :checked="selected[role.id]?.has(action.key)"
                :disabled="
                  !can('roles:update_permissions') ||
                  wouldOrphan(role.id, action.key) ||
                  wouldStripSelf(role.id, action.key)
                "
                @change="toggle(role.id, action.key)"
              />
              <span>
                {{ t(action.nameKey) }}
                <!-- Explained before submission, not discovered by refusal. -->
                <span
                  v-if="wouldOrphan(role.id, action.key) || wouldStripSelf(role.id, action.key)"
                  class="block text-xs text-slate-500"
                >
                  {{ t('roles.protectedNotice') }}
                </span>
              </span>
            </label>
          </li>
        </ul>
      </div>

      <div v-if="can('roles:update_permissions')" class="flex items-center gap-3">
        <button
          type="button"
          :disabled="saving === role.id"
          class="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          @click="save(role)"
        >
          {{ t('roles.save') }}
        </button>
        <span v-if="saved === role.id" role="alert" class="text-sm text-green-700">
          {{ t('roles.saved') }}
        </span>
      </div>
    </div>
  </section>
</template>
