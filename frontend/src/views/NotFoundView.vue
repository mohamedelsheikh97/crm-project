<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
  <section class="mx-auto max-w-3xl px-6 py-12">
    <h1 class="text-3xl font-semibold tracking-tight">{{ t('notFound.heading') }}</h1>
    <p class="mt-4 text-lg text-slate-600">{{ t('notFound.description') }}</p>
    <RouterLink
      :to="{ name: 'home' }"
      class="mt-6 inline-block rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800"
    >
      {{ t('notFound.backToHome') }}
    </RouterLink>
  </section>
</template>
