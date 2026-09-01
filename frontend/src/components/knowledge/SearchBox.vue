<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import ResultList from './ResultList.vue';
import {
  searchKnowledge,
  type KbLanguage,
  type KbSearchResult,
} from '../../services/knowledge.service';

/**
 * Searching the knowledge base, from wherever the reader already is (FR-030).
 *
 * ON THE TICKET SCREEN THIS MUST NOT NAVIGATE AWAY. An agent searching for an
 * answer is in the middle of writing a reply; sending them to another page
 * costs them the reply. So this is a panel beside the work, and opening a
 * result opens it beside the work too.
 *
 * DEBOUNCED AND CANCELLABLE. Several requests are in flight while somebody
 * types, and they do not return in order — a slow response for "car" landing
 * after a fast one for "card reader" would overwrite correct results with wrong
 * ones as the reader finished typing. The abort controller and the sequence
 * check below are both needed: the first stops the work, the second stops a
 * response that was already on its way.
 */

const props = withDefaults(
  defineProps<{
    lang?: KbLanguage;
    categoryId?: number;
    autofocus?: boolean;
  }>(),
  { lang: undefined, categoryId: undefined, autofocus: false },
);

const emit = defineEmits<{ (event: 'open', articleId: number): void }>();

const { t, locale } = useI18n();

const query = ref('');
const searchLang = ref<KbLanguage>(props.lang ?? (locale.value === 'ar' ? 'ar' : 'en'));
const result = ref<KbSearchResult | null>(null);
const searching = ref(false);
const searched = ref(false);

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

let timer: ReturnType<typeof setTimeout> | null = null;
let controller: AbortController | null = null;
/** Guards against an out-of-order response overwriting a newer one. */
let sequence = 0;

async function run(): Promise<void> {
  const term = query.value.trim();

  if (term.length < MIN_QUERY_LENGTH) {
    result.value = null;
    searched.value = false;
    return;
  }

  controller?.abort();
  controller = new AbortController();

  const mine = (sequence += 1);
  searching.value = true;

  try {
    const response = await searchKnowledge(term, {
      lang: searchLang.value,
      categoryId: props.categoryId,
      signal: controller.signal,
    });

    // A response from an older keystroke never wins.
    if (mine !== sequence) return;

    result.value = response;
    searched.value = true;
  } catch {
    // An aborted request is the normal case here, not a failure worth
    // reporting. A genuine failure leaves the previous results in place rather
    // than blanking the panel, because a blank panel reads as "nothing matched".
    if (mine === sequence) searched.value = true;
  } finally {
    if (mine === sequence) searching.value = false;
  }
}

watch([query, searchLang], () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, DEBOUNCE_MS);
});

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
  controller?.abort();
});

function switchLanguage(lang: KbLanguage): void {
  searchLang.value = lang;
}
</script>

<template>
  <section :aria-label="t('kb.search.title')">
    <label class="block text-sm">
      <span class="mb-1 block font-medium text-slate-700">{{ t('kb.search.title') }}</span>
      <input
        v-model="query"
        type="search"
        :autofocus="props.autofocus"
        :placeholder="t('kb.search.placeholder')"
        class="w-full rounded-md border border-slate-300 px-3 py-2"
      />
    </label>

    <!--
      A live region, so a screen-reader user learns that results changed without
      having to go looking for them.
    -->
    <p class="sr-only" role="status" aria-live="polite">
      {{
        searching
          ? t('kb.search.searching')
          : t('kb.search.resultCount', { count: result?.items.length ?? 0 })
      }}
    </p>

    <ResultList
      :result="result"
      :searching="searching"
      :searched="searched"
      @open="(id) => emit('open', id)"
      @switch-language="switchLanguage"
    />
  </section>
</template>
