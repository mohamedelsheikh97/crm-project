<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import LanguageBadge from '../../components/knowledge/LanguageBadge.vue';
import {
  fetchPublicCategories,
  searchPublic,
  type KbLanguage,
  type PublicCategory,
  type PublicSearchResult,
} from '../../services/knowledge.service';

/**
 * The public help centre (User Story 4).
 *
 * THE FIRST SCREEN IN THIS PROJECT AN UNAUTHENTICATED VISITOR IS MEANT TO READ.
 * Phase 5's chat widget is something a stranger INTERACTS with; this is
 * something they READ, on a phone, while something is broken.
 *
 * WHAT IS DELIBERATELY ABSENT, and the absences are the requirement:
 *
 *   - No navigation into the signed-in application. No user menu, no sign-in
 *     link, nothing that implies an account exists. A help centre that offers
 *     a login box to a customer who has no account is telling them they are in
 *     the wrong place.
 *   - No comments, no ratings, no corrections (FR-032b). The only input this
 *     surface accepts is a search string and a language.
 *   - No article counts. How much the organisation has written is not a
 *     stranger's business (FR-035).
 *
 * MOBILE IS THE PRIMARY CASE. A customer looking for help is holding a phone.
 */

const { t, locale } = useI18n();

const categories = ref<PublicCategory[]>([]);
const query = ref('');
const searchLang = ref<KbLanguage>(locale.value === 'ar' ? 'ar' : 'en');
const result = ref<PublicSearchResult | null>(null);
const searching = ref(false);
const searched = ref(false);
const loading = ref(true);

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

let timer: ReturnType<typeof setTimeout> | null = null;
let controller: AbortController | null = null;
let sequence = 0;

const categoryName = (category: PublicCategory): string =>
  (locale.value === 'ar' ? category.nameAr : category.nameEn) ??
  category.nameAr ??
  category.nameEn ??
  category.slug;

onMounted(async () => {
  try {
    categories.value = await fetchPublicCategories();
  } finally {
    loading.value = false;
  }
});

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
    const response = await searchPublic(term, {
      lang: searchLang.value,
      signal: controller.signal,
    });

    // A stale response never overwrites a newer one.
    if (mine !== sequence) return;

    result.value = response;
    searched.value = true;
  } catch {
    if (mine === sequence) searched.value = true;
  } finally {
    if (mine === sequence) searching.value = false;
  }
}

watch([query, searchLang], () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, DEBOUNCE_MS);
});

// The language toggle switches the interface AND which language's articles are
// searched. The cross-language offer (FR-029) is the way back across.
watch(locale, (value) => {
  searchLang.value = value === 'ar' ? 'ar' : 'en';
});

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
  controller?.abort();
});

