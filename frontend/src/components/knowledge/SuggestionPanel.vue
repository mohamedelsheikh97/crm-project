<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import LanguageBadge from './LanguageBadge.vue';
import {
  detachArticle,
  fetchSuggestions,
  type KbSuggestion,
} from '../../services/knowledge.service';

/**
 * Articles that might answer this ticket (User Story 3, FR-041 to FR-045).
 *
 * THE MOST IMPORTANT BEHAVIOUR ON THIS COMPONENT IS THAT IT SHOWS NOTHING WHEN
 * THERE IS NOTHING.
 *
 * A panel that always shows three articles teaches agents that the panel means
 * nothing. Once they have learned that, they stop reading it — and improving
 * the suggestions cannot bring them back, because the habit outlives the fix. A
 * panel that is often empty and occasionally right is one they read.
 *
 * So the empty state here is an EXPLICIT LINE saying there is nothing to
 * suggest, not a blank region and not a spinner that never resolves. A blank
 * region reads as a component that failed to load, which is a different and
 * worse message.
 *
 * FETCHED SEPARATELY from the ticket (FR-045): the ticket renders first, and
 * this fills in. Nobody waits for a suggestion to read the thing they opened.
 */

const props = defineProps<{ ticketId: number }>();
const emit = defineEmits<{ (event: 'open', articleId: number): void }>();

const { t } = useI18n();

const items = ref<KbSuggestion[]>([]);
const loading = ref(true);
const failed = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  failed.value = false;

  try {
    items.value = await fetchSuggestions(props.ticketId);
  } catch {
    // A failed suggestion fetch must never look like "nothing to suggest" —
    // that would quietly teach the agent the wrong thing about the corpus.
    failed.value = true;
    items.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => props.ticketId, load);

/**
 * OPENING A SUGGESTION MUST NOT LOSE THE AGENT'S PLACE (FR-044).
 *
 * The parent decides where it goes; this component only says which. A
 * navigation that discarded a half-written reply would turn a feature meant to
 * save time into one that costs work.
 */
function open(articleId: number): void {
  emit('open', articleId);
}

/**
 * Unpinning removes an OPINION about the ticket and touches nothing else.
 *
 * Offered on pinned entries only. There is nothing to unpin on a computed
 * suggestion — it was never a decision, and a control implying otherwise would
 * teach agents that dismissing a suggestion means something to the system.
 */
async function unpin(articleId: number): Promise<void> {
  await detachArticle(props.ticketId, articleId);
  await load();
}
</script>

<template>
  <section :aria-label="t('kb.suggestions.title')">
    <h2 class="text-lg font-semibold">{{ t('kb.suggestions.title') }}</h2>

    <p v-if="loading" class="py-2 text-sm text-slate-600" role="status">
      {{ t('kb.suggestions.loading') }}
    </p>

    <!-- Distinct from "nothing to suggest", deliberately. -->
    <p v-else-if="failed" class="py-2 text-sm text-slate-600" role="status">
      {{ t('kb.suggestions.failed') }}
    </p>

    <ul v-else-if="items.length > 0" class="divide-y divide-slate-100">
      <!--
        A PINNED article sits in a bordered row and a computed suggestion does
        not, so the two are distinguishable by SHAPE and not only by the badge
        inside — the greyscale rule (FR-056).
      -->
      <li
        v-for="item in items"
        :key="item.articleId"
        class="py-2"
        :class="item.pinned ? 'border-s-2 border-slate-400 ps-2' : ''"
      >
        <button type="button" class="text-start" @click="open(item.articleId)">
          <span class="flex flex-wrap items-center gap-2">
            <!--
              `lang` and `dir` from the ARTICLE, not the interface (FR-055).
              The chrome keeps the reader's direction; this text carries its own.
            -->
            <span
              :lang="item.lang"
              :dir="item.lang === 'ar' ? 'rtl' : 'ltr'"
              class="font-medium text-slate-900 underline"
            >
              {{ item.title }}
            </span>

            <LanguageBadge :languages="[item.lang]" />

            <!--
              A PINNED article is visually distinct from a suggestion, and says
              WHO pinned it. "A colleague chose this" and "a rule attached this"
              are different facts, and an agent deciding whether to trust it
              needs to know which — text and shape, never colour alone (FR-056).
            -->
            <span v-if="item.pinned" class="rounded border border-slate-400 px-1.5 py-0.5 text-xs">
              <span aria-hidden="true">📌</span>
              {{
                item.attachedBy
                  ? t('kb.suggestions.pinnedBy', { name: item.attachedBy.fullName })
                  : t('kb.suggestions.pinnedByRule')
              }}
            </span>
          </span>

          <span v-if="item.categoryName" class="mt-0.5 block text-xs text-slate-500">
            {{ item.categoryName }}
          </span>

          <span
            v-if="item.excerpt"
            :lang="item.lang"
            :dir="item.lang === 'ar' ? 'rtl' : 'ltr'"
            class="mt-1 block text-sm text-slate-600"
          >
            {{ item.excerpt }}
          </span>
        </button>

        <!-- Only on a pinned entry: a suggestion was never a decision to undo. -->
        <button
          v-if="item.pinned"
          type="button"
          class="mt-1 text-xs underline text-slate-600"
          @click="unpin(item.articleId)"
        >
          {{ t('kb.suggestions.unpin') }}
        </button>
      </li>
    </ul>

    <!--
      THE EMPTY STATE. The single most important thing this component renders.
      An explicit line, not a blank region — and never three weak matches.
    -->
    <p v-else class="py-2 text-sm text-slate-600">
      {{ t('kb.suggestions.empty') }}
    </p>
  </section>
</template>
