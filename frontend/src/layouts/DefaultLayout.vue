<script setup lang="ts">
import { useI18n } from 'vue-i18n';

import LanguageToggle from '../components/LanguageToggle.vue';

const { t } = useI18n();
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
      <div class="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <span class="text-lg font-semibold">{{ t('app.title') }}</span>
        <LanguageToggle />
      </div>
    </header>

    <!-- Populated from Phase 1; the landmark exists now so later screens slot in. -->
    <nav :aria-label="t('nav.home')" class="mx-auto max-w-5xl px-6"></nav>

    <main id="main-content" class="mx-auto max-w-5xl">
      <slot />
    </main>
  </div>
</template>
