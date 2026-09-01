<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { ApiError } from '../../services/http';
import {
  createCategory,
  createGuide,
  deleteCategory,
  deleteGuide,
  fetchArticles,
  fetchCategories,
  fetchGuides,
  moveWithin,
  replaceGuideSteps,
  updateCategory,
  type KbArticle,
  type KbCategory,
  type KbGuide,
} from '../../services/knowledge.service';

/**
 * The shape of the knowledge base: categories and guides (User Story 5).
 *
 * TWO RULES ON THIS SCREEN ARE NOT COSMETIC.
 *
 *   REORDERING IS KEYBOARD-OPERABLE — move up and move down buttons, NOT
 *   drag-only. The Phase 6 rule for any list whose order is functional: this
 *   order decides what a reader meets first on the help centre, and a
 *   drag-only control excludes anybody not using a mouse from setting it.
 *
 *   A REFUSED DELETE NAMES THE OBSTACLE. FR-015 refuses to delete a category
 *   holding articles; this screen says how many and offers the route to move
 *   them. "You cannot do that" with no number is a dead end.
 */

const { t, locale } = useI18n();

const categories = ref<KbCategory[]>([]);
const guides = ref<KbGuide[]>([]);
const articles = ref<KbArticle[]>([]);
const loading = ref(false);
const errorKey = ref<string | null>(null);
const blockedCount = ref<number | null>(null);

const draftCategory = ref({ nameEn: '', nameAr: '', ticketCategory: '' });
const draftGuide = ref({ titleEn: '', titleAr: '' });
const editingSteps = ref<{ guideId: number; articleIds: number[] } | null>(null);
const stepSearch = ref('');

// Phase 3's fixed list. Adding one there needs no change here (research D6).
const TICKET_CATEGORIES = ['general', 'technical', 'billing', 'complaint'] as const;

const name = (entry: { nameEn: string | null; nameAr: string | null; slug: string }): string =>
  (locale.value === 'ar' ? entry.nameAr : entry.nameEn) ?? entry.nameAr ?? entry.nameEn ?? entry.slug;

const guideTitle = (guide: KbGuide): string =>
  (locale.value === 'ar' ? guide.titleAr : guide.titleEn) ??
  guide.titleAr ??
  guide.titleEn ??
  guide.slug;

const articleTitle = (article: { titleEn: string | null; titleAr: string | null }): string =>
  (locale.value === 'ar' ? article.titleAr : article.titleEn) ??
  article.titleAr ??
  article.titleEn ??
  t('kb.articles.untitled');

