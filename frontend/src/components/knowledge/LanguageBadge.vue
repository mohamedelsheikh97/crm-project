<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import type { KbLanguage } from '../../services/knowledge.service';

/**
 * Which language a reader is being handed (FR-005a).
 *
 * NOT DECORATION. Under Clarifications Q3 a one-language article is entirely
 * legitimate, which means a reader will meet articles they cannot read. An
 * unlabelled English article inside an Arabic interface does not look like an
 * English article — it looks like a page that failed to load, and the reader's
 * next move is to reload it rather than to go and find a colleague who reads
 * English.
 *
 * So this appears everywhere an article is listed or opened: the management
 * list, search results, the suggestion panel, and the reader itself.
 *
 * TEXT AND SHAPE, NEVER COLOUR ALONE (FR-056). The language name is written
 * out; nothing here depends on hue.
 */
const props = defineProps<{
  languages: KbLanguage[];
  /** Which one is actually being shown, when the article has both. */
  showing?: KbLanguage;
}>();

const { t } = useI18n();

const labels = computed(() =>
  props.languages.map((language) => ({
    language,
    label: t(`kb.language.${language}`),
    active: props.showing === undefined || props.showing === language,
  })),
);
</script>

<template>
  <!--
    `lang` on each badge so a screen reader pronounces the language name in the
    language it names, rather than reading "العربية" with an English voice.
  -->
  <span v-if="labels.length > 0" class="inline-flex items-center gap-1">
    <span class="sr-only">{{ t('kb.language.available') }}</span>
    <span
      v-for="entry in labels"
      :key="entry.language"
      :lang="entry.language"
      class="rounded border px-1.5 py-0.5 text-xs font-medium"
      :class="
        entry.active
          ? 'border-slate-400 bg-slate-100 text-slate-800'
          : 'border-slate-200 text-slate-500'
      "
    >
      {{ entry.label }}
    </span>
  </span>
  <!--
    An article with no complete language pair is a draft nobody has finished.
    Saying so is more use than showing nothing, because "no badge" and "badge
    failed to render" look identical.
  -->
  <span v-else class="text-xs text-slate-500">{{ t('kb.language.none') }}</span>
</template>
