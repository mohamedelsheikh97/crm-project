<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { type SupportedLocale } from '../i18n/locale-config';
import { useLocaleStore } from '../stores/locale.store';

const { t } = useI18n();
const localeStore = useLocaleStore();

const nextLocale = computed<SupportedLocale>(() => (localeStore.locale === 'ar' ? 'en' : 'ar'));

// Announces the language it switches TO, not the current one (FR-024).
const label = computed(() => t(`language.switchTo.${nextLocale.value}`));
</script>

<template>
  <button
    type="button"
    :aria-label="label"
    class="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
    @click="localeStore.setLocale(nextLocale)"
  >
    {{ t(`language.name.${nextLocale}`) }}
  </button>
</template>