async function load(): Promise<void> {
  loading.value = true;

  try {
    const [categoryList, guideList, articlePage] = await Promise.all([
      fetchCategories(),
      fetchGuides(),
      // Adding a step is a SEARCH over articles, not a raw id field — nobody
      // knows an article by its number.
      fetchArticles({ pageSize: 100 } as never),
    ]);

    categories.value = categoryList;
    guides.value = guideList;
    articles.value = articlePage.items;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function report(error: unknown): void {
  blockedCount.value = null;

  if (error instanceof ApiError) {
    if (error.code === 'CATEGORY_IN_USE') {
      errorKey.value = 'kb.error.categoryHasArticles';
      // THE COUNT. What turns the refusal into an instruction.
      blockedCount.value = Number(error.payload.articleCount ?? 0);
      return;
    }

    errorKey.value = error.details[0]?.message ?? 'error.unexpected';
    return;
  }

  errorKey.value = 'error.unexpected';
}

async function addCategory(): Promise<void> {
  errorKey.value = null;

  try {
    await createCategory({
      nameEn: draftCategory.value.nameEn || null,
      nameAr: draftCategory.value.nameAr || null,
      ticketCategory: draftCategory.value.ticketCategory || null,
    });

    draftCategory.value = { nameEn: '', nameAr: '', ticketCategory: '' };
    await load();
  } catch (error) {
    report(error);
  }
}

async function setTicketCategory(category: KbCategory, value: string): Promise<void> {
  errorKey.value = null;

  try {
    await updateCategory(category.id, {
      ticketCategory: value || null,
      version: category.version,
    });
    await load();
  } catch (error) {
    report(error);
  }
}

/**
 * Persist the whole order after a move.
 *
 * Every category's position is rewritten, because the order is one decision.
 * Writing only the moved one would leave two categories claiming one position.
 */
async function moveCategory(index: number, delta: number): Promise<void> {
  errorKey.value = null;

  const reordered = moveWithin(categories.value, index, index + delta);

  try {
    await Promise.all(
      reordered.map((category, position) =>
        updateCategory(category.id, { position, version: category.version }),
      ),
    );
    await load();
  } catch (error) {
    report(error);
  }
}

async function removeCategory(category: KbCategory): Promise<void> {
  errorKey.value = null;

  try {
    await deleteCategory(category.id);
    await load();
  } catch (error) {
    report(error);
  }
}

async function addGuide(): Promise<void> {
  errorKey.value = null;

  try {
    await createGuide({
      titleEn: draftGuide.value.titleEn || null,
      titleAr: draftGuide.value.titleAr || null,
    });

    draftGuide.value = { titleEn: '', titleAr: '' };
    await load();
  } catch (error) {
    report(error);
  }
}

function startSteps(guide: KbGuide): void {
  editingSteps.value = { guideId: guide.id, articleIds: guide.steps.map((s) => s.articleId) };
  stepSearch.value = '';
}

function moveStep(index: number, delta: number): void {
  if (!editingSteps.value) return;

  editingSteps.value.articleIds = moveWithin(
    editingSteps.value.articleIds,
    index,
    index + delta,
  );
}

function addStep(articleId: number): void {
  if (!editingSteps.value) return;
  if (editingSteps.value.articleIds.includes(articleId)) return;

  editingSteps.value.articleIds.push(articleId);
}

function removeStep(articleId: number): void {
  if (!editingSteps.value) return;

  editingSteps.value.articleIds = editingSteps.value.articleIds.filter((id) => id !== articleId);
}

async function saveSteps(): Promise<void> {
  if (!editingSteps.value) return;
  errorKey.value = null;

  try {
    await replaceGuideSteps(editingSteps.value.guideId, editingSteps.value.articleIds);
    editingSteps.value = null;
    await load();
  } catch (error) {
    report(error);
  }
}

async function removeGuide(guide: KbGuide): Promise<void> {
  errorKey.value = null;

  try {
    await deleteGuide(guide.id);
    await load();
  } catch (error) {
    report(error);
  }
}

const articleById = computed(
  () => new Map(articles.value.map((article) => [article.id, article])),
);

const stepCandidates = computed(() => {
  const term = stepSearch.value.trim().toLowerCase();
  if (term === '') return [];

  return articles.value
    .filter((article) => !editingSteps.value?.articleIds.includes(article.id))
    .filter((article) =>
      [article.titleEn, article.titleAr].some((title) =>
        (title ?? '').toLowerCase().includes(term),
      ),
    )
    .slice(0, 8);
});
</script>

<template>
  <section>
    <header class="mb-6">
      <h2 class="text-xl font-semibold tracking-tight">{{ t('kb.structure.title') }}</h2>
      <p class="mt-1 text-sm text-slate-600">{{ t('kb.structure.description') }}</p>
    </header>

    <p v-if="errorKey" role="alert" class="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
      {{ t(errorKey) }}
      <!-- The count, and the route out of the refusal. -->
      <span v-if="blockedCount !== null" class="block">
        {{ t('kb.structure.reassignHint', { count: blockedCount }) }}
      </span>
    </p>

    <!-- Categories -->
    <h3 class="mb-2 text-lg font-medium">{{ t('kb.structure.categories') }}</h3>

    <p
      v-if="!loading && categories.length === 0"
      class="mb-4 rounded-md bg-slate-50 px-4 py-6 text-sm text-slate-600"
    >
      {{ t('kb.structure.categories.empty') }}
    </p>

    <ul v-else class="mb-6 divide-y divide-slate-100">
      <li
        v-for="(category, index) in categories"
        :key="category.id"
        class="flex flex-wrap items-center justify-between gap-3 py-3"
      >
        <div class="min-w-0">
          <p class="font-medium">{{ name(category) }}</p>
          <p class="text-xs text-slate-500">
            {{ t('kb.structure.counts', {
              total: category.articleCount,
              published: category.publishedCount,
            }) }}
          </p>
        </div>

        <label class="text-sm">
          <span class="mb-1 block text-slate-700">{{ t('kb.structure.ticketCategory') }}</span>
          <select
            class="rounded-md border border-slate-300 px-2 py-1.5"
            :value="category.ticketCategory ?? ''"
            @change="setTicketCategory(category, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ t('kb.structure.ticketCategory.none') }}</option>
            <option v-for="key in TICKET_CATEGORIES" :key="key" :value="key">
              {{ t(`ticket.category.${key}`) }}
            </option>
          </select>
          <!-- The line of consequence: this is what makes a billing ticket
               prefer billing articles (research D6). -->
          <span class="mt-1 block max-w-xs text-xs text-slate-500">
            {{ t('kb.structure.ticketCategory.consequence') }}
          </span>
        </label>

        <!--
          MOVE UP / MOVE DOWN, NOT DRAG-ONLY. This order decides what a reader
          meets first, and setting it must not require a mouse.
        -->
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-40"
            :disabled="index === 0"
            :aria-label="t('kb.structure.moveUp', { name: name(category) })"
            @click="moveCategory(index, -1)"
          >
            <span aria-hidden="true">↑</span>
          </button>
          <button
            type="button"
            class="rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-40"
            :disabled="index === categories.length - 1"
            :aria-label="t('kb.structure.moveDown', { name: name(category) })"
            @click="moveCategory(index, 1)"
          >
            <span aria-hidden="true">↓</span>
          </button>
          <button type="button" class="text-sm underline" @click="removeCategory(category)">
            {{ t('kb.structure.delete') }}
          </button>
        </div>
      </li>
    </ul>

    <form class="mb-10 flex flex-wrap items-end gap-3" @submit.prevent="addCategory">
      <label class="text-sm">
        <span class="mb-1 block text-slate-700">{{ t('kb.language.en') }}</span>
        <input v-model="draftCategory.nameEn" lang="en" dir="ltr" class="rounded-md border border-slate-300 px-2 py-1.5" />
      </label>
      <label class="text-sm">
        <span class="mb-1 block text-slate-700">{{ t('kb.language.ar') }}</span>
        <input v-model="draftCategory.nameAr" lang="ar" dir="rtl" class="rounded-md border border-slate-300 px-2 py-1.5" />
      </label>
      <button type="submit" class="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
        {{ t('kb.structure.addCategory') }}
      </button>
    </form>

    <!-- Guides -->
    <h3 class="mb-2 text-lg font-medium">{{ t('kb.structure.guides') }}</h3>

    <p
      v-if="!loading && guides.length === 0"
      class="mb-4 rounded-md bg-slate-50 px-4 py-6 text-sm text-slate-600"
    >
      {{ t('kb.structure.guides.empty') }}
    </p>

    <ul v-else class="mb-6 space-y-4">
      <li v-for="guide in guides" :key="guide.id" class="rounded border border-slate-200 p-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="font-medium">{{ guideTitle(guide) }}</p>
            <!--
              FR-011d, derived from the steps. Saying so plainly beats a badge:
              an author whose guide is invisible needs to know why.
            -->
            <p class="text-xs text-slate-500">
              {{
                guide.isReaderVisible
                  ? t('kb.structure.guideVisible', { count: guide.steps.length })
                  : t('kb.structure.guideHidden')
              }}
            </p>
          </div>

          <div class="flex gap-3 text-sm">
            <button type="button" class="underline" @click="startSteps(guide)">
              {{ t('kb.structure.editSteps') }}
            </button>
            <!-- The articles in it are untouched: a guide is a join, not a
                 container (research D9). -->
            <button type="button" class="underline" @click="removeGuide(guide)">
              {{ t('kb.structure.delete') }}
            </button>
          </div>
        </div>

        <ol v-if="guide.steps.length > 0" class="mt-2 list-decimal ps-6 text-sm text-slate-700">
          <li v-for="step in guide.steps" :key="step.articleId">
            {{ articleTitle(step) }}
            <span v-if="step.status !== 'published'" class="text-xs text-slate-500">
              ({{ t(`kb.status.${step.status}`) }})
            </span>
          </li>
        </ol>

        <!-- Step editor -->
        <div v-if="editingSteps?.guideId === guide.id" class="mt-4 border-t border-slate-200 pt-3">
          <ol class="space-y-2">
            <li
              v-for="(articleId, index) in editingSteps.articleIds"
              :key="articleId"
              class="flex items-center justify-between gap-2 text-sm"
            >
              <span>{{ index + 1 }}. {{ articleTitle(articleById.get(articleId) ?? { titleEn: null, titleAr: null }) }}</span>

              <span class="flex gap-1">
                <button
                  type="button"
                  class="rounded border border-slate-300 px-2 py-1 disabled:opacity-40"
                  :disabled="index === 0"
                  :aria-label="t('kb.structure.moveUp', { name: String(index + 1) })"
                  @click="moveStep(index, -1)"
                >
                  <span aria-hidden="true">↑</span>
                </button>
                <button
                  type="button"
                  class="rounded border border-slate-300 px-2 py-1 disabled:opacity-40"
                  :disabled="index === editingSteps.articleIds.length - 1"
                  :aria-label="t('kb.structure.moveDown', { name: String(index + 1) })"
                  @click="moveStep(index, 1)"
                >
                  <span aria-hidden="true">↓</span>
                </button>
                <button type="button" class="underline" @click="removeStep(articleId)">
                  {{ t('kb.structure.removeStep') }}
                </button>
              </span>
            </li>
          </ol>

          <!-- Adding a step is a SEARCH, never a raw id field. -->
          <label class="mt-3 block text-sm">
            <span class="mb-1 block text-slate-700">{{ t('kb.structure.addStep') }}</span>
            <input
              v-model="stepSearch"
              type="search"
              :placeholder="t('kb.structure.addStep.placeholder')"
              class="w-full rounded-md border border-slate-300 px-2 py-1.5"
            />
          </label>

          <ul v-if="stepCandidates.length > 0" class="mt-1 text-sm">
            <li v-for="candidate in stepCandidates" :key="candidate.id">
              <button type="button" class="underline" @click="addStep(candidate.id)">
                {{ articleTitle(candidate) }}
              </button>
            </li>
          </ul>

          <div class="mt-3 flex gap-3">
            <button
              type="button"
              class="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
              @click="saveSteps"
            >
              {{ t('action.save') }}
            </button>
            <button type="button" class="text-sm underline" @click="editingSteps = null">
              {{ t('action.cancel') }}
            </button>
          </div>
        </div>
      </li>
    </ul>

    <form class="flex flex-wrap items-end gap-3" @submit.prevent="addGuide">
      <label class="text-sm">
        <span class="mb-1 block text-slate-700">{{ t('kb.language.en') }}</span>
        <input v-model="draftGuide.titleEn" lang="en" dir="ltr" class="rounded-md border border-slate-300 px-2 py-1.5" />
      </label>
      <label class="text-sm">
        <span class="mb-1 block text-slate-700">{{ t('kb.language.ar') }}</span>
        <input v-model="draftGuide.titleAr" lang="ar" dir="rtl" class="rounded-md border border-slate-300 px-2 py-1.5" />
      </label>
      <button type="submit" class="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
        {{ t('kb.structure.addGuide') }}
      </button>
    </form>
  </section>
</template>
