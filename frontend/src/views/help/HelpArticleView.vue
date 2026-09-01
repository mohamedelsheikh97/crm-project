<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import ArticleReader from '../../components/knowledge/ArticleReader.vue';
import { ApiError } from '../../services/http';
import { fetchPublicArticle, type PublicArticle } from '../../services/knowledge.service';

/**
 * Reading one article, signed out (User Story 4).
 *
 * TWO THINGS ON THIS PAGE ARE DELIBERATE PLACEMENTS RATHER THAN LAYOUT.
 *
 *   THE ROUTE TO A PERSON SITS AFTER THE CONTENT (FR-033). Before it, it
 *   interrupts somebody who is about to succeed — and the whole point of a help
 *   centre is that most readers do succeed. Offering "contact us" above the
 *   answer tells them the article probably will not work.
 *
 *   THE GUIDE POSITION APPEARS ABOVE AND BELOW (FR-011c). A reader arriving at
 *   step 4 from a search result needs to learn immediately that steps 1-3
 *   exist; one arriving at the end of step 4 needs to know where to go next.
 *
 * A 404 IS INDISTINGUISHABLE FROM EVERY OTHER REFUSAL, by design. This page
 * cannot tell whether the article is a draft, archived, internal, or was never
 * written — and neither can the reader (FR-032c). So the message says what is
 * true for all four: it is not here.
 */

const { t, locale } = useI18n();
const route = useRoute();

const article = ref<PublicArticle | null>(null);
const loading = ref(true);
const missing = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  missing.value = false;

  try {
    article.value = await fetchPublicArticle(
      String(route.params.slug),
      locale.value === 'ar' ? 'ar' : 'en',
    );
  } catch (error) {
    article.value = null;
    // Any refusal reads the same way here, because the server made them the
    // same on purpose.
    missing.value = error instanceof ApiError;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => route.params.slug, load);
// Switching language reloads the article in that language when it exists, and
// keeps the one it has otherwise — with its badge saying which.
watch(locale, load);
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-8">
    <nav class="mb-6 text-sm">
      <RouterLink :to="{ name: 'help' }" class="underline">{{ t('help.backToHelp') }}</RouterLink>
    </nav>

    <p v-if="loading" class="text-slate-600" role="status">{{ t('help.article.loading') }}</p>

    <template v-else-if="article">
      <!--
        Position first, so a reader arriving mid-guide knows immediately.
        Rendered as text and links, never as a bare "continue" button that hides
        where they are.
      -->
      <p v-if="article.guide" class="mb-4 text-sm font-medium text-slate-700">
        {{ t('kb.guide.position', { position: article.guide.position, total: article.guide.total }) }}
      </p>

      <ArticleReader
        :title="article.title"
        :body="article.body"
        :lang="article.lang"
        :available-languages="article.availableLanguages"
        :category-name="article.category?.name ?? null"
      />

      <p v-if="article.guide" class="mt-6 text-sm text-slate-700">
        {{ t('kb.guide.position', { position: article.guide.position, total: article.guide.total }) }}
      </p>

      <!--
        AFTER the content. A reader who has just been helped does not need this,
        and one who has not is exactly here, at the end, having read it.
      -->
      <footer class="mt-10 border-t border-slate-200 pt-4">
        <p class="text-sm text-slate-600">{{ t('help.contact.stillStuck') }}</p>
        <RouterLink :to="{ name: 'help-contact' }" class="mt-1 inline-block underline">
          {{ t('help.contact.cta') }}
        </RouterLink>
      </footer>
    </template>

    <!--
      One message for four reasons. This page genuinely does not know which,
      which is the design (FR-032c) rather than a limitation of the interface.
    -->
    <section v-else-if="missing" class="rounded-md bg-slate-50 px-4 py-8">
      <h1 class="text-lg font-medium">{{ t('help.article.notFound.title') }}</h1>
      <p class="mt-1 text-slate-600">{{ t('help.article.notFound.hint') }}</p>
      <div class="mt-3 flex flex-wrap gap-4 text-sm">
        <RouterLink :to="{ name: 'help' }" class="underline">{{ t('help.backToHelp') }}</RouterLink>
        <RouterLink :to="{ name: 'help-contact' }" class="underline">
          {{ t('help.contact.cta') }}
        </RouterLink>
      </div>
    </section>
  </div>
</template>
