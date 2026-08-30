<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  fetchTemplates,
  resolveTemplateBody,
  type ReplyTemplate,
  type TemplateLanguage,
} from '../../services/templates.service';

/**
 * Finding a template and putting it into the note composer.
 *
 * Two things here implement FR-070 rather than gesturing at it:
 *
 *   - the version matching the ACTIVE language is what gets inserted; and
 *   - when a template exists in only one language, that version is offered with
 *     ITS LANGUAGE NAMED, rather than silently handing an Arabic-speaking agent
 *     English text as though it were their own.
 *
 * There is a copy action as well as an insert one, because in this phase an
 * agent's real outbound channel is often outside this application entirely
 * (Clarifications Q2). Phase 5 adds channels as further insertion targets.
 */
const emit = defineEmits<{
  (event: 'insert', template: ReplyTemplate, body: string): void;
  (event: 'close'): void;
}>();

const { locale, t } = useI18n();

const query = ref('');
const items = ref<ReplyTemplate[]>([]);
const loading = ref(false);
const previewed = ref<ReplyTemplate | null>(null);
const copied = ref(false);

const activeLanguage = computed<TemplateLanguage>(() => (locale.value === 'ar' ? 'ar' : 'en'));

async function search(): Promise<void> {
  loading.value = true;

  try {
    // Bounded and searched on the SERVER (FR-072): the picker never renders the
    // whole library, which is also what keeps it usable once the library grows.
    items.value = (await fetchTemplates({ q: query.value })).items;
  } finally {
    loading.value = false;
  }
}

onMounted(search);
watch(query, search);

function titleFor(template: ReplyTemplate): string {
  const preferred = activeLanguage.value === 'ar' ? template.titleAr : template.titleEn;
  return preferred ?? template.titleEn ?? template.titleAr ?? '';
}

/** Non-null only when the offered version is NOT in the agent's language. */
function otherLanguageLabel(template: ReplyTemplate): string | null {
  const resolved = resolveTemplateBody(template, activeLanguage.value);

  if (!resolved || resolved.language === activeLanguage.value) return null;

  return t('template.onlyAvailableIn', { language: t(`language.name.${resolved.language}`) });
}

function insert(template: ReplyTemplate): void {
  const resolved = resolveTemplateBody(template, activeLanguage.value);

  if (!resolved) return;

  emit('insert', template, resolved.body);
}

async function copy(template: ReplyTemplate): Promise<void> {
  const resolved = resolveTemplateBody(template, activeLanguage.value);

  if (!resolved) return;

  try {
    await navigator.clipboard.writeText(resolved.body);
    copied.value = true;
  } catch {
    // Clipboard access can be refused by the browser. The insert path still
    // works, so this is not worth an error banner.
  }
}
</script>

<template>
  <div
    class="rounded border border-slate-200 p-3 dark:border-slate-700"
    role="dialog"
    :aria-label="$t('template.picker.label')"
    @keydown.escape="emit('close')"
  >
    <label for="template-search" class="block text-sm font-medium">
      {{ $t('template.search') }}
    </label>
    <input
      id="template-search"
      v-model="query"
      type="search"
      class="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-600 dark:bg-slate-900"
      :placeholder="$t('template.searchPlaceholder')"
    />

    <p v-if="loading" class="mt-2 text-sm text-slate-500">{{ $t('table.loading') }}</p>

    <p v-else-if="items.length === 0" class="mt-2 text-sm text-slate-600 dark:text-slate-400">
      {{ $t('template.empty') }}
    </p>

    <ul v-else class="mt-2 max-h-64 space-y-1 overflow-y-auto">
      <li v-for="template in items" :key="template.id" class="rounded border border-slate-100 p-2 dark:border-slate-800">
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="rounded text-start text-sm font-medium underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            :aria-expanded="previewed?.id === template.id"
            @click="previewed = previewed?.id === template.id ? null : template"
          >
            {{ titleFor(template) }}
          </button>

          <!-- Named, not silently substituted (FR-070). -->
          <span
            v-if="otherLanguageLabel(template)"
            class="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-900 dark:text-amber-100"
          >
            {{ otherLanguageLabel(template) }}
          </span>

          <button
            type="button"
            class="ms-auto rounded bg-blue-700 px-2 py-1 text-xs text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            @click="insert(template)"
          >
            {{ $t('template.insert') }}
          </button>

          <button
            type="button"
            class="rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-600"
            @click="copy(template)"
          >
            {{ $t('template.copy') }}
          </button>
        </div>

        <p
          v-if="previewed?.id === template.id"
          class="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-300"
        >
          {{ resolveTemplateBody(template, activeLanguage)?.body }}
        </p>
      </li>
    </ul>

    <p aria-live="polite" class="sr-only">{{ copied ? $t('template.copied') : '' }}</p>
  </div>
</template>
