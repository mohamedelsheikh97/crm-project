<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import LanguageBadge from '../../components/knowledge/LanguageBadge.vue';
import { ApiError } from '../../services/http';
import {
  archiveArticle,
  createArticle,
  fetchArticles,
  fetchCategories,
  publishArticle,
  publishSummary,
  restoreArticle,
  updateArticle,
  type KbArticle,
  type KbArticleInput,
  type KbArticleSort,
  type KbCategory,
} from '../../services/knowledge.service';

/**
 * Writing articles and deciding when they go live (User Story 2).
 *
 * THREE THINGS ON THIS SCREEN ARE NOT COSMETIC:
 *
 *   - PUBLISH IS A SEPARATE CONTROL FROM SAVE, and it states what it will do —
 *     which languages go live, and to whom. It is the only quality gate this
 *     content has (there is no review workflow and no version history), so the
 *     moment somebody decides must be a moment they can see.
 *   - THERE IS NO DELETE CONTROL, anywhere. Archiving is the removal (FR-007),
 *     and `kb.articles.noDeleteReason` on the archive control is where somebody
 *     looking for a delete button finds out why there isn't one.
 *   - BOTH LANGUAGE PAIRS SIT SIDE BY SIDE, each labelled, NEITHER REQUIRED.
 *     Clarifications Q3 made a one-language article legitimate; showing the
 *     Arabic fields as optional rather than hiding them behind a toggle is that
 *     rule made visible instead of explained.
 */

const { t, locale } = useI18n();

const items = ref<KbArticle[]>([]);
const categories = ref<KbCategory[]>([]);
const loading = ref(false);
const saving = ref(false);
const editing = ref<KbArticle | null>(null);
const errorKey = ref<string | null>(null);
const fieldErrors = ref<Record<string, string>>({});

const statusFilter = ref<'' | 'draft' | 'published' | 'archived'>('');
// Stewardship (FR-051, User Story 6). "Old and unread" and "old and heavily
// read" are both findable here, and the second is the more urgent: a stale
// article nobody reads is a tidying job; a stale article everybody reads is
// actively misinforming people.
const sort = ref<KbArticleSort>('updated');

function emptyDraft(): KbArticleInput {
  return {
    categoryId: categories.value[0]?.id,
    titleEn: '',
    titleAr: '',
    bodyEn: '',
    bodyAr: '',
    audience: 'internal',
  };
}

const draft = ref<KbArticleInput>(emptyDraft());

const categoryName = (category: KbCategory): string =>
  (locale.value === 'ar' ? category.nameAr : category.nameEn) ??
  category.nameAr ??
  category.nameEn ??
  category.slug;

const articleTitle = (article: KbArticle): string =>
  (locale.value === 'ar' ? article.titleAr : article.titleEn) ??
  article.titleAr ??
  article.titleEn ??
  t('kb.articles.untitled');

async function load(): Promise<void> {
  loading.value = true;

  try {
    const [page, categoryList] = await Promise.all([
      fetchArticles({ status: statusFilter.value, sort: sort.value }),
      fetchCategories(),
    ]);

    items.value = page.items;
    categories.value = categoryList;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await load();
  draft.value = emptyDraft();
});

function startCreate(): void {
  editing.value = null;
  draft.value = emptyDraft();
  errorKey.value = null;
  fieldErrors.value = {};
}

function startEdit(article: KbArticle): void {
  editing.value = article;
  draft.value = {
    categoryId: article.categoryId,
    titleEn: article.titleEn ?? '',
    titleAr: article.titleAr ?? '',
    bodyEn: article.bodyEn ?? '',
    bodyAr: article.bodyAr ?? '',
    audience: article.audience,
    version: article.version,
  };
  errorKey.value = null;
  fieldErrors.value = {};
}

