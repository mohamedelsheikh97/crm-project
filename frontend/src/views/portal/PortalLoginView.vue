<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import * as portalService from '../../services/portal.service';

/**
 * Portal sign-in (Phase 8, User Story 1).
 *
 * ONE ERROR MESSAGE FOR EVERY FAILURE, because the server gives one answer for
 * six causes (FR-006) and a screen that guessed at more would undo it. "We do
 * not recognise that address" is the single most common way a support portal
 * leaks its customer list.
 *
 * NO "CREATE AN ACCOUNT" LINK, and the note in its place is deliberate: a
 * customer who cannot get in needs to know that access is by invitation, or they
 * will hunt for a registration form that does not exist and conclude the site is
 * broken.
 */
const { t } = useI18n();
const router = useRouter();

const email = ref('');
const password = ref('');
const failed = ref(false);
const busy = ref(false);

async function submit(): Promise<void> {
  busy.value = true;
  failed.value = false;

  try {
    await portalService.login(email.value, password.value);
    await router.push({ name: 'portal-requests' });
  } catch {
    // Deliberately not branched on the error code. See the header.
    failed.value = true;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-md">
    <h1 class="text-xl font-semibold">{{ t('portal.login.title') }}</h1>

    <form class="mt-6 space-y-4" novalidate @submit.prevent="submit">
      <p
        v-if="failed"
        role="alert"
        class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
      >
        {{ t('portal.login.failed') }}
      </p>

      <div>
        <label for="portal-email" class="block text-sm font-medium text-slate-700">
          {{ t('portal.login.field.email') }}
        </label>
        <input
          id="portal-email"
          v-model="email"
          type="email"
          autocomplete="email"
          required
          class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
        />
      </div>

      <div>
        <label for="portal-password" class="block text-sm font-medium text-slate-700">
          {{ t('portal.login.field.password') }}
        </label>
        <input
          id="portal-password"
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
          class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
        />
      </div>

      <button
        type="submit"
        :disabled="busy"
        class="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {{ t('portal.login.submit') }}
      </button>

      <RouterLink
        :to="{ name: 'portal-forgot' }"
        class="block text-sm text-slate-600 underline hover:text-slate-900"
      >
        {{ t('portal.login.forgot') }}
      </RouterLink>

      <p class="border-t border-slate-200 pt-4 text-sm text-slate-600">
        {{ t('portal.login.noAccount') }}
      </p>
    </form>
  </div>
</template>
