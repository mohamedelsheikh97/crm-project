<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import AiDisclosure from '../../components/ai/AiDisclosure.vue';
import * as assistantService from '../../services/assistant.service';
import type { AssistantCitedArticle } from '../../services/assistant.service';

/**
 * The customer assistant (Phase 9, US3).
 *
 * MOBILE-FIRST, like every Phase 8 portal surface.
 *
 * NO DEAD END, EVER (FR-042). When the assistant is unavailable — disabled, its
 * controlled-infrastructure processor down, or the customer's language not one
 * it answers in — this view says so and offers the Phase 8 route to a ticket.
 * There is no fallback to another processor, by design (FR-008b).
 *
 * A REFUSAL IS NOT AN ERROR. "I cannot answer that" arrives as a normal reply
 * carrying `needsHuman`, and the escalation offer appears beside it.
 */
interface Turn {
  role: 'customer' | 'assistant';
  body: string;
  citedArticles?: AssistantCitedArticle[];
}

const { t } = useI18n();
const router = useRouter();

const turns = ref<Turn[]>([]);
const draft = ref('');
const conversationId = ref<number | null>(null);
const sending = ref(false);
const needsHuman = ref(false);
const unavailable = ref(false);
const escalatedTo = ref<string | null>(null);
const live = ref<HTMLElement | null>(null);

async function send(): Promise<void> {
  const body = draft.value.trim();
  if (body === '' || sending.value) return;

  turns.value.push({ role: 'customer', body });
  draft.value = '';
  sending.value = true;
  needsHuman.value = false;

  try {
    const reply = await assistantService.sendMessage(body, conversationId.value);

    conversationId.value = reply.conversationId;
    needsHuman.value = reply.needsHuman;

    turns.value.push({
      role: 'assistant',
      body: reply.reply.body,
      citedArticles: reply.reply.citedArticles,
    });

    await nextTick();
    live.value?.scrollTo({ top: live.value.scrollHeight });
  } catch (error) {
    const code = (error as { code?: string })?.code;

    if (code === 'ai_feature_disabled' || code === 'ai_unavailable') {
      // FR-042: not a dead end. The Phase 8 form is still there.
      unavailable.value = true;
      return;
    }

    turns.value.push({ role: 'assistant', body: t('ai.unavailable') });
  } finally {
    sending.value = false;
  }
}

async function escalate(): Promise<void> {
  if (conversationId.value === null) return;

  try {
    const result = await assistantService.escalate(conversationId.value);
    escalatedTo.value = result.ticketReference;
  } catch (error) {
    // FR-036c: a repeat escalation returns the FIRST reference. The customer
    // sees one ticket and one number, not an error to interpret.
    const already = (error as { ticketReference?: string })?.ticketReference;

    if (already) {
      escalatedTo.value = already;
      return;
    }

    turns.value.push({ role: 'assistant', body: t('ai.unavailable') });
  }
}

function openRequest(): void {
  if (escalatedTo.value) router.push(`/portal/requests/${escalatedTo.value}`);
}
</script>

<template>
  <section class="assistant">
    <h1 class="assistant__title">{{ t('portal.assistant.title') }}</h1>

    <!-- No dead end (FR-042). -->
    <div v-if="unavailable" class="assistant__unavailable">
      <p>{{ t('portal.assistant.unavailable') }}</p>
      <RouterLink class="assistant__cta" to="/portal/requests/new">
        {{ t('portal.assistant.raiseInstead') }}
      </RouterLink>
    </div>

    <template v-else>
      <div ref="live" class="assistant__turns" role="log" aria-live="polite">
        <p v-if="turns.length === 0" class="assistant__empty">
          {{ t('portal.assistant.empty') }}
        </p>

        <div
          v-for="(turn, index) in turns"
          :key="index"
          class="assistant__turn"
          :class="`assistant__turn--${turn.role}`"
        >
          <p class="assistant__body">{{ turn.body }}</p>

          <AiDisclosure v-if="turn.role === 'assistant'" />

          <ul v-if="turn.citedArticles && turn.citedArticles.length > 0" class="assistant__cited">
            <li v-for="article in turn.citedArticles" :key="article.slug ?? article.title">
              <RouterLink v-if="article.slug" :to="`/portal/help?article=${article.slug}`">
                {{ article.title }}
              </RouterLink>
              <span v-else>{{ article.title }}</span>
            </li>
          </ul>
        </div>
      </div>

      <div v-if="escalatedTo" class="assistant__escalated" role="status">
        <p>{{ t('portal.assistant.escalated', { reference: escalatedTo }) }}</p>
        <button type="button" class="assistant__cta" @click="openRequest">
          {{ t('portal.assistant.viewRequest') }}
        </button>
      </div>

      <div v-else-if="needsHuman" class="assistant__offer" role="status">
        <p>{{ t('portal.assistant.offerHuman') }}</p>
        <button type="button" class="assistant__cta" @click="escalate">
          {{ t('portal.assistant.askHuman') }}
        </button>
      </div>

      <form class="assistant__composer" @submit.prevent="send">
        <label class="assistant__label" for="assistant-input">
          {{ t('portal.assistant.inputLabel') }}
        </label>
        <textarea
          id="assistant-input"
          v-model="draft"
          class="assistant__input"
          rows="3"
          :disabled="sending || escalatedTo !== null"
        ></textarea>
        <button
          type="submit"
          class="assistant__cta"
          :disabled="sending || draft.trim() === '' || escalatedTo !== null"
        >
          {{ sending ? t('portal.assistant.sending') : t('portal.assistant.send') }}
        </button>
      </form>
    </template>
  </section>
</template>

<style scoped>
.assistant {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-width: 44rem;
  margin-inline: auto;
  padding: 1rem;
}

.assistant__title {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0;
}

.assistant__turns {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  /* Bounded so the composer stays reachable with a keyboard covering half a
     phone screen — the mobile pass this phase is the first to need. */
  max-height: 55vh;
  overflow-y: auto;
  padding: 0.5rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
}

.assistant__turn {
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: #f3f4f6;
}

.assistant__turn--customer {
  /* `margin-inline-start` so RTL mirrors without a per-component override. */
  margin-inline-start: 2rem;
  background: #e0e7ff;
}

.assistant__turn--assistant {
  margin-inline-end: 2rem;
}

.assistant__body {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.5;
}

.assistant__cited {
  margin: 0.375rem 0 0;
  padding-inline-start: 1rem;
  font-size: 0.75rem;
}

.assistant__empty,
.assistant__label {
  font-size: 0.8125rem;
  color: #4b5563;
}

.assistant__composer {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.assistant__input {
  width: 100%;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  padding: 0.5rem;
  font: inherit;
}

.assistant__cta {
  /* 44px minimum target — the mobile pass (T127). */
  min-height: 2.75rem;
  padding-inline: 1rem;
  border: 1px solid #1d4ed8;
  border-radius: 0.375rem;
  background: #1d4ed8;
  color: #fff;
  font: inherit;
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.assistant__cta:disabled {
  opacity: 0.6;
  cursor: default;
}

.assistant__offer,
.assistant__escalated,
.assistant__unavailable {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
}

.assistant__offer p,
.assistant__escalated p,
.assistant__unavailable p {
  margin: 0;
  font-size: 0.875rem;
}
</style>
