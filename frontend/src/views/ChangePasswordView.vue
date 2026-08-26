<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import FormField from '../components/admin/FormField.vue';
import * as authService from '../services/auth.service';
import { ApiError } from '../services/http';
import { useAuthStore } from '../stores/auth.store';

const { t } = useI18n();
const router = useRouter();
const auth = useAuthStore();

const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');

const submitting = ref(false);
const formError = ref<string | null>(null);
const fieldErrors = ref<Record<string, string>>({});

const forced = computed(() => auth.mustChangePassword);

/**
 * Shown up front rather than only after a failed attempt — a user should know
 * what is required before typing, not after (contracts/admin-ui.md).
 */
const requirements = [
  'password.rule.minLength',
  'password.rule.lowercase',
  'password.rule.uppercase',
  'password.rule.digit',
];

async function submit(): Promise<void> {
  fieldErrors.value = {};
  formError.value = null;

  if (newPassword.value !== confirmPassword.value) {
    fieldErrors.value.confirmPassword = t('changePassword.mismatch');
    return;
  }

  submitting.value = true;

  try {
    await authService.changePassword(currentPassword.value, newPassword.value);
    await router.push({ name: 'home' });
  } catch (cause) {
    if (cause instanceof ApiError) {
      for (const detail of cause.details) {
        fieldErrors.value[detail.field] = t(detail.message);
      }

      if (cause.details.length === 0) {
        // 401 here means the current password was wrong — a failed credential
        // check, not a malformed request.
        formError.value =
          cause.status === 401 ? t('changePassword.wrongCurrent') : t('error.unexpected');
      }
    } else {
      formError.value = t('error.unexpected');
    }

    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    });
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="mx-auto max-w-md px-6 py-12">
    <h1 class="mb-2 text-2xl font-semibold tracking-tight">{{ t('changePassword.title') }}</h1>

    <p v-if="forced" class="mb-6 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
      {{ t('changePassword.forcedNotice') }}
    </p>

    <div class="mb-6 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
      <p class="mb-1 font-medium">{{ t('changePassword.requirements') }}</p>
      <ul class="list-inside list-disc">
        <li v-for="rule in requirements" :key="rule">{{ t(rule) }}</li>
      </ul>
    </div>

    <p v-if="formError" role="alert" class="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
      {{ formError }}
    </p>

    <form novalidate @submit.prevent="submit">
      <FormField
        label-key="changePassword.field.current"
        :error="fieldErrors.currentPassword"
        required
      >
        <template #default="{ id, describedBy, invalid }">
          <input
            :id="id"
            v-model="currentPassword"
            type="password"
            autocomplete="current-password"
            :aria-describedby="describedBy"
            :aria-invalid="invalid ? 'true' : undefined"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </template>
      </FormField>

      <FormField label-key="changePassword.field.new" :error="fieldErrors.newPassword" required>
        <template #default="{ id, describedBy, invalid }">
          <input
            :id="id"
            v-model="newPassword"
            type="password"
            autocomplete="new-password"
            :aria-describedby="describedBy"
            :aria-invalid="invalid ? 'true' : undefined"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </template>
      </FormField>

      <FormField
        label-key="changePassword.field.confirm"
        :error="fieldErrors.confirmPassword"
        required
      >
        <template #default="{ id, describedBy, invalid }">
          <input
            :id="id"
            v-model="confirmPassword"
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
        :disabled="submitting"
        class="mt-2 w-full rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {{ t('changePassword.submit') }}
      </button>
    </form>
  </section>
</template>
