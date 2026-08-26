<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
  <section class="mx-auto max-w-3xl px-6 py-12">
    <h1 class="text-3xl font-semibold tracking-tight">{{ t('home.heading') }}</h1>
    <p class="mt-4 text-lg text-slate-600">{{ t('home.description') }}</p>
  </section>
</template>
