<script setup lang="ts">
import { useI18n } from 'vue-i18n';

defineProps<{
  /** i18n key for the heading — never a literal string. */
  titleKey: string;
  /** i18n key for the explanatory line. */
  descriptionKey?: string;
}>();

const { t } = useI18n();
</script>

<template>
  <div class="rounded-md border border-dashed border-slate-300 px-6 py-10 text-center">
    <p class="text-base font-medium text-slate-700">{{ t(titleKey) }}</p>
    <p v-if="descriptionKey" class="mt-2 text-sm text-slate-500">{{ t(descriptionKey) }}</p>
    <div class="mt-4"><slot /></div>
  </div>
</template>
