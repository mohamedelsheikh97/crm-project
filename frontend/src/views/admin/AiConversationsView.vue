<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import * as adminService from '../../services/ai-admin.service';
import type { ConversationDetail, ConversationRow } from '../../services/ai-admin.service';

/**
 * Chatbot transcripts (Phase 9, US6, FR-043).
 *
 * THE ONE PLACE IN THIS PHASE THAT SHOWS RETAINED TEXT, and it is here because
 * of what the text IS rather than because AI produced it (FR-065a). These are
 * statements the organisation made to customers. Phase 5 retains outbound
 * messages on the same basis, and an administrator can read those too.
 *
 * The neighbouring activity screen says content is not retained; this one shows
 * content. Both are correct, and the distinction is the one FR-065a draws — so
 * the page says which rule it is operating under, rather than leaving a reader
 * to conclude that one of the two screens is lying.
 */
const { t, d } = useI18n();

const rows = ref<ConversationRow[]>([]);
const selected = ref<ConversationDetail | null>(null);
const loading = ref(true);

async function load(): Promise<void> {
  loading.value = true;

  try {
    rows.value = (await adminService.conversations()).items;
  } finally {
    loading.value = false;
  }
}

async function open(id: number): Promise<void> {
  selected.value = await adminService.conversation(id);
}

onMounted(load);
</script>

<template>
  <section class="conversations">
    <h1 class="conversations__title">{{ t('ai.admin.conversations') }}</h1>

    <p class="conversations__notice" role="note">{{ t('ai.admin.conversationsWhy') }}</p>

    <p v-if="loading" role="status">{{ t('ai.admin.loading') }}</p>

    <p v-else-if="rows.length === 0" class="conversations__empty">
      {{ t('ai.admin.noConversations') }}
    </p>

    <div v-else class="conversations__layout">
      <ul class="conversations__list">
        <li v-for="row in rows" :key="row.id">
          <button type="button" class="conversations__item" @click="open(row.id)">
            <span>#{{ row.id }} · {{ row.lang }}</span>
            <span v-if="row.escalatedAt" class="conversations__badge">
              {{ t('ai.admin.escalated') }}
            </span>
            <span class="conversations__when">{{ d(new Date(row.lastActivityAt), 'short') }}</span>
          </button>
        </li>
      </ul>

      <article v-if="selected" class="conversations__detail">
        <h2 class="conversations__subtitle">#{{ selected.id }}</h2>

        <div
          v-for="(turn, index) in selected.turns"
          :key="index"
          class="conversations__turn"
          :class="`conversations__turn--${turn.role}`"
          :dir="selected.lang === 'ar' ? 'rtl' : 'ltr'"
          :lang="selected.lang"
        >
          <p class="conversations__role">{{ t(`ai.admin.role.${turn.role}`) }}</p>
          <p class="conversations__body">{{ turn.body }}</p>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.conversations {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.conversations__title {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0;
}

.conversations__subtitle {
  font-size: 0.9375rem;
  font-weight: 600;
  margin: 0 0 0.5rem;
}

.conversations__notice {
  margin: 0;
  padding: 0.625rem;
  border: 1px solid #bfdbfe;
  border-radius: 0.375rem;
  background: #eff6ff;
  font-size: 0.8125rem;
}

.conversations__layout {
  display: grid;
  grid-template-columns: minmax(12rem, 20rem) 1fr;
  gap: 1rem;
  align-items: start;
}

@media (max-width: 48rem) {
  .conversations__layout {
    grid-template-columns: 1fr;
  }
}

.conversations__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.conversations__item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.375rem;
  background: none;
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
  text-align: start;
}

.conversations__badge {
  font-size: 0.6875rem;
  padding: 0.0625rem 0.375rem;
  border: 1px solid #a7f3d0;
  border-radius: 999px;
  background: #ecfdf5;
}

.conversations__when {
  margin-inline-start: auto;
  color: #6b7280;
}

.conversations__detail {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  padding: 0.75rem;
}

.conversations__turn {
  padding: 0.5rem;
  border-radius: 0.375rem;
  margin-block-end: 0.5rem;
  background: #f3f4f6;
}

.conversations__turn--customer {
  background: #e0e7ff;
}

.conversations__role {
  margin: 0 0 0.125rem;
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #4b5563;
}

.conversations__body {
  margin: 0;
  font-size: 0.875rem;
  white-space: pre-wrap;
}

.conversations__empty {
  font-size: 0.875rem;
  color: #4b5563;
}
</style>
