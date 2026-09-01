<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import * as portalService from '../../services/portal.service';

/**
 * Help content inside the portal (Phase 8, User Story 6).
 *
 * A SEPARATE VIEW FROM `views/help/`, reading THE SAME CONTENT through the same
 * server handlers. Phase 7's help centre renders in the bare public shell for
 * somebody with no session; this renders in the portal shell for somebody who has
 * one, with their requests one click away.
 *
 * The results are IDENTICAL by construction: the portal's knowledge controller
 * re-exports Phase 7's public handlers, so there is one implementation and
 * nothing for the two surfaces to disagree about (FR-039).
 *
 * ONE COMPONENT FOR BROWSE, SEARCH AND READ, because a customer looking for help
 * moves between the three without thinking of them as different places.
 */
const { t, locale } = useI18n();
const route = useRoute();

const query = ref('');
const searching = ref(false);
const results = ref<
  Array<{ slug: string; title: string; lang: 'ar' | 'en'; excerpt: string | null }>
>([]);
const otherLanguage = ref(0);

const categories = ref<
  Array<{
    slug: string;
    nameEn: string | null;
    nameAr: string | null;
    articles: Array<{ slug: string; titleEn: string | null; titleAr: string | null }>;
  }>
>([]);

const article = ref<{
  slug: string;
  title: string;
  body: string;
  lang: 'ar' | 'en';
  availableLanguages: Array<'ar' | 'en'>;
} | null>(null);

let controller: AbortController | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

async function loadArticle(slug: string): Promise<void> {
  article.value = await portalService.helpArticle(slug, locale.value === 'ar' ? 'ar' : 'en');
}

onMounted(async () => {
  const slug = typeof route.params.slug === 'string' ? route.params.slug : '';

  if (slug) {
    await loadArticle(slug);
    return;
  }

  const tree = await portalService.helpCategories();
  categories.value = tree.items;
});

watch(query, (value) => {
  if (timer) clearTimeout(timer);

  if (value.trim().length < 2) {
    results.value = [];
    return;
  }

  timer = setTimeout(async () => {
    controller?.abort();
    controller = new AbortController();
    searching.value = true;

    try {
      const found = await portalService.searchHelp(
        value,
        locale.value === 'ar' ? 'ar' : 'en',
        controller.signal,
      );
      results.value = found.items;
      otherLanguage.value = found.otherLanguage;
    } catch {
      results.value = [];
    } finally {
      searching.value = false;
    }
  }, 300);
});

onUnmounted(() => {
  if (timer) clearTimeout(timer);
  controller?.abort();
});

function categoryName(category: { nameEn: string | null; nameAr: string | null }): string {
  return (locale.value === 'ar' ? category.nameAr : category.nameEn) ?? '';
}

function articleTitle(entry: { titleEn: string | null; titleAr: string | null }): string {
  return (
    (locale.value === 'ar' ? entry.titleAr : entry.titleEn) ?? entry.titleEn ?? entry.titleAr ?? ''
  );
}
</script>

<template>
  <div>
    <!-- READING ONE ARTICLE. Its own direction, independent of the interface —
         Phase 7's rule: an Arabic article inside an English portal is content
         whose direction is a property of the text. -->
    <template v-if="article">
      <RouterLink
        :to="{ name: 'portal-help' }"
        class="text-sm text-slate-600 underline hover:text-slate-900"
      >
        {{ t('help.backToHelp') }}
      </RouterLink>

      <article class="mt-4" :dir="article.lang === 'ar' ? 'rtl' : 'ltr'" :lang="article.lang">
        <h1 class="text-xl font-semibold">{{ article.title }}</h1>

        <!-- FR-043. A reader is always told what language they are being handed. -->
        <p v-if="article.availableLanguages.length === 1" class="mt-1 text-xs text-slate-500">
          {{ t('kb.language.available') }}: {{ t(`kb.language.${article.lang}`) }}
        </p>

        <div class="mt-4 whitespace-pre-wrap text-sm leading-6">{{ article.body }}</div>
      </article>
    </template>

    <template v-else>
      <h1 class="text-xl font-semibold">{{ t('portal.help.title') }}</h1>
      <p class="mt-1 text-sm text-slate-600">{{ t('portal.help.description') }}</p>

      <label for="portal-help-search" class="mt-6 block text-sm font-medium text-slate-700">
        {{ t('help.search.label') }}
      </label>
      <input
        id="portal-help-search"
        v-model="query"
        type="search"
        :placeholder="t('kb.search.placeholder')"
        class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
      />

      <p v-if="searching" role="status" class="mt-2 text-sm text-slate-600">
        {{ t('kb.search.searching') }}
      </p>

      <section v-if="query.trim().length >= 2" class="mt-4">
        <p
          v-if="results.length === 0 && !searching"
          role="status"
          class="rounded-md border border-slate-200 bg-white p-4 text-sm"
        >
          <span class="font-medium">{{ t('kb.search.empty.title') }}</span>
          <span class="mt-1 block text-slate-600">{{ t('kb.search.empty.hint') }}</span>
        </p>

        <ul v-else class="space-y-2">
          <li v-for="item of results" :key="item.slug">
            <RouterLink
              :to="{ name: 'portal-help-article', params: { slug: item.slug } }"
              class="block rounded-md border border-slate-200 bg-white p-3 hover:border-slate-300"
            >
              <span class="font-medium">{{ item.title }}</span>
              <span v-if="item.lang !== locale" class="ms-1 text-xs text-slate-500">
                ({{ t(`kb.language.${item.lang}`) }})
              </span>
              <span v-if="item.excerpt" class="mt-1 block text-sm text-slate-600">
                {{ item.excerpt }}
              </span>
            </RouterLink>
          </li>
        </ul>

        <p v-if="otherLanguage > 0" class="mt-2 text-xs text-slate-500">
          {{ t('kb.search.otherLanguage', { count: otherLanguage }) }}
        </p>
      </section>

      <!-- BROWSE. SC-007's rule inherited: every published article must be
           reachable without searching for it. -->
      <section v-else class="mt-6">
        <p
          v-if="categories.length === 0"
          role="status"
          class="rounded-md border border-slate-200 bg-white p-4 text-sm"
        >
          <span class="font-medium">{{ t('help.empty.title') }}</span>
          <span class="mt-1 block text-slate-600">{{ t('help.empty.hint') }}</span>
        </p>

        <div v-for="category of categories" :key="category.slug" class="mt-4">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {{ categoryName(category) }}
          </h2>
          <ul class="mt-2 space-y-1">
            <li v-for="entry of category.articles" :key="entry.slug">
              <RouterLink
                :to="{ name: 'portal-help-article', params: { slug: entry.slug } }"
                class="text-sm text-slate-700 underline hover:text-slate-900"
              >
                {{ articleTitle(entry) }}
              </RouterLink>
            </li>
          </ul>
        </div>
      </section>
    </template>
  </div>
</template>
