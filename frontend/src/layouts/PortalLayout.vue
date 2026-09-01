<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import LanguageToggle from '../components/LanguageToggle.vue';
import * as portalService from '../services/portal.service';
import { usePortalStore } from '../stores/portal.store';

/**
 * THE THIRD SHELL (Phase 8, FR-063, research.md D13).
 *
 * Not `DefaultLayout` with items hidden. An item removed by a `v-if` comes back
 * the first time somebody edits the shared file, and Constitution Principle II is
 * explicit that hiding is not a control — so the portal's chrome is built from
 * nothing rather than subtracted from the staff application's.
 *
 * WHAT IS NOT HERE, and none of it by accident: no navigation into signed-in
 * staff areas, no permission-derived menu, no notification bell, no queue, no
 * search across records, and no vocabulary from the internal application. A
 * customer is not a lesser user of this system; they are a different audience,
 * and every affordance they cannot use is a door they will try.
 *
 * MOBILE FIRST, which no previous surface in this project has been. A customer
 * checking a request is holding a phone: the nav wraps, the targets are large
 * enough to hit, and nothing relies on hover.
 */
const { t } = useI18n();
const router = useRouter();
const portal = usePortalStore();

async function signOut(): Promise<void> {
  await portalService.logout();
  await router.push({ name: 'portal-login' });
}
</script>

<template>
  <a
    href="#portal-content"
    class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:shadow"
  >
    {{ t('layout.skipToContent') }}
  </a>

  <div class="min-h-screen bg-slate-50">
    <header class="border-b border-slate-200 bg-white">
      <div class="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-4">
        <RouterLink :to="{ name: 'portal-requests' }" class="text-lg font-semibold">
          {{ t('portal.title') }}
        </RouterLink>

        <div class="flex flex-wrap items-center gap-2">
          <!-- Present before sign-in too: the login screen is the first thing an
               Arabic-speaking customer sees (FR-061). -->
          <LanguageToggle />

          <template v-if="portal.accessToken">
            <span class="hidden text-sm text-slate-600 sm:inline">
              {{ t('portal.signedInAs', { email: portal.email }) }}
            </span>

            <button
              type="button"
              class="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              @click="signOut"
            >
              {{ t('portal.signOut') }}
            </button>
          </template>
        </div>
      </div>

      <nav
        v-if="portal.accessToken"
        class="mx-auto flex max-w-3xl flex-wrap gap-1 px-4 pb-2"
        :aria-label="t('portal.title')"
      >
        <RouterLink
          :to="{ name: 'portal-requests' }"
          class="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          active-class="bg-slate-100 text-slate-900"
        >
          {{ t('portal.nav.requests') }}
        </RouterLink>

        <RouterLink
          :to="{ name: 'portal-new-request' }"
          class="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          active-class="bg-slate-100 text-slate-900"
        >
          {{ t('portal.nav.newRequest') }}
        </RouterLink>

        <RouterLink
          :to="{ name: 'portal-help' }"
          class="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          active-class="bg-slate-100 text-slate-900"
        >
          {{ t('portal.nav.help') }}
        </RouterLink>
      </nav>
    </header>

    <main id="portal-content" class="mx-auto max-w-3xl px-4 py-6">
      <slot />
    </main>
  </div>
</template>
