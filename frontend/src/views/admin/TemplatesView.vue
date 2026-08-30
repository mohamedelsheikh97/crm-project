<script setup lang="ts">
import { onMounted, ref } from 'vue';

import { ApiError } from '../../services/http';
import {
  createTemplate,
  fetchTemplates,
  retireTemplate,
  updateTemplate,
  type ReplyTemplate,
  type TemplateInput,
} from '../../services/templates.service';

/**
 * Managing the reply library.
 *
 * Under /admin because changing a template changes what every agent says to
 * customers — that is configuration, and it is audited (FR-077). USING a
 * template needs no screen at all: the picker lives inside the note composer,
 * which is where the writing happens.
 *
 * Retirement, not deletion (FR-071). There is no delete control here and the
 * API offers none: text already written from a template is never rewritten by
 * a later change to it.
 */
const items = ref<ReplyTemplate[]>([]);
const loading = ref(false);
const saving = ref(false);
const editing = ref<ReplyTemplate | null>(null);
const errorKey = ref<string | null>(null);
const fieldErrors = ref<Record<string, string>>({});

const draft = ref<TemplateInput>({ titleEn: '', titleAr: '', bodyEn: '', bodyAr: '' });

async function load(): Promise<void> {
  loading.value = true;

  try {
    // Retired templates ARE listed here — this is the one screen where they
    // still matter, so an administrator can see what was withdrawn.
    items.value = (await fetchTemplates({ includeRetired: true })).items;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function startCreate(): void {
  editing.value = null;
  draft.value = { titleEn: '', titleAr: '', bodyEn: '', bodyAr: '' };
  errorKey.value = null;
  fieldErrors.value = {};
}

function startEdit(template: ReplyTemplate): void {
  editing.value = template;
  draft.value = {
    titleEn: template.titleEn ?? '',
    titleAr: template.titleAr ?? '',
    bodyEn: template.bodyEn ?? '',
    bodyAr: template.bodyAr ?? '',
  };
  errorKey.value = null;
  fieldErrors.value = {};
}

async function save(): Promise<void> {
  saving.value = true;
  errorKey.value = null;
  fieldErrors.value = {};

  try {
    if (editing.value) {
      await updateTemplate(editing.value.id, draft.value);
    } else {
      await createTemplate(draft.value);
    }

    startCreate();
    await load();
  } catch (error) {
    if (error instanceof ApiError) {
      errorKey.value =
        error.code === 'TEMPLATE_LANGUAGE_REQUIRED'
          ? 'template.error.oneLanguageRequired'
          : 'error.unexpected';

      // The server says WHICH half is missing, and so does this screen — a
      // bare "invalid" would leave the author guessing.
      for (const detail of error.details) {
        fieldErrors.value[detail.field] = detail.message;
      }
    } else {
      errorKey.value = 'error.unexpected';
    }
  } finally {
    saving.value = false;
  }
}

async function retire(template: ReplyTemplate): Promise<void> {
  await retireTemplate(template.id);
  await load();
}
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-xl font-semibold">{{ $t('template.title') }}</h1>

    <form
      class="space-y-3 rounded border border-slate-200 p-4 dark:border-slate-700"
      @submit.prevent="save"
    >
      <h2 class="text-sm font-medium">
        {{ editing ? $t('template.editTitle') : $t('template.createTitle') }}
      </h2>

      <p class="text-xs text-slate-600 dark:text-slate-400">{{ $t('template.languageHint') }}</p>

      <div class="grid gap-3 sm:grid-cols-2">
        <div v-for="lang in ['en', 'ar'] as const" :key="lang" class="space-y-2">
          <h3 class="text-sm font-medium">{{ $t(`language.name.${lang}`) }}</h3>

          <label :for="`title-${lang}`" class="block text-sm">{{
            $t('template.field.title')
          }}</label>
          <input
            :id="`title-${lang}`"
            v-model="draft[lang === 'en' ? 'titleEn' : 'titleAr']"
            type="text"
            class="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-600 dark:bg-slate-900"
            :aria-invalid="Boolean(fieldErrors[lang === 'en' ? 'titleEn' : 'titleAr'])"
          />
          <p
            v-if="fieldErrors[lang === 'en' ? 'titleEn' : 'titleAr']"
            role="alert"
            class="text-sm text-red-700"
          >
            {{ $t(fieldErrors[lang === 'en' ? 'titleEn' : 'titleAr']) }}
          </p>

          <label :for="`body-${lang}`" class="block text-sm">{{ $t('template.field.body') }}</label>
          <textarea
            :id="`body-${lang}`"
            v-model="draft[lang === 'en' ? 'bodyEn' : 'bodyAr']"
            rows="4"
            class="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-600 dark:bg-slate-900"
            :aria-invalid="Boolean(fieldErrors[lang === 'en' ? 'bodyEn' : 'bodyAr'])"
          />
          <p
            v-if="fieldErrors[lang === 'en' ? 'bodyEn' : 'bodyAr']"
            role="alert"
            class="text-sm text-red-700"
          >
            {{ $t(fieldErrors[lang === 'en' ? 'bodyEn' : 'bodyAr']) }}
          </p>
        </div>
      </div>

      <p v-if="errorKey" role="alert" class="text-sm text-red-700">{{ $t(errorKey) }}</p>

      <div class="flex gap-2">
        <button
          type="submit"
          :disabled="saving"
          class="rounded bg-blue-700 px-3 py-1.5 text-sm text-white disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          {{ $t('action.save') }}
        </button>
        <button
          v-if="editing"
          type="button"
          class="rounded border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-600"
          @click="startCreate"
        >
          {{ $t('action.cancel') }}
        </button>
      </div>
    </form>

    <section>
      <p v-if="loading" class="text-sm text-slate-500">{{ $t('table.loading') }}</p>

      <ul v-else class="divide-y divide-slate-100 dark:divide-slate-800">
        <li
          v-for="template in items"
          :key="template.id"
          class="flex flex-wrap items-center gap-2 py-2"
        >
          <span class="font-medium">{{ template.titleEn ?? template.titleAr }}</span>

          <span class="text-xs text-slate-500">
            {{ template.availableLanguages.map((l) => $t(`language.name.${l}`)).join(' · ') }}
          </span>

          <!-- Marked in words, not by a greyed row: "retired" must survive
               greyscale and a screen reader (FR-084). -->
          <span
            v-if="template.retiredAt"
            class="rounded bg-slate-200 px-2 py-0.5 text-xs dark:bg-slate-700"
          >
            {{ $t('template.retired') }}
          </span>

          <button
            type="button"
            class="ms-auto rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-600"
            @click="startEdit(template)"
          >
            {{ $t('action.edit') }}
          </button>

          <button
            v-if="!template.retiredAt"
            type="button"
            class="rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-600"
            @click="retire(template)"
          >
            {{ $t('template.retire') }}
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>
