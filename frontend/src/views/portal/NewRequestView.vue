<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import * as portalService from '../../services/portal.service';
import type { PortalSuggestion } from '../../services/portal.service';

/**
 * Raising a request (Phase 8, User Story 2, User Story 6).
 *
 * TWO THINGS THIS SCREEN MUST NOT DO, both of which are easy to do by accident:
 *
 * 1. LET DEFLECTION GET IN THE WAY (FR-042). Suggestions appear beside the form,
 *    never in front of it. The submit button is never disabled while a search is
 *    in flight, never moves, and never waits. Phase 7 wrote this rule for the
 *    public form and it applies with more force here: a customer with a problem
 *    who cannot reach a person is the worst outcome this system can produce, and
 *    it would be caused by a feature meant to help.
 *
 * 2. OFFER AN UPLOAD CONTROL (FR-022, FR-022a). There is no file input, and in
 *    its place a sentence saying how to send a file instead. NOT a disabled
 *    button: a disabled control invites clicking and explains nothing.
 *
 * The suggestion request is CANCELLED on each keystroke. Without that, a slow
 * response for "card" lands after a fast one for "card reader" and overwrites it
 * — the customer watches their suggestions become wrong as they type, which reads
 * as the feature being broken.
 */
const { t, locale } = useI18n();
const router = useRouter();
const route = useRoute();

const subject = ref(typeof route.query.subject === 'string' ? route.query.subject : '');
const description = ref('');
const category = ref('');
const priority = ref('');

const problems = ref<Array<{ field: string; message: string }>>([]);
const busy = ref(false);

const suggestions = ref<PortalSuggestion[]>([]);
const dismissed = ref(false);

