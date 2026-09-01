<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import * as portalService from '../../services/portal.service';

/**
 * Accepting an invitation (Phase 8, User Story 1).
 *
 * THE MOST DANGEROUS SCREEN IN THE PHASE, and not for a technical reason. An
 * unexpected email containing a link, opening a page that asks for a password,
 * is exactly what a phishing attempt looks like. A customer who is right to be
 * suspicious will not use the portal, and a customer who is NOT suspicious enough
 * is being trained to click such links.
 *
 * So the order on the page is: WHO is inviting you, WHICH address it was sent to,
 * and only then a password field. Everything the recipient needs in order to
 * decide the mail is genuine comes before anything is asked of them.
 *
 * ONE MESSAGE FOR ALL FOUR INVALID CASES — expired, used, revoked, unknown —
 * because the server gives one (FR-002c), with a route to ask for a new
 * invitation rather than a dead end.
 */
const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();

const token = String(route.params.token ?? '');

const loading = ref(true);
const invalid = ref(false);
const organisationName = ref('');
const email = ref('');

const password = ref('');
const confirm = ref('');
const mismatch = ref(false);
const problems = ref<string[]>([]);
const busy = ref(false);

onMounted(async () => {
  try {
    const view = await portalService.viewInvitation(token);
    organisationName.value = view.organisationName;
    email.value = view.email;
  } catch {
    invalid.value = true;
  } finally {
    loading.value = false;
  }
});

async function submit(): Promise<void> {
  mismatch.value = password.value !== confirm.value;
  problems.value = [];

  if (mismatch.value) return;

  busy.value = true;

  try {
    await portalService.acceptInvitation(
      token,
      password.value,
      locale.value === 'ar' ? 'ar' : 'en',
    );
    // Signed in already: making somebody who has just chosen a password type it
    // again is a step that exists only because the code was easier that way.
    await router.push({ name: 'portal-requests' });
  } catch (error) {
    const details = (error as { details?: Array<{ message: string }> }).details ?? [];
    problems.value = details.map((detail) => detail.message);

    if (problems.value.length === 0) invalid.value = true;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-md">
    <p v-if="loading" class="text-sm text-slate-600">{{ t('table.loading') }}</p>

    <div v-else-if="invalid" role="alert" class="rounded-md border border-slate-200 bg-white p-4">
      <h1 class="text-lg font-semibold">{{ t('portal.invite.invalid.title') }}</h1>
      <p class="mt-2 text-sm text-slate-600">{{ t('portal.invite.invalid.hint') }}</p>
    </div>

    <template v-else>
      <h1 class="text-xl font-semibold">{{ t('portal.invite.title') }}</h1>

      <!-- WHO, then WHICH ADDRESS, then the ask. See the header. -->
      <p class="mt-3 text-sm text-slate-700">
        {{ t('portal.invite.intro', { organisation: organisationName }) }}
      </p>
      <p class="mt-1 text-sm text-slate-600">{{ t('portal.invite.forAddress', { email }) }}</p>

      <form class="mt-6 space-y-4" novalidate @submit.prevent="submit">
        <ul
          v-if="problems.length > 0"
          role="alert"
          class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          <li v-for="problem of problems" :key="problem">{{ problem }}</li>
        </ul>

        <div>
          <label for="invite-password" class="block text-sm font-medium text-slate-700">
            {{ t('portal.invite.field.password') }}
          </label>
          <input
            id="invite-password"
            v-model="password"
            type="password"
            autocomplete="new-password"
            required
            class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          />
          <p class="mt-1 text-xs text-slate-500">{{ t('changePassword.requirements') }}</p>
        </div>

        <div>
          <label for="invite-confirm" class="block text-sm font-medium text-slate-700">
            {{ t('portal.invite.field.confirm') }}
          </label>
          <input
            id="invite-confirm"
            v-model="confirm"
            type="password"
            autocomplete="new-password"
            required
            :aria-invalid="mismatch"
            aria-describedby="invite-mismatch"
            class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          />
          <p v-if="mismatch" id="invite-mismatch" role="alert" class="mt-1 text-sm text-red-700">
            {{ t('portal.invite.mismatch') }}
          </p>
        </div>

        <button
          type="submit"
          :disabled="busy"
          class="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {{ t('portal.invite.submit') }}
        </button>
      </form>
    </template>
  </div>
</template>
