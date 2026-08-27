<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import FormField from '../components/admin/FormField.vue';
import * as authService from '../services/auth.service';
import { ApiError } from '../services/http';

const { t } = useI18n();
const router = useRouter();
const route = useRoute();

const email = ref('');
const password = ref('');
const submitting = ref(false);
const formError = ref<string | null>(null);
const fieldErrors = ref<Record<string, string>>({});

async function submit(): Promise<void> {
  submitting.value = true;
  formError.value = null;
  fieldErrors.value = {};

  try {
    const user = await authService.login(email.value, password.value);

    // The backend refuses every other route while a password change is owed,
    // so send them straight there rather than letting them bounce off a 403.
    if (user.mustChangePassword) {
      await router.push({ name: 'change-password' });
      return;
    }

    const redirect = route.query.redirect;
    await router.push(typeof redirect === 'string' ? redirect : { name: 'home' });
  } catch (cause) {
    if (cause instanceof ApiError) {
      for (const detail of cause.details) {
        fieldErrors.value[detail.field] = t(detail.message);
      }

      // A single message for every failure mode. The server deliberately does
      // not distinguish a wrong password from an unknown, locked, or
      // deactivated account, and the interface must not invent a distinction
      // the server refused to make (FR-030).
      if (cause.details.length === 0) {
        formError.value = t('login.failed');
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
    <h1 class="mb-6 text-2xl font-semibold tracking-tight">{{ t('login.title') }}</h1>

    <p v-if="route.query.redirect" class="mb-4 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
      {{ t('login.required') }}
    </p>

    <p v-if="formError" role="alert" class="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
      {{ formError }}
    </p>

    <form novalidate @submit.prevent="submit">
      <FormField label-key="login.field.email" :error="fieldErrors.email" required>
        <template #default="{ id, describedBy, invalid }">
          <input
            :id="id"
            v-model="email"
            type="email"
            autocomplete="username"
            :aria-describedby="describedBy"
            :aria-invalid="invalid ? 'true' : undefined"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </template>
      </FormField>

      <FormField label-key="login.field.password" :error="fieldErrors.password" required>
        <template #default="{ id, describedBy, invalid }">
          <input
            :id="id"
            v-model="password"
            type="password"
            autocomplete="current-password"
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
        {{ t('login.submit') }}
      </button>
    </form>
  </section>
</template>