function reportError(error: unknown): void {
  if (error instanceof ApiError) {
    errorKey.value =
      error.code === 'ARTICLE_INCOMPLETE' ? 'kb.error.incompleteSummary' : 'error.unexpected';

    // The server says WHICH half is missing, and so does this screen. A bare
    // "invalid" leaves the author hunting through four fields.
    for (const detail of error.details) fieldErrors.value[detail.field] = detail.message;
  } else {
    errorKey.value = 'error.unexpected';
  }
}

async function save(): Promise<void> {
  saving.value = true;
  errorKey.value = null;
  fieldErrors.value = {};

  try {
    if (editing.value) {
      await updateArticle(editing.value.id, draft.value);
    } else {
      await createArticle(draft.value);
    }

    startCreate();
    await load();
  } catch (error) {
    reportError(error);
  } finally {
    saving.value = false;
  }
}

async function act(action: (id: number) => Promise<KbArticle>, id: number): Promise<void> {
  errorKey.value = null;
  fieldErrors.value = {};

  try {
    await action(id);
    await load();
  } catch (error) {
    reportError(error);
  }
}

/**
 * What the publish control says before anybody presses it.
 *
 * A control that does not state its consequence asks somebody to make the one
 * decision in this phase that puts words in front of customers, without telling
 * them which words or which customers.
 */
const pendingPublish = computed(() => (editing.value ? publishSummary(editing.value) : null));
</script>