const isEmptyHelpCentre = computed(
  () => !loading.value && categories.value.length === 0 && !searched.value,
);
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-8">
    <header class="mb-6">
      <h1 class="text-2xl font-semibold tracking-tight">{{ t('help.title') }}</h1>
      <p class="mt-1 text-slate-600">{{ t('help.description') }}</p>
    </header>

    <label class="block">
      <span class="mb-1 block text-sm font-medium text-slate-700">{{ t('help.search.label') }}</span>
      <input
        v-model="query"
        type="search"
        :placeholder="t('help.search.placeholder')"
        class="w-full rounded-md border border-slate-300 px-3 py-2 text-base"
      />
    </label>

    <p class="sr-only" role="status" aria-live="polite">
      {{
        searching
          ? t('help.search.searching')
          : t('help.search.resultCount', { count: result?.items.length ?? 0 })
      }}
    </p>

    <!-- Results -->
    <section v-if="searched || searching" class="mt-6" :aria-label="t('help.search.results')">
      <p v-if="searching" class="text-sm text-slate-600">{{ t('help.search.searching') }}</p>

      <ul v-else-if="result && result.items.length > 0" class="divide-y divide-slate-100">
        <li v-for="hit in result.items" :key="hit.slug" class="py-3">
          <RouterLink :to="{ name: 'help-article', params: { slug: hit.slug } }" class="block">
            <span class="flex flex-wrap items-center gap-2">
              <span
                :lang="hit.lang"
                :dir="hit.lang === 'ar' ? 'rtl' : 'ltr'"
                class="font-medium underline"
              >
                {{ hit.title }}
              </span>
              <LanguageBadge :languages="[hit.lang]" />
            </span>
            <span v-if="hit.categoryName" class="mt-0.5 block text-xs text-slate-500">
              {{ hit.categoryName }}
            </span>
            <span
              v-if="hit.excerpt"
              :lang="hit.lang"
              :dir="hit.lang === 'ar' ? 'rtl' : 'ltr'"
              class="mt-1 block text-sm text-slate-600"
            >
              {{ hit.excerpt }}
            </span>
          </RouterLink>
        </li>
      </ul>

      <!--
        THE CROSS-LANGUAGE OFFER (FR-029): a control the reader chooses, never
        results silently substituted.
      -->
      <div v-else-if="result?.otherLanguage" class="text-sm">
        <p class="text-slate-700">{{ t('help.search.empty.title') }}</p>
        <button
          type="button"
          class="mt-2 rounded-md border border-slate-300 px-3 py-2"
          @click="searchLang = result!.otherLanguage!.lang"
        >
          {{
            t('help.search.otherLanguage', {
              count: result.otherLanguage.count,
              language: t(`kb.language.${result.otherLanguage.lang}`),
            })
          }}
        </button>
      </div>

      <!-- An explicit empty state, plus the route to a person. -->
      <div v-else class="text-sm">
        <p class="text-slate-700">{{ t('help.search.empty.title') }}</p>
        <p class="text-slate-500">{{ t('help.search.empty.hint') }}</p>
        <RouterLink :to="{ name: 'help-contact' }" class="mt-2 inline-block underline">
          {{ t('help.contact.cta') }}
        </RouterLink>
      </div>
    </section>

    <!--
      Browse. THE WHOLE TREE, rendered here rather than behind a click per
      category: SC-007 needs every published article to be reachable by
      browsing, and a customer on a phone should not pay a round-trip to find
      out a category holds three articles. Only categories with something
      readable in them arrive at all.
    -->
    <section v-if="categories.length > 0" class="mt-8" :aria-label="t('help.browse')">
      <h2 class="mb-2 text-lg font-medium">{{ t('help.browse') }}</h2>

      <div v-for="category in categories" :key="category.slug" class="mb-5">
        <h3 class="mb-1 font-medium text-slate-800">{{ categoryName(category) }}</h3>
        <ul class="ms-4 space-y-1">
          <li v-for="article in category.articles" :key="article.slug">
            <RouterLink
              :to="{ name: 'help-article', params: { slug: article.slug } }"
              class="underline"
            >
              <!--
                Whichever language the article actually has, with its direction.
                Under Clarifications Q3 a one-language article is legitimate, so
                a reader browsing an Arabic help centre WILL meet English titles.
              -->
              <span
                v-if="locale === 'ar' ? article.titleAr : article.titleEn"
                :lang="locale === 'ar' ? 'ar' : 'en'"
              >
                {{ locale === 'ar' ? article.titleAr : article.titleEn }}
              </span>
              <span v-else-if="article.titleEn" lang="en" dir="ltr">{{ article.titleEn }}</span>
              <span v-else lang="ar" dir="rtl">{{ article.titleAr }}</span>
            </RouterLink>
          </li>
        </ul>
      </div>
    </section>

    <!--
      THE EMPTY HELP CENTRE (SC-013). The state every installation starts in,
      and the one nobody tests. A new help centre and a broken one must not be
      indistinguishable.
    -->
    <section v-else-if="isEmptyHelpCentre" class="mt-8 rounded-md bg-slate-50 px-4 py-8">
      <p class="text-slate-700">{{ t('help.empty.title') }}</p>
      <p class="mt-1 text-slate-500">{{ t('help.empty.hint') }}</p>
      <RouterLink :to="{ name: 'help-contact' }" class="mt-3 inline-block underline">
        {{ t('help.contact.cta') }}
      </RouterLink>
    </section>

    <footer class="mt-10 border-t border-slate-200 pt-4 text-sm">
      <RouterLink :to="{ name: 'help-contact' }" class="underline">
        {{ t('help.contact.cta') }}
      </RouterLink>
    </footer>
  </div>
</template>
