<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import * as aiService from '../../services/ai.service';
import type { SimilarTicket } from '../../services/ai.service';

/**
 * Resolved tickets on the same theme (Phase 9, US5).
 *
 * NO AI DISCLOSURE, DELIBERATELY. Nothing here is generated — these are real
 * tickets that real people resolved — and marking them as AI output would be a
 * lie that devalues the disclosure on the surfaces where it means something.
 *
 * Loads with the panel rather than on a button, because it costs one query and
 * has no per-view price to ration (research D8).
 */
const props = defineProps<{ ticketId: number; available: boolean }>();

const emit = defineEmits<{ (event: 'open', ticketId: number): void }>();

const { t } = useI18n();

const items = ref<SimilarTicket[]>([]);
const loading = ref(false);
const loaded = ref(false);

async function load(): Promise<void> {
  if (!props.available) return;

  loading.value = true;

  try {
    items.value = (await aiService.similar(props.ticketId)).items;
  } catch {
    // A retrieval failure leaves the panel empty rather than shouting: this is
    // an aid, and the agent can always search.
    items.value = [];
  } finally {
    loading.value = false;
    loaded.value = true;
  }
}

onMounted(load);
watch(() => props.ticketId, load);
</script>

<template>
  <section v-if="available" class="similar" :aria-busy="loading">
    <h3 class="similar__title">{{ t('ai.similar.title') }}</h3>

    <p v-if="loading" class="similar__status" role="status">{{ t('ai.similar.loading') }}</p>

    <!-- FR-054: say so, rather than offering weak matches. -->
    <p v-else-if="loaded && items.length === 0" class="similar__status">
      {{ t('ai.similar.none') }}
    </p>

    <ul v-else class="similar__list">
      <li v-for="item in items" :key="item.ticketId" class="similar__item">
        <button type="button" class="similar__link" @click="emit('open', item.ticketId)">
          {{ item.reference }} — {{ item.subject }}
        </button>
        <p v-if="item.resolutionExcerpt" class="similar__excerpt">{{ item.resolutionExcerpt }}</p>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.similar {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  padding: 0.75rem;
}

.similar__title {
  font-size: 0.875rem;
  font-weight: 600;
  margin: 0 0 0.5rem;
}

.similar__status {
  font-size: 0.8125rem;
  color: #6b7280;
  margin: 0;
}

.similar__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.similar__link {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-size: 0.8125rem;
  color: #1d4ed8;
  cursor: pointer;
  text-align: start;
}

.similar__excerpt {
  margin: 0.125rem 0 0;
  font-size: 0.75rem;
  color: #4b5563;
}
</style>
