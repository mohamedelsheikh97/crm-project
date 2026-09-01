<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import * as portalService from '../../services/portal.service';

/**
 * Forgotten and reset password (Phase 8, FR-006, FR-007).
 *
 * ONE COMPONENT FOR BOTH HALVES, because they are one journey and the token in
 * the route is what tells them apart.
 *
 * THE REQUEST HALF ALWAYS REPORTS THE SAME THING. The server always answers 204
 * whether or not the address has portal access, and this screen must not be
 * cleverer than that — "we have sent you a link" for a known address and "no such
 * account" for an unknown one would hand an attacker the customer list one
 * address at a time. The wording is chosen to be true either way: "if that
 * address has portal access, a link is on its way."
 */
const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const token = typeof route.params.token === 'string' ? route.params.token : '';
const isReset = token !== '';

const email = ref('');
const password = ref('');
const requested = ref(false);
const done = ref(false);
const problems = ref<string[]>([]);
const busy = ref(false);

async function request(): Promise<void> {
  busy.value = true;

  try {
    await portalService.requestPasswordReset(email.value);
  } finally {
    // Set REGARDLESS of the outcome, deliberately. A failure that showed
    // differently would be the same disclosure by another route.
    requested.value = true;
    busy.value = false;
  }
}

async function reset(): Promise<void> {
  busy.value = true;
  problems.value = [];

  try {
    await portalService.completePasswordReset(token, password.value);
    done.value = true;
    await router.push({ name: 'portal-login' });
  } catch (error) {
    const details = (error as { details?: Array<{ message: string }> }).details ?? [];
    problems.value =
      details.length > 0
        ? details.map((detail) => detail.message)
        : [t('portal.invite.invalid.hint')];
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-md">
    <h1 class="text-xl font-semibold">{{ t('portal.reset.title') }}</h1>

    <template v-if="!isReset">
      <p v-if="requested" role="status" class="mt-4 text-sm text-slate-700">
        {{ t('portal.reset.requested') }}
      </p>

      <form v-else class="mt-6 space-y-4" novalidate @submit.prevent="request">
        <p class="text-sm text-slate-600">{{ t('portal.reset.request') }}</p>

        <div>
          <label for="reset-email" class="block text-sm font-medium text-slate-700">
            {{ t('portal.login.field.email') }}
          </label>
          <input
            id="reset-email"
            v-model="email"
            type="email"
            autocomplete="email"
            required
            class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </div>

        <button
          type="submit"
          :disabled="busy"
          class="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {{ t('portal.reset.submit') }}
        </button>
      </form>
    </template>

    <template v-else>
      <p v-if="done" role="status" class="mt-4 text-sm text-slate-700">
        {{ t('portal.reset.done') }}
      </p>

      <form v-else class="mt-6 space-y-4" novalidate @submit.prevent="reset">
        <ul
          v-if="problems.length > 0"
          role="alert"
          class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          <li v-for="problem of problems" :key="problem">{{ problem }}</li>
        </ul>

        <div>
          <label for="reset-password" class="block text-sm font-medium text-slate-700">
            {{ t('portal.reset.field.password') }}
          </label>
          <input
            id="reset-password"
            v-model="password"
            type="password"
            autocomplete="new-password"
            required
            class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          />
          <p class="mt-1 text-xs text-slate-500">{{ t('changePassword.requirements') }}</p>
        </div>

        <button
          type="submit"
          :disabled="busy"
          class="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {{ t('portal.reset.submit') }}
        </button>
      </form>
    </template>
  </div>
</template>
