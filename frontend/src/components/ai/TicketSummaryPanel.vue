<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import * as aiService from '../../services/ai.service';
import type { TicketSummary } from '../../services/ai.service';

import AiDisclosure from './AiDisclosure.vue';

/**
 * Thread summarisation (Phase 9, US1).
 *
 * REQUESTED AFTER THE TICKET RENDERS, never as part of loading it (FR-004,
 * SC-023). The ticket view must open at its Phase 8 speed whether or not this
 * panel ever produces anything — so this component fetches on its own, and a
 * slow or dead AI service costs the reader a panel, not a page.
 *
 * NOTHING IS CACHED HERE (research D7, FR-065b, FR-065c). Leaving the ticket
 * and returning recomputes. A kept summary would go stale on the next inbound
 * message and look current while doing it, which is worse than an empty panel.
 *
 * CONTENT LANGUAGE IS NOT INTERFACE LANGUAGE. The summary renders in the
 * language of the correspondence with `dir` set from that, inside chrome in the
 * reader's locale (research D9, FR-057). An Arabic thread read by an
 * English-interface agent is Arabic text in English chrome — not a translation
 * nobody labelled.
 */
const props = defineProps<{ ticketId: number; available: boolean }>();

const { t } = useI18n();

const summary = ref<TicketSummary | null>(null);
const tooShort = ref(false);
const loading = ref(false);
const failure = ref<string | null>(null);
const requested = ref(false);

async function load(lang?: 'ar' | 'en'): Promise<void> {
  loading.value = true;
  failure.value = null;
  tooShort.value = false;
  requested.value = true;

  try {
    const result = (await aiService.summary(props.ticketId, lang)) as TicketSummary & {
      text: string | null;
      reason?: string;
    };

    if (result.text === null) {
      tooShort.value = true;
      summary.value = null;
      return;
    }

    summary.value = result;
  } catch (error) {
    // FR-003: state the failure. Never render an empty summary as a successful
    // one — a reader cannot tell the difference, and would trust it.
    const code = (error as { code?: string })?.code;
    failure.value =
      code === 'ai_feature_disabled'
        ? t('ai.disabled')
        : code === 'ai_budget_exhausted'
          ? t('ai.budgetExhausted')
          : t('ai.unavailable');
    summary.value = null;
  } finally {
    loading.value = false;
  }
}

function otherLanguage(): 'ar' | 'en' {
  return summary.value?.contentLang === 'ar' ? 'en' : 'ar';
}

// A different ticket is a different summary; never show the previous one.
watch(
  () => props.ticketId,
  () => {
    summary.value = null;
    tooShort.value = false;
    failure.value = null;
    requested.value = false;
  },
);
</script>

<template>
  <section v-if="available" class="ai-summary" :aria-busy="loading">
    <header class="ai-summary__header">
      <h3 class="ai-summary__title">{{ t('ai.summary.title') }}</h3>

      <button
        v-if="!requested"
        type="button"
        class="ai-summary__action"
        :disabled="loading"
        @click="load()"
      >
        {{ t('ai.summary.request') }}
      </button>
    </header>

    <!-- Announced, not merely shown: a summary arriving after the page settles
         is exactly the case a screen reader user would otherwise miss. -->
    <p v-if="loading" class="ai-summary__status" role="status">
      {{ t('ai.summary.loading') }}
    </p>

    <p v-else-if="failure" class="ai-summary__status ai-summary__status--error" role="alert">
      {{ failure }}
      <button type="button" class="ai-summary__retry" @click="load()">{{ t('ai.retry') }}</button>
    </p>

    <p v-else-if="tooShort" class="ai-summary__status" role="status">
      {{ t('ai.summary.tooShort') }}
    </p>

    <template v-else-if="summary">
      <!-- `dir` follows the CONTENT, not the interface. -->
      <p
        class="ai-summary__text"
        :dir="summary.contentLang === 'ar' ? 'rtl' : 'ltr'"
        :lang="summary.contentLang"
        role="status"
      >
        {{ summary.text }}
      </p>

      <footer class="ai-summary__footer">
        <AiDisclosure :generated-at="summary.generatedAt" />
        <span class="ai-summary__count">
          {{ t('ai.summary.covers', { count: summary.messageCount }) }}
        </span>
        <button type="button" class="ai-summary__action" @click="load(otherLanguage())">
          {{ t('ai.otherLanguage') }}
        </button>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.ai-summary {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  padding: 1rem;
  margin-block-end: 1rem;
  background: #fafafa;
}

.ai-summary__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.ai-summary__title {
  font-size: 0.875rem;
  font-weight: 600;
  margin: 0;
}

.ai-summary__text {
  margin-block: 0.75rem;
  white-space: pre-wrap;
  line-height: 1.6;
}

.ai-summary__status {
  margin-block: 0.5rem 0;
  font-size: 0.875rem;
  color: #4b5563;
}

.ai-summary__status--error {
  color: #b91c1c;
}

.ai-summary__footer {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.ai-summary__count {
  font-size: 0.75rem;
  color: #6b7280;
}

.ai-summary__action,
.ai-summary__retry {
  background: none;
  border: 1px solid #d1d5db;
  border-radius: 0.25rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  cursor: pointer;
}

.ai-summary__action:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
