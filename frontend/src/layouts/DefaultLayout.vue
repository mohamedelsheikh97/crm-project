<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import LanguageToggle from '../components/LanguageToggle.vue';
import { usePermissions } from '../composables/usePermissions';
import * as authService from '../services/auth.service';
import { useAuthStore } from '../stores/auth.store';

const { t } = useI18n();
const router = useRouter();
const auth = useAuthStore();
const { can, canAny } = usePermissions();

/**
 * The administration area is not offered at all to a user holding none of its
 * permissions (FR-042). This governs display only — every endpoint behind it
 * enforces independently.
 */
const ADMIN_PERMISSIONS = ['users:view', 'roles:view', 'audit:view', 'settings:view'];

async function signOut(): Promise<void> {
  await authService.logout();
  await router.push({ name: 'login' });
}
</script>

<template>
  <a
    href="#main-content"
    class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:shadow"
  >
    {{ t('layout.skipToContent') }}
  </a>

  <div class="min-h-screen">
    <header class="border-b border-slate-200">
      <div class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-4">
        <RouterLink :to="{ name: 'home' }" class="text-lg font-semibold">
          {{ t('app.title') }}
        </RouterLink>

        <div class="flex flex-wrap items-center gap-3">
          <span v-if="auth.user" class="text-sm text-slate-600">
            {{ t('login.signedInAs', { name: auth.user.fullName }) }}
          </span>

          <button
            v-if="auth.isAuthenticated"
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            @click="signOut"
          >
            {{ t('login.signOut') }}
          </button>

          <RouterLink
            v-else
            :to="{ name: 'login' }"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            {{ t('login.submit') }}
          </RouterLink>

          <LanguageToggle />
        </div>
      </div>
    </header>

    <!-- The landmark Phase 0 left empty, populated from this phase. -->
    <nav :aria-label="t('nav.home')" class="mx-auto max-w-5xl px-6">
      <ul v-if="auth.isAuthenticated" class="flex gap-4 py-2 text-sm">
        <li>
          <RouterLink
            :to="{ name: 'home' }"
            class="rounded-md px-2 py-1 text-slate-700 hover:bg-slate-100"
            active-class="font-medium"
          >
            {{ t('nav.home') }}
          </RouterLink>
        </li>
        <li v-if="can('customers:view')">
          <RouterLink
            :to="{ name: 'customer-list' }"
            class="rounded-md px-2 py-1 text-slate-700 hover:bg-slate-100"
            active-class="font-medium"
          >
            {{ t('nav.customers') }}
          </RouterLink>
        </li>
        <li v-if="canAny(ADMIN_PERMISSIONS)">
          <RouterLink
            :to="{ name: 'admin-users' }"
            class="rounded-md px-2 py-1 text-slate-700 hover:bg-slate-100"
          >
            {{ t('nav.admin') }}
          </RouterLink>
        </li>
      </ul>
    </nav>

    <main id="main-content" class="mx-auto max-w-5xl">
      <slot />
    </main>
  </div>
</template>
