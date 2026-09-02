<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/**
 * The AI-generated marker (Phase 9, FR-014, FR-059, SC-026).
 *
 * USED BY EVERY SURFACE THAT SHOWS GENERATED CONTENT, so the wording and the
 * treatment cannot drift between them — a summary panel and a chatbot bubble
 * that disclose differently teach a reader that the marker means nothing.
 *
 * TRANSLATED, NEVER ENGLISH ON AN ARABIC PAGE (FR-059). It follows the READER's
 * locale, not the content language: a disclosure exists to be understood by the
 * person looking at it, which is the one string on these surfaces where that is
 * true (FR-057 governs the generated text itself, and it goes the other way).
 *
 * NOT COLOUR ALONE. The icon and the label both carry the meaning, so the
 * greyscale pass (T124) has something to pass on.
 *
 * NOT used by the similar-tickets panel: nothing there is generated, and
 * marking real tickets as AI output would be a lie that devalues the marker
 * everywhere else.
 */
withDefaults(defineProps<{ generatedAt?: string | null }>(), { generatedAt: null });

const { t, d } = useI18n();
</script>

<template>
  <p class="ai-disclosure" role="note">
    <span class="ai-disclosure__icon" aria-hidden="true">✦</span>
    <span>{{ t('ai.disclosure.label') }}</span>
    <span v-if="generatedAt" class="ai-disclosure__time">
      {{ d(new Date(generatedAt), 'short') }}
    </span>
  </p>
</template>

<style scoped>
.ai-disclosure {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.75rem;
  /* Meets AA against the panel background; the icon and text carry the meaning
     so contrast is not the only signal. */
  color: #4b5563;
}

.ai-disclosure__icon {
  font-size: 0.875rem;
}

.ai-disclosure__time {
  /* `margin-inline-start` rather than `margin-left`: RTL is a root-level
     concern and per-component direction hacks are prohibited (Principle I). */
  margin-inline-start: auto;
  color: #6b7280;
}
</style>
