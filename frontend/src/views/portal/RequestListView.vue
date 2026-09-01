<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import * as portalService from '../../services/portal.service';
import type { PortalTicketSummary } from '../../services/portal.service';

/**
 * The customer's own requests (Phase 8, User Story 3).
 *
 * THE EMPTY STATE IS THE MOST IMPORTANT THING ON THIS SCREEN, which is not a
 * sentence one writes often.
 *
 * Clarifications Q2 scopes the portal to the signing-in contact, and FR-026f
 * makes a ticket with no recorded requester invisible rather than visible to
 * everybody on the record. Together those mean that AT LAUNCH, a newly invited
 * customer very often sees nothing at all — their history predates the
 * association. That is the correct behaviour and it will be the first support
 * call about the portal.
 *
 * So this screen says two things when the list is empty: "you have no open
 * requests", with a prominent way to raise one, and a quieter line for somebody
 * who expected to see history. Neither is styled as an error, because neither is
 * one.
 */
const { t, d } = useI18n();

const loading = ref(true);
const failed = ref(false);
const items = ref<PortalTicketSummary[]>([]);

const open = computed(() => items.value.filter((item) => !item.isSettled));
const settled = computed(() => items.value.filter((item) => item.isSettled));

onMounted(async () => {
  try {
    const page = await portalService.listRequests();
    items.value = page.items;
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
});

function stateLabel(state: string): string {
  // From the declared mapping's key, never from an internal status string.
  return t(`portal.state.${state}`);
}
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-xl font-semibold">{{ t('portal.requests.title') }}</h1>

      <RouterLink
        :to="{ name: 'portal-new-request' }"
        class="rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white"
      >
        {{ t('portal.nav.newRequest') }}
      </RouterLink>
    </div>

    <p v-if="loading" role="status" class="mt-6 text-sm text-slate-600">{{ t('table.loading') }}</p>

    <p
      v-else-if="failed"
      role="alert"
      class="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
    >
      {{ t('portal.error.unexpected') }}
    </p>

    <!-- THE EMPTY STATE. Announced, not merely rendered: a customer using a
         screen reader must be able to tell "nothing here" from "still loading". -->
    <section
      v-else-if="items.length === 0"
      role="status"
      class="mt-6 rounded-md border border-slate-200 bg-white p-6 text-center"
    >
      <h2 class="text-base font-semibold">{{ t('portal.requests.empty.title') }}</h2>
      <p class="mx-auto mt-2 max-w-sm text-sm text-slate-600">
        {{ t('portal.requests.empty.hint') }}
      </p>

      <RouterLink
        :to="{ name: 'portal-new-request' }"
        class="mt-4 inline-block rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white"
      >
        {{ t('portal.nav.newRequest') }}
      </RouterLink>

      <!-- The quieter half, for the customer who expected to see history.
           Deliberately not an error and deliberately not hidden. -->
      <p class="mt-6 border-t border-slate-100 pt-4 text-xs text-slate-500">
        {{ t('portal.requests.empty.history') }}
      </p>
    </section>

    <template v-else>
      <section v-if="open.length > 0" class="mt-6">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {{ t('portal.requests.open') }}
        </h2>
        <ul class="mt-2 space-y-2">
          <li v-for="item of open" :key="item.reference">
            <RouterLink
              :to="{ name: 'portal-request', params: { reference: item.reference } }"
              class="block rounded-md border border-slate-200 bg-white p-4 hover:border-slate-300"
            >
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <span class="font-medium">{{ item.subject }}</span>
                <!-- TEXT, not colour alone (Principle IV). -->
                <span class="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                  {{ stateLabel(item.state) }}
                </span>
              </div>
              <p class="mt-1 text-xs text-slate-500">
                {{ item.reference }} · {{ d(new Date(item.lastChangedAt), 'short') }}
              </p>
            </RouterLink>
          </li>
        </ul>
      </section>

      <section v-if="settled.length > 0" class="mt-6">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {{ t('portal.requests.settled') }}
        </h2>
        <ul class="mt-2 space-y-2">
          <li v-for="item of settled" :key="item.reference">
            <RouterLink
              :to="{ name: 'portal-request', params: { reference: item.reference } }"
              class="block rounded-md border border-slate-200 bg-slate-50 p-4 hover:border-slate-300"
            >
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <span class="font-medium text-slate-700">{{ item.subject }}</span>
                <span
                  class="rounded-full border border-slate-300 px-2.5 py-1 text-xs text-slate-600"
                >
                  {{ stateLabel(item.state) }}
                </span>
              </div>
              <p class="mt-1 text-xs text-slate-500">
                {{ item.reference }} · {{ d(new Date(item.lastChangedAt), 'short') }}
              </p>
            </RouterLink>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
