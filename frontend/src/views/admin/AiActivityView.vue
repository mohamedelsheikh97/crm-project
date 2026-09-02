<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import * as adminService from '../../services/ai-admin.service';
import type { AiInvocationRow } from '../../services/ai-admin.service';

/**
 * What the AI has been doing (Phase 9, US6, FR-063).
 *
 * THIS SCREEN STATES THAT CONTENT IS NOT RETAINED, prominently, and that is the
 * one design decision in it.
 *
 * An activity log that shows a feature, a ticket, a timestamp and a token count
 * — and no prompt, no answer — looks broken to somebody who came here to find
 * out what a bad summary actually said. They would reasonably conclude the log
 * is incomplete and go looking for the real one. Saying why there is no content
 * turns a confusing screen into an informative one, and it also records the
 * decision where the person affected by it will read it (Clarifications Q3).
 */
const { t, d } = useI18n();

const rows = ref<AiInvocationRow[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(true);

async function load(next = 1): Promise<void> {
  loading.value = true;

  try {
    const result = await adminService.activity(next);
    rows.value = result.items;
    total.value = result.total;
    page.value = result.page;
  } finally {
    loading.value = false;
  }
}

onMounted(() => load());
</script>

<template>
  <section class="activity">
    <h1 class="activity__title">{{ t('ai.admin.activity') }}</h1>

    <!-- The point of the screen, not a footnote. -->
    <p class="activity__notice" role="note">{{ t('ai.admin.noContentRetained') }}</p>

    <p v-if="loading" role="status">{{ t('ai.admin.loading') }}</p>

    <p v-else-if="rows.length === 0" class="activity__empty">
      {{ t('ai.admin.noActivity') }}
    </p>

    <div v-else class="activity__scroll">
      <table class="activity__table">
        <thead>
          <tr>
            <th scope="col">{{ t('ai.admin.col.feature') }}</th>
            <th scope="col">{{ t('ai.admin.col.subject') }}</th>
            <th scope="col">{{ t('ai.admin.col.outcome') }}</th>
            <th scope="col">{{ t('ai.admin.col.location') }}</th>
            <th scope="col">{{ t('ai.admin.col.tokens') }}</th>
            <th scope="col">{{ t('ai.admin.col.at') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td>{{ t(`ai.admin.feature.${row.feature}`) }}</td>
            <td>{{ row.subjectId ?? '—' }}</td>
            <td>
              {{ t(`ai.admin.outcome.${row.outcome}`) }}
              <span v-if="row.errorCode" class="activity__code">({{ row.errorCode }})</span>
            </td>
            <td>{{ row.location }}</td>
            <td>{{ (row.inputTokens ?? 0) + (row.outputTokens ?? 0) || '—' }}</td>
            <td>{{ d(new Date(row.at), 'short') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <nav v-if="total > rows.length" class="activity__pager">
      <button type="button" :disabled="page <= 1" @click="load(page - 1)">
        {{ t('pagination.previous') }}
      </button>
      <span>{{ page }}</span>
      <button type="button" :disabled="rows.length === 0" @click="load(page + 1)">
        {{ t('pagination.next') }}
      </button>
    </nav>
  </section>
</template>

<style scoped>
.activity {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.activity__title {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0;
}

.activity__notice {
  margin: 0;
  padding: 0.625rem;
  border: 1px solid #bfdbfe;
  border-radius: 0.375rem;
  background: #eff6ff;
  font-size: 0.8125rem;
}

.activity__empty {
  font-size: 0.875rem;
  color: #4b5563;
}

/* Wide content scrolls inside its own container rather than the page. */
.activity__scroll {
  overflow-x: auto;
}

.activity__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.activity__table th,
.activity__table td {
  border-bottom: 1px solid #e5e7eb;
  padding: 0.375rem 0.5rem;
  text-align: start;
}

.activity__code {
  color: #6b7280;
}

.activity__pager {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
}

.activity__pager button {
  min-height: 2rem;
  padding-inline: 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 0.25rem;
  background: none;
  font: inherit;
  cursor: pointer;
}

.activity__pager button:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
