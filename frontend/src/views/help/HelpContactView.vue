<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import LanguageBadge from '../../components/knowledge/LanguageBadge.vue';
import { http } from '../../services/http';
import { searchPublic, type KbLanguage, type PublicSearchResult } from '../../services/knowledge.service';

/**
 * Raising a ticket, with deflection beside it (FR-032d, FR-032e, FR-033).
 *
 * DEFLECTION IS ADVISORY, AND EVERYTHING ABOUT THIS COMPONENT ENFORCES THAT.
 *
 * As the customer describes their problem, matching articles appear BESIDE the
 * submit control. They may solve their problem in ten seconds without waiting
 * for anybody, which is genuinely better for them than a ticket.
 *
 * BUT: THE SUBMIT CONTROL IS NEVER DISABLED, NEVER DELAYED, AND NEVER MOVES.
 *
 *   - `submitting` is the ONLY thing that disables it, and that is the ordinary
 *     double-submit guard. `searching` never touches it.
 *   - The suggestions render in a fixed region BELOW the button, so appearing
 *     matches cannot shift the button out from under a finger that is already
 *     travelling towards it. On a phone that is not a nicety.
 *   - A search that is slow, fails, or is rate limited leaves this form
 *     completely usable — the catch below does nothing but clear the panel.
 *
 * The failure this prevents: a customer with a problem, unable to reach a
 * person, because a feature meant to help them was waiting on a search. That is
 * the worst outcome this system can produce.
 */

const { t, locale } = useI18n();

const email = ref('');
const detail = ref('');
const submitting = ref(false);
const submitted = ref(false);
const failed = ref(false);

const suggestions = ref<PublicSearchResult | null>(null);
const searching = ref(false);

const DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 4;

let timer: ReturnType<typeof setTimeout> | null = null;
let controller: AbortController | null = null;
let sequence = 0;

async function deflect(): Promise<void> {
  const term = detail.value.trim();

  if (term.length < MIN_QUERY_LENGTH) {
    suggestions.value = null;
    return;
  }

  controller?.abort();
  controller = new AbortController();

  const mine = (sequence += 1);
  searching.value = true;

  try {
    const result = await searchPublic(term, {
      lang: (locale.value === 'ar' ? 'ar' : 'en') as KbLanguage,
      signal: controller.signal,
    });

    if (mine !== sequence) return;
    suggestions.value = result;
  } catch {
    // DELIBERATELY SILENT, and deliberately not surfaced to the customer. A
    // failed search is our problem, not theirs; telling them about it would
    // suggest their submission is at risk when it is not.
    if (mine === sequence) suggestions.value = null;
  } finally {
    if (mine === sequence) searching.value = false;
  }
}

watch(detail, () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(deflect, DEBOUNCE_MS);
});

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
  controller?.abort();
});

/**
 * Submission goes straight to Phase 5's unchanged endpoint.
 *
 * It does not await, consult, or care about the search above. Note that there
 * is no `await deflect()` anywhere in this function — and that absence is
 * FR-032e.
 */
async function submit(): Promise<void> {
  submitting.value = true;
  failed.value = false;

  try {
    await http.post('/public/forms/contact-us/submissions', {
      answers: { email: email.value, detail: detail.value },
    });

    submitted.value = true;
  } catch {
    failed.value = true;
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl px-4 py-8">
    <nav class="mb-6 text-sm">
      <RouterLink :to="{ name: 'help' }" class="underline">{{ t('help.backToHelp') }}</RouterLink>
    </nav>

    <h1 class="text-2xl font-semibold tracking-tight">{{ t('help.contact.title') }}</h1>
    <p class="mt-1 text-slate-600">{{ t('help.contact.description') }}</p>

    <section v-if="submitted" class="mt-6 rounded-md bg-slate-50 px-4 py-6">
      <p class="font-medium">{{ t('help.contact.sent.title') }}</p>
      <p class="mt-1 text-slate-600">{{ t('help.contact.sent.hint') }}</p>
    </section>

    <form v-else class="mt-6" @submit.prevent="submit">
      <label class="block">
        <span class="mb-1 block text-sm font-medium text-slate-700">
          {{ t('help.contact.field.email') }}
        </span>
        <input
          v-model="email"
          type="email"
          required
          autocomplete="email"
          class="w-full rounded-md border border-slate-300 px-3 py-2 text-base"
        />
      </label>

      <label class="mt-4 block">
        <span class="mb-1 block text-sm font-medium text-slate-700">
          {{ t('help.contact.field.detail') }}
        </span>
        <textarea
          v-model="detail"
          rows="6"
          required
          class="w-full rounded-md border border-slate-300 px-3 py-2 text-base"
        ></textarea>
      </label>

      <p v-if="failed" role="alert" class="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
        {{ t('help.contact.failed') }}
      </p>

      <!--
        THE SUBMIT CONTROL, IN A FIXED POSITION.
        `:disabled` is `submitting` and nothing else. `searching` is deliberately
        absent from this line — see the component comment.
      -->
      <button
        type="submit"
        :disabled="submitting"
        class="mt-4 rounded-md bg-slate-900 px-4 py-2.5 text-base font-medium text-white disabled:opacity-60"
      >
        {{ t('help.contact.submit') }}
      </button>

      <!--
        Suggestions BELOW the button, so an appearing match cannot move the
        button out from under a finger already travelling towards it.
      -->
      <section
        v-if="suggestions && suggestions.items.length > 0"
        class="mt-6 rounded-md border border-slate-200 p-3"
        :aria-label="t('help.contact.maybeAnswers')"
      >
        <p class="text-sm font-medium text-slate-700">{{ t('help.contact.maybeAnswers') }}</p>

        <ul class="mt-2 divide-y divide-slate-100">
          <li v-for="hit in suggestions.items.slice(0, 3)" :key="hit.slug" class="py-2">
            <RouterLink
              :to="{ name: 'help-article', params: { slug: hit.slug } }"
              class="flex flex-wrap items-center gap-2"
            >
              <span
                :lang="hit.lang"
                :dir="hit.lang === 'ar' ? 'rtl' : 'ltr'"
                class="font-medium underline"
              >
                {{ hit.title }}
              </span>
              <LanguageBadge :languages="[hit.lang]" />
            </RouterLink>
          </li>
        </ul>

        <!-- Said out loud, so nobody feels talked out of asking. -->
        <p class="mt-2 text-xs text-slate-500">{{ t('help.contact.stillSend') }}</p>
      </section>
    </form>
  </div>
</template>
