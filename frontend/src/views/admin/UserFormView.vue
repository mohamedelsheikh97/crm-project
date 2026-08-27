<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import FormField from '../../components/admin/FormField.vue';
import { usePermissions } from '../../composables/usePermissions';
import * as adminUsers from '../../services/admin-users.service';
import { ApiError } from '../../services/http';
import { useAuthStore } from '../../stores/auth.store';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const { can } = usePermissions();

const id = computed(() => (route.params.id ? Number(route.params.id) : null));
const isEdit = computed(() => id.value !== null);

const email = ref('');
const fullName = ref('');
const roleKey = ref('agent');
const initialPassword = ref('');
const version = ref(0);

const resetPassword = ref('');
const resetMessage = ref<string | null>(null);

const loading = ref(false);
const submitting = ref(false);
const formError = ref<string | null>(null);
const fieldErrors = ref<Record<string, string>>({});

/** True when the administrator is editing their own account. */
const isSelf = computed(() => isEdit.value && auth.user?.id === id.value);
const selfRoleChanging = computed(() => isSelf.value && roleKey.value !== auth.user?.role.key);

function applyError(cause: unknown): void {
  fieldErrors.value = {};
  formError.value = null;

  if (cause instanceof ApiError) {
    // The server's details[] maps onto fields by name, so each message lands
    // beside the control it belongs to rather than in a generic banner.
    for (const detail of cause.details) {
      fieldErrors.value[detail.field] = t(detail.message);
    }

    if (cause.details.length === 0) {
      formError.value =
        cause.code === 'CONFLICT'
          ? t('error.conflict')
          : cause.code === 'FORBIDDEN'
            ? t('error.forbidden')
            : t('error.unexpected');
    }

    return;
  }

  formError.value = t('error.unexpected');
}

/** Moves focus to the first invalid control so a keyboard user is not stranded. */
function focusFirstError(): void {
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  });
}

async function load(): Promise<void> {
  if (!isEdit.value || id.value === null) return;

  loading.value = true;

  try {
    const user = await adminUsers.get(id.value);
    email.value = user.email;
    fullName.value = user.fullName;
    roleKey.value = user.role.key;
    version.value = user.version;
  } catch (cause) {
    applyError(cause);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function submit(): Promise<void> {
  submitting.value = true;
  fieldErrors.value = {};
  formError.value = null;

  try {
    if (isEdit.value && id.value !== null) {
      await adminUsers.update(id.value, {
        fullName: fullName.value,
        roleKey: roleKey.value,
        version: version.value,
      });
    } else {
      await adminUsers.create({
        email: email.value,
        fullName: fullName.value,
        roleKey: roleKey.value,
        initialPassword: initialPassword.value,
      });
    }

    await router.push({ name: 'admin-users' });
  } catch (cause) {
    applyError(cause);
    focusFirstError();
  } finally {
    submitting.value = false;
  }
}

async function submitReset(): Promise<void> {
  if (id.value === null) return;

  submitting.value = true;
  resetMessage.value = null;

  try {
    await adminUsers.resetPassword(id.value, resetPassword.value);
    resetPassword.value = '';
    resetMessage.value = t('userForm.forcedChangeNotice');
  } catch (cause) {
    applyError(cause);
    focusFirstError();
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="max-w-xl">
    <h2 class="mb-6 text-xl font-semibold">
      {{ t(isEdit ? 'userForm.editTitle' : 'userForm.createTitle') }}
    </h2>

    <p v-if="formError" role="alert" class="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
      {{ formError }}
    </p>

    <form novalidate @submit.prevent="submit">
      <FormField label-key="userForm.field.email" :error="fieldErrors.email" required>
        <template #default="{ id: fieldId, describedBy, invalid }">
          <input
            :id="fieldId"
            v-model="email"
            type="email"
            :disabled="isEdit"
            :aria-describedby="describedBy"
            :aria-invalid="invalid ? 'true' : undefined"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
          />
        </template>
      </FormField>

      <!-- The email is the login identifier and the audit log references it. -->
      <p v-if="isEdit" class="-mt-2 mb-4 text-xs text-slate-500">
        {{ t('userForm.emailImmutable') }}
      </p>

      <FormField label-key="userForm.field.fullName" :error="fieldErrors.fullName" required>
        <template #default="{ id: fieldId, describedBy, invalid }">
          <input
            :id="fieldId"
            v-model="fullName"
            type="text"
            :aria-describedby="describedBy"
            :aria-invalid="invalid ? 'true' : undefined"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </template>
      </FormField>

      <FormField label-key="userForm.field.role" :error="fieldErrors.roleKey" required>
        <template #default="{ id: fieldId, describedBy, invalid }">
          <select
            :id="fieldId"
            v-model="roleKey"
            :aria-describedby="describedBy"
            :aria-invalid="invalid ? 'true' : undefined"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="agent">{{ t('role.name.agent') }}</option>
            <option value="supervisor">{{ t('role.name.supervisor') }}</option>
            <option value="admin">{{ t('role.name.admin') }}</option>
          </select>
        </template>
      </FormField>

      <p
        v-if="selfRoleChanging"
        role="alert"
        class="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800"
      >
        {{ t('userForm.selfRoleWarning') }}
      </p>

      <template v-if="!isEdit">
        <FormField
          label-key="userForm.field.initialPassword"
          :error="fieldErrors.initialPassword"
          required
        >
          <template #default="{ id: fieldId, describedBy, invalid }">
            <input
              :id="fieldId"
              v-model="initialPassword"
              type="password"
              autocomplete="new-password"
              :aria-describedby="describedBy"
              :aria-invalid="invalid ? 'true' : undefined"
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </template>
        </FormField>

        <p class="-mt-2 mb-4 text-xs text-slate-500">{{ t('userForm.forcedChangeNotice') }}</p>
      </template>

      <div class="mt-6 flex gap-3">
        <button
          type="submit"
          :disabled="submitting || loading"
          class="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {{ t(isEdit ? 'action.save' : 'action.create') }}
        </button>
        <RouterLink
          :to="{ name: 'admin-users' }"
          class="rounded-md border border-slate-300 px-4 py-2 text-sm"
        >
          {{ t('action.cancel') }}
        </RouterLink>
      </div>
    </form>

    <form
      v-if="isEdit && can('users:reset_password')"
      class="mt-10 border-t border-slate-200 pt-6"
      novalidate
      @submit.prevent="submitReset"
    >
      <h3 class="mb-4 text-base font-semibold">{{ t('users.action.resetPassword') }}</h3>

      <p v-if="resetMessage" role="alert" class="mb-3 rounded-md bg-green-50 p-3 text-sm">
        {{ resetMessage }}
      </p>

      <FormField label-key="userForm.field.newPassword" :error="fieldErrors.newPassword">
        <template #default="{ id: fieldId, describedBy, invalid }">
          <input
            :id="fieldId"
            v-model="resetPassword"
            type="password"
            autocomplete="new-password"
            :aria-describedby="describedBy"
            :aria-invalid="invalid ? 'true' : undefined"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </template>
      </FormField>

      <button
        type="submit"
        :disabled="submitting || !resetPassword"
        class="rounded-md border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
      >
        {{ t('users.action.resetPassword') }}
      </button>
    </form>
  </section>
</template>
