<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

import * as aiService from '../../services/ai.service';
import type { CitedArticle } from '../../services/ai.service';

/**
 * Draft a reply (Phase 9, US2).
 *
 * EMITS TEXT; IT DOES NOT SEND. The parent inserts the result into the existing
 * reply composer — the same `insert()` the Phase 4 template picker uses — so a
 * draft arrives exactly where a template does and is edited and sent by the
 * same path (FR-026, FR-027).
 *
 * Only rendered where the agent may send customer messages. That is a
 * convenience, not a control: the endpoint is gated on `messages:send`
 * server-side (FR-028, Constitution Principle II).
 *
 * The citations are shown BEFORE the agent sends, because verifying them is the
 * thing the agent is there to do (FR-029).
 */
const props = defineProps<{ ticketId: number; available: boolean }>();

const emit = defineEmits<{ (event: 'drafted', text: string): void }>();

const { t } = useI18n();

const loading = ref(false);
const failure = ref<string | null>(null);
const cited = ref<CitedArticle[]>([]);

async function draft(): Promise<void> {
  loading.value = true;
  failure.value = null;

  try {
    const result = await aiService.draft(props.ticketId);
    cited.value = result.citedArticles;
    emit('drafted', result.text);
  } catch (error) {
    const code = (error as { code?: string })?.code;
    failure.value =
      code === 'ai_feature_disabled'
        ? t('ai.disabled')
        : code === 'ai_budget_exhausted'
          ? t('ai.budgetExhausted')
          : t('ai.unavailable');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div v-if="available" class="draft-reply">
    <button type="button" class="draft-reply__button" :disabled="loading" @click="draft">
      {{ loading ? t('ai.draft.loading') : t('ai.draft.request') }}
    </button>

    <p v-if="failure" class="draft-reply__error" role="alert">{{ failure }}</p>

    <p v-else-if="cited.length > 0" class="draft-reply__cited">
      {{ t('ai.draft.cited') }}
      <span v-for="article in cited" :key="article.id" class="draft-reply__article">
        {{ article.title }}
      </span>
    </p>
  </div>
</template>

<style scoped>
.draft-reply {
  margin-block-end: 0.5rem;
}

.draft-reply__button {
  border: 1px solid #d1d5db;
  border-radius: 0.25rem;
  background: none;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  cursor: pointer;
}

.draft-reply__button:disabled {
  opacity: 0.6;
  cursor: default;
}

.draft-reply__error {
  margin-block-start: 0.375rem;
  font-size: 0.75rem;
  color: #b91c1c;
}

.draft-reply__cited {
  margin-block-start: 0.375rem;
  font-size: 0.75rem;
  color: #4b5563;
}

.draft-reply__article {
  margin-inline-start: 0.375rem;
  font-style: italic;
}
</style>