<template>
  <section>
    <header class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-xl font-semibold tracking-tight">{{ t('kb.articles.title') }}</h2>
        <p class="mt-1 text-sm text-slate-600">{{ t('kb.articles.description') }}</p>
      </div>

      <button
        type="button"
        class="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
        @click="startCreate"
      >
        {{ t('kb.articles.new') }}
      </button>
    </header>

    <div class="mb-4 flex flex-wrap items-end gap-3">
      <label class="text-sm">
        <span class="mb-1 block text-slate-700">{{ t('kb.articles.filter.status') }}</span>
        <select v-model="statusFilter" class="rounded-md border border-slate-300 px-2 py-1.5" @change="load">
          <option value="">{{ t('kb.articles.filter.allStatuses') }}</option>
          <option value="draft">{{ t('kb.status.draft') }}</option>
          <option value="published">{{ t('kb.status.published') }}</option>
          <option value="archived">{{ t('kb.status.archived') }}</option>
        </select>
      </label>

      <label class="text-sm">
        <span class="mb-1 block text-slate-700">{{ t('kb.articles.sort.label') }}</span>
        <select v-model="sort" class="rounded-md border border-slate-300 px-2 py-1.5" @change="load">
          <option value="updated">{{ t('kb.articles.sort.updated') }}</option>
          <option value="stale">{{ t('kb.articles.sort.stale') }}</option>
          <option value="mostRead">{{ t('kb.articles.sort.mostRead') }}</option>
          <option value="leastRead">{{ t('kb.articles.sort.leastRead') }}</option>
        </select>
      </label>
    </div>

    <p v-if="errorKey" role="alert" class="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
      {{ t(errorKey) }}
    </p>

    <!--
      THE EMPTY STATE IS A FIRST-CLASS STATE (SC-013). A new knowledge base and
      a broken one must not be indistinguishable — this is the state every
      installation starts in, and the one nobody tests.
    -->
    <p v-if="!loading && items.length === 0" class="rounded-md bg-slate-50 px-4 py-6 text-sm text-slate-600">
      {{ t('kb.articles.empty.title') }}
      <span class="block text-slate-500">{{ t('kb.articles.empty.hint') }}</span>
    </p>

    <table v-else class="w-full text-sm">
      <caption class="sr-only">{{ t('kb.articles.caption') }}</caption>
      <thead>
        <tr class="border-b border-slate-200 text-start text-slate-600">
          <th scope="col" class="py-2 text-start">{{ t('kb.articles.column.title') }}</th>
          <th scope="col" class="py-2 text-start">{{ t('kb.articles.column.category') }}</th>
          <th scope="col" class="py-2 text-start">{{ t('kb.articles.column.status') }}</th>
          <th scope="col" class="py-2 text-start">{{ t('kb.articles.column.audience') }}</th>
          <th scope="col" class="py-2 text-start">{{ t('kb.articles.column.languages') }}</th>
          <th scope="col" class="py-2 text-start">{{ t('kb.articles.column.views') }}</th>
          <th scope="col" class="py-2 text-start">{{ t('kb.articles.column.updated') }}</th>
          <th scope="col" class="py-2 text-start">{{ t('kb.articles.column.actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="article in items" :key="article.id" class="border-b border-slate-100">
          <td class="py-2">{{ articleTitle(article) }}</td>
          <td class="py-2">
            {{ categories.find((c) => c.id === article.categoryId)?.slug ?? '—' }}
          </td>
          <!--
            STATUS AND AUDIENCE CARRY TEXT AND AN ICON, NEVER COLOUR ALONE
            (FR-056). "Draft" and "Published" differing only in hue is the
            failure the Phase 6 greyscale rule already caught once.
          -->
          <td class="py-2">
            <span aria-hidden="true">{{ article.status === 'published' ? '●' : article.status === 'draft' ? '○' : '◌' }}</span>
            {{ t(`kb.status.${article.status}`) }}
          </td>
          <td class="py-2">
            <span aria-hidden="true">{{ article.audience === 'customer' ? '◇' : '◆' }}</span>
            {{ t(`kb.audience.${article.audience}`) }}
          </td>
          <td class="py-2"><LanguageBadge :languages="article.availableLanguages" /></td>
          <td class="py-2">{{ article.viewCount }}</td>
          <td class="py-2">
            {{ new Date(article.updatedAt).toLocaleDateString(locale) }}
            <span v-if="article.updatedBy" class="block text-xs text-slate-500">
              {{ article.updatedBy.fullName }}
            </span>
          </td>
          <td class="py-2">
            <div class="flex flex-wrap gap-2">
              <button type="button" class="text-slate-700 underline" @click="startEdit(article)">
                {{ t('action.edit') }}
              </button>

              <button
                v-if="article.status !== 'published'"
                type="button"
                class="text-slate-700 underline"
                @click="act(publishArticle, article.id)"
              >
                {{ t('kb.articles.publish') }}
              </button>

              <!--
                NO DELETE CONTROL. The title explains why the button somebody is
                looking for is not here.
              -->
              <button
                v-if="article.status !== 'archived'"
                type="button"
                class="text-slate-700 underline"
                :title="t('kb.articles.noDeleteReason')"
                @click="act(archiveArticle, article.id)"
              >
                {{ t('kb.articles.archive') }}
              </button>

              <button
                v-else
                type="button"
                class="text-slate-700 underline"
                @click="act(restoreArticle, article.id)"
              >
                {{ t('kb.articles.restore') }}
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <form class="mt-8 border-t border-slate-200 pt-6" @submit.prevent="save">
      <h3 class="mb-4 text-lg font-medium">
        {{ editing ? t('kb.articles.editTitle') : t('kb.articles.createTitle') }}
      </h3>

      <label class="mb-4 block text-sm">
        <span class="mb-1 block text-slate-700">{{ t('kb.articles.field.category') }}</span>
        <select v-model.number="draft.categoryId" class="w-full rounded-md border border-slate-300 px-2 py-1.5">
          <option v-for="category in categories" :key="category.id" :value="category.id">
            {{ categoryName(category) }}
          </option>
        </select>
        <!-- FR-010: an article only search can reach is one nobody can browse to. -->
        <span class="mt-1 block text-xs text-slate-500">{{ t('kb.articles.field.categoryHint') }}</span>
        <span v-if="fieldErrors.categoryId" class="mt-1 block text-xs text-red-700">
          {{ t(fieldErrors.categoryId) }}
        </span>
      </label>

      <!--
        BOTH PAIRS SIDE BY SIDE, NEITHER REQUIRED. Clarifications Q3's rule made
        visible rather than explained.
      -->
      <div class="grid gap-6 md:grid-cols-2">
        <fieldset class="space-y-3">
          <legend class="text-sm font-medium">{{ t('kb.language.en') }}</legend>

          <label class="block text-sm">
            <span class="mb-1 block text-slate-700">{{ t('kb.articles.field.title') }}</span>
            <input v-model="draft.titleEn" lang="en" dir="ltr" class="w-full rounded-md border border-slate-300 px-2 py-1.5" />
            <span v-if="fieldErrors.titleEn" class="mt-1 block text-xs text-red-700">
              {{ t(fieldErrors.titleEn) }}
            </span>
          </label>

          <label class="block text-sm">
            <span class="mb-1 block text-slate-700">{{ t('kb.articles.field.body') }}</span>
            <textarea v-model="draft.bodyEn" lang="en" dir="ltr" rows="10" class="w-full rounded-md border border-slate-300 px-2 py-1.5"></textarea>
            <span v-if="fieldErrors.bodyEn" class="mt-1 block text-xs text-red-700">
              {{ t(fieldErrors.bodyEn) }}
            </span>
          </label>
        </fieldset>

        <fieldset class="space-y-3">
          <legend class="text-sm font-medium">{{ t('kb.language.ar') }}</legend>

          <label class="block text-sm">
            <span class="mb-1 block text-slate-700">{{ t('kb.articles.field.title') }}</span>
            <!--
              `dir` and `lang` on the FIELD, not on the page. The interface
              chrome keeps the reader's direction; the content carries its own,
              because its direction is a property of the text (FR-055).
            -->
            <input v-model="draft.titleAr" lang="ar" dir="rtl" class="w-full rounded-md border border-slate-300 px-2 py-1.5" />
            <span v-if="fieldErrors.titleAr" class="mt-1 block text-xs text-red-700">
              {{ t(fieldErrors.titleAr) }}
            </span>
          </label>

          <label class="block text-sm">
            <span class="mb-1 block text-slate-700">{{ t('kb.articles.field.body') }}</span>
            <textarea v-model="draft.bodyAr" lang="ar" dir="rtl" rows="10" class="w-full rounded-md border border-slate-300 px-2 py-1.5"></textarea>
            <span v-if="fieldErrors.bodyAr" class="mt-1 block text-xs text-red-700">
              {{ t(fieldErrors.bodyAr) }}
            </span>
          </label>
        </fieldset>
      </div>

      <label class="mt-4 block text-sm">
        <span class="mb-1 block text-slate-700">{{ t('kb.articles.field.audience') }}</span>
        <select v-model="draft.audience" class="rounded-md border border-slate-300 px-2 py-1.5">
          <option value="internal">{{ t('kb.audience.internal') }}</option>
          <option value="customer">{{ t('kb.audience.customer') }}</option>
        </select>
        <span class="mt-1 block text-xs text-slate-500">{{ t('kb.articles.field.audienceHint') }}</span>
      </label>

      <div class="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          :disabled="saving"
          class="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {{ t('action.save') }}
        </button>

        <!--
          PUBLISH IS SEPARATE FROM SAVE, and states what it will do: which
          languages go live, and to whom.
        -->
        <button
          v-if="editing"
          type="button"
          :disabled="!pendingPublish?.publishable"
          class="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-60"
          @click="act(publishArticle, editing.id)"
        >
          {{ t('kb.articles.publish') }}
        </button>

        <p v-if="editing && pendingPublish" class="text-xs text-slate-600">
          <template v-if="pendingPublish.publishable">
            {{
              t('kb.articles.publishConsequence', {
                languages: pendingPublish.languages.map((l) => t(`kb.language.${l}`)).join(', '),
                audience: t(`kb.audience.${pendingPublish.audience}`),
              })
            }}
          </template>
          <template v-else>{{ t('kb.error.incompleteSummary') }}</template>
        </p>

        <button v-if="editing" type="button" class="text-sm underline" @click="startCreate">
          {{ t('action.cancel') }}
        </button>
      </div>
    </form>
  </section>
</template>
