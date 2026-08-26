<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

import EmptyState from '../../components/admin/EmptyState.vue';

const { t } = useI18n();

/**
 * The shell (FR-043). Each section is present and navigable now; its content
 * arrives with the phase that owns it.
 *
 * The empty state says so plainly — not an error, not a blank panel, and not a
 * "coming soon" that reads like a bug.
 */
const sections = [
  { key: 'categories', nameKey: 'settings.section.categories' },
  { key: 'templates', nameKey: 'settings.section.templates' },
  { key: 'channels', nameKey: 'settings.section.channels' },
] as const;

const active = ref<string>(sections[0].key);
</script>

<template>
  <section>
    <h2 class="mb-6 text-xl font-semibold">{{ t('settings.title') }}</h2>

    <div class="mb-6 flex flex-wrap gap-2" role="tablist">
      <button
        v-for="section in sections"
        :key="section.key"
        type="button"
        role="tab"
        :aria-selected="active === section.key"
        :class="[
          'rounded-md border px-3 py-1.5 text-sm',
          active === section.key
            ? 'border-blue-700 bg-blue-50 font-medium text-blue-800'
            : 'border-slate-300 text-slate-700',
        ]"
        @click="active = section.key"
      >
        {{ t(section.nameKey) }}
      </button>
    </div>

    <div
      v-for="section in sections"
      v-show="active === section.key"
      :key="section.key"
      role="tabpanel"
    >
      <EmptyState :title-key="section.nameKey" description-key="settings.comingLater" />
    </div>
  </section>
</template>