const CATEGORIES = ['general', 'technical', 'billing', 'complaint'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

let controller: AbortController | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function scheduleSuggestions(text: string): void {
  if (timer) clearTimeout(timer);

  timer = setTimeout(async () => {
    controller?.abort();
    controller = new AbortController();

    try {
      const result = await portalService.suggestions(text, controller.signal);
      suggestions.value = result.items;
    } catch {
      // SILENT. An empty result and a failed lookup are the same thing from the
      // customer's point of view: nothing to offer. An error message here would
      // be noise beside a form they are trying to submit (FR-044).
      suggestions.value = [];
    }
  }, 400);
}

watch(description, (value) => {
  if (dismissed.value) return;
  if (value.trim().length < 8) {
    suggestions.value = [];
    return;
  }
  scheduleSuggestions(value);
});

onUnmounted(() => {
  if (timer) clearTimeout(timer);
  controller?.abort();
});

function messageFor(field: string): string | null {
  const problem = problems.value.find((entry) => entry.field === field);
  if (!problem) return null;
  // The server sends i18n keys, sometimes with a `:params` tail.
  return t(problem.message.split(':')[0] ?? problem.message);
}

async function submit(): Promise<void> {
  busy.value = true;
  problems.value = [];

  try {
    const { reference } = await portalService.raiseRequest({
      subject: subject.value,
      description: description.value,
      category: category.value || undefined,
      priority: priority.value || undefined,
    });

    await router.push({ name: 'portal-request', params: { reference } });
  } catch (error) {
    problems.value =
      (error as { details?: Array<{ field: string; message: string }> }).details ?? [];

    if (problems.value.length === 0) {
      problems.value = [{ field: 'form', message: 'portal.error.unexpected' }];
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="lg:flex lg:gap-8">
    <div class="min-w-0 flex-1">
      <h1 class="text-xl font-semibold">{{ t('portal.newRequest.title') }}</h1>

      <form class="mt-6 space-y-4" novalidate @submit.prevent="submit">
        <p
          v-if="messageFor('form')"
          role="alert"
          class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {{ messageFor('form') }}
        </p>

        <div>
          <label for="request-subject" class="block text-sm font-medium text-slate-700">
            {{ t('portal.newRequest.field.subject') }}
          </label>
          <input
            id="request-subject"
            v-model="subject"
            type="text"
            required
            :aria-invalid="Boolean(messageFor('subject'))"
            aria-describedby="request-subject-error"
            class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          />
          <p
            v-if="messageFor('subject')"
            id="request-subject-error"
            role="alert"
            class="mt-1 text-sm text-red-700"
          >
            {{ messageFor('subject') }}
          </p>
        </div>

        <div>
          <label for="request-description" class="block text-sm font-medium text-slate-700">
            {{ t('portal.newRequest.field.description') }}
          </label>
          <textarea
            id="request-description"
            v-model="description"
            rows="6"
            required
            :aria-invalid="Boolean(messageFor('description'))"
            aria-describedby="request-description-error"
            class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          />
          <p
            v-if="messageFor('description')"
            id="request-description-error"
            role="alert"
            class="mt-1 text-sm text-red-700"
          >
            {{ messageFor('description') }}
          </p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label for="request-category" class="block text-sm font-medium text-slate-700">
              {{ t('portal.newRequest.field.category') }}
            </label>
            <select
              id="request-category"
              v-model="category"
              class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <!-- OPTIONAL, unlike the staff form. A customer should not have to
                   classify their own problem to be allowed to report it. -->
              <option value="">—</option>
              <option v-for="key of CATEGORIES" :key="key" :value="key">
                {{ t(`ticket.category.${key}`) }}
              </option>
            </select>
          </div>

          <div>
            <label for="request-priority" class="block text-sm font-medium text-slate-700">
              {{ t('portal.newRequest.field.priority') }}
            </label>
            <select
              id="request-priority"
              v-model="priority"
              class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="">—</option>
              <option v-for="key of PRIORITIES" :key="key" :value="key">
                {{ t(`ticket.priority.${key}`) }}
              </option>
            </select>
          </div>
        </div>

        <!-- WHERE AN UPLOAD CONTROL WOULD BE (FR-022a). A sentence, not a
             disabled button. -->
        <p class="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {{ t('portal.noUploads') }}
        </p>

        <!-- NEVER disabled by a suggestion lookup. Only by its own submission. -->
        <button
          type="submit"
          :disabled="busy"
          class="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60 sm:w-auto"
        >
          {{ busy ? t('portal.newRequest.submitting') : t('portal.newRequest.submit') }}
        </button>
      </form>
    </div>

    <!-- BESIDE the form, never in front of it. Absent entirely when there is
         nothing to offer — silence rather than "no results" (FR-044). -->
    <aside
      v-if="suggestions.length > 0 && !dismissed"
      class="mt-8 lg:mt-0 lg:w-72 lg:flex-none"
      :aria-label="t('portal.newRequest.suggestions.title')"
    >
      <h2 class="text-sm font-semibold">{{ t('portal.newRequest.suggestions.title') }}</h2>

      <ul class="mt-2 space-y-2">
        <li v-for="item of suggestions" :key="item.slug">
          <RouterLink
            :to="{ name: 'portal-help-article', params: { slug: item.slug } }"
            class="block rounded-md border border-slate-200 bg-white p-3 text-sm hover:border-slate-300"
          >
            <span class="font-medium">{{ item.title }}</span>
            <!-- FR-043: a one-language article says which language it is in. -->
            <span v-if="item.lang !== locale" class="ms-1 text-xs text-slate-500">
              ({{ t(`kb.language.${item.lang}`) }})
            </span>
            <span v-if="item.excerpt" class="mt-1 block text-xs text-slate-600">
              {{ item.excerpt }}
            </span>
          </RouterLink>
        </li>
      </ul>

      <button
        type="button"
        class="mt-2 text-xs text-slate-500 underline hover:text-slate-800"
        @click="dismissed = true"
      >
        {{ t('portal.newRequest.suggestions.dismiss') }}
      </button>
    </aside>
  </div>
</template>
