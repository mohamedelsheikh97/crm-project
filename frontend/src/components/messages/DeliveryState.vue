<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import type { DeliveryState } from '../../services/messages.service';

/**
 * How a message actually did (FR-047, FR-048, FR-110).
 *
 * State is carried by a SYMBOL AND A WORD, never by colour alone — the
 * difference between `sent` and `delivered` is the difference between "we
 * handed it over" and "it arrived", and an agent who cannot tell them apart
 * stops chasing something that never landed.
 */
const props = defineProps<{ state: DeliveryState; detail: string | null; retryable?: boolean }>();

const emit = defineEmits<{ (event: 'retry'): void }>();

const { t } = useI18n();

/** Text alternatives, not decoration: each glyph is announced by its label. */
const GLYPH: Record<DeliveryState, string> = {
  pending: '⋯',
  sent: '→',
  delivered: '✓',
  read: '✓✓',
  failed: '✕',
};

const label = computed(() => t(`messages.delivery.${props.state}`));
</script>

<template>
  <span class="inline-flex items-center gap-1 text-xs" :class="state === 'failed' ? 'text-red-700 dark:text-red-300' : 'text-slate-600 dark:text-slate-400'">
    <!-- aria-hidden on the glyph, because the adjacent word already says it.
         Announcing both would read as "tick delivered". -->
    <span aria-hidden="true" class="font-mono">{{ GLYPH[state] }}</span>
    <span>{{ label }}</span>

    <!-- A failure names its cause where the agent who sent it will see it. -->
    <span v-if="state === 'failed' && detail" class="font-mono opacity-80">({{ detail }})</span>

    <!-- Offered ONLY when the adapter judged the failure worth retrying: a
         retry button on a permanent refusal invites an agent to fail twice. -->
    <button
      v-if="state === 'failed' && retryable"
      type="button"
      class="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2"
      @click="emit('retry')"
    >
      {{ t('messages.delivery.retry') }}
    </button>
  </span>
</template>
