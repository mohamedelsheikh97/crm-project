<script setup lang="ts">
import { useI18n } from 'vue-i18n';

import LanguageBadge from './LanguageBadge.vue';
import type { KbLanguage, KbSearchResult } from '../../services/knowledge.service';

/**
 * Search results (FR-021, FR-024, FR-029).
 *
 * THREE STATES, AND ALL THREE ARE REAL STATES:
 *
 *   results        — title, category, language, and the matched excerpt.
 *   nothing        — an explicit line saying so, plus what to try next. NEVER a
 *                    blank region: a blank region reads as a page that failed
 *                    to load, and the reader's next move is to reload rather
 *                    than to rephrase.
 *   nothing here,  — the cross-language offer, rendered as a CONTROL the reader
 *   something      chooses. Never as results silently substituted: being handed
 *   over there     content in a language you did not ask for, unlabelled, is
 *                  exactly what FR-005a exists to prevent.
 */

defineProps<{
  result: KbSearchResult | null;
  searching: boolean;
  /** True once a query has actually been run, so the idle state is not "nothing matched". */
  searched: boolean;
}>();

const emit = defineEmits<{
  (event: 'open', articleId: number): void;
  (event: 'switch-language', lang: KbLanguage): void;
}>();

const { t } = useI18n();
</script>

<template>
  <div>
    <p v-if="searching" class="py-3 text-sm text-slate-600" role="status">
      {{ t('kb.search.searching') }}
    </p>

    <ul v-else-if="result && result.items.length > 0" class="divide-y divide-slate-100">
      <li v-for="hit in result.items" :key="hit.articleId" class="py-3">
        <button type="button" class="text-start" @click="emit('open', hit.articleId)">
          <span class="flex flex-wrap items-center gap-2">
            <!--
              `lang` and `dir` on the TITLE, from the article's language rather
              than the interface's (FR-055). The chrome around it keeps the
              reader's direction; this text carries its own, because its
              direction is a property of the text.
            -->
            <span
              :lang="hit.lang"
              :dir="hit.lang === 'ar' ? 'rtl' : 'ltr'"
              class="font-medium text-slate-900 underline"
            >
              {{ hit.title }}
            </span>
            <LanguageBadge :languages="[hit.lang]" />
          </span>

          <span v-if="hit.categoryName" class="mt-0.5 block text-xs text-slate-500">
            {{ hit.categoryName }}
          </span>

          <!-- WHY it matched, which is what lets a reader choose without opening five. -->
          <span
            v-if="hit.excerpt"
            :lang="hit.lang"
            :dir="hit.lang === 'ar' ? 'rtl' : 'ltr'"
            class="mt-1 block text-sm text-slate-600"
          >
            {{ hit.excerpt }}
          </span>
        </button>
      </li>
    </ul>

    <!--
      THE CROSS-LANGUAGE OFFER (FR-029). A control, not a substitution: it says
      how many and lets the reader decide to go and look.
    -->
    <div v-else-if="result?.otherLanguage" class="py-3 text-sm">
      <p class="text-slate-700">
        {{ t('kb.search.empty.title') }}
      </p>
      <button
        type="button"
        class="mt-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        @click="emit('switch-language', result.otherLanguage.lang)"
      >
        {{
          t('kb.search.otherLanguage', {
            count: result.otherLanguage.count,
            language: t(`kb.language.${result.otherLanguage.lang}`),
          })
        }}
      </button>
    </div>

    <!--
      AN EXPLICIT EMPTY STATE (FR-024, SC-013). "Nothing matched" plus what to
      try next — never a blank region.
    -->
    <div v-else-if="searched" class="py-3 text-sm">
      <p class="text-slate-700">{{ t('kb.search.empty.title') }}</p>
      <p class="text-slate-500">{{ t('kb.search.empty.hint') }}</p>
    </div>
  </div>
</template>
