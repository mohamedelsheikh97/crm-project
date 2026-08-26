<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import { useAuthStore } from '../stores/auth.store';

const { t } = useI18n();
const route = useRoute();
const auth = useAuthStore();
</script>

<template>
  <section class="mx-auto max-w-3xl px-6 py-12">
    <!--
      A permission redirect lands here. Without this the user is bounced with no
      explanation, which reads like a broken link rather than a refusal.
    -->
    <p
      v-if="route.query.denied"
      role="alert"
      class="mb-6 rounded-md bg-amber-50 p-3 text-sm text-amber-800"
    >
      {{ t('error.noPermission') }}
    </p>

    <h1 class="text-3xl font-semibold tracking-tight">{{ t('home.heading') }}</h1>
    <p class="mt-4 text-lg text-slate-600">{{ t('home.description') }}</p>

    <p v-if="!auth.isAuthenticated" class="mt-6">
      <RouterLink
        :to="{ name: 'login' }"
        class="inline-block rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800"
      >
        {{ t('login.submit') }}
      </RouterLink>
      <span class="ms-3 text-sm text-slate-600">{{ t('home.signedOut') }}</span>
    </p>
  </section>
</template>
