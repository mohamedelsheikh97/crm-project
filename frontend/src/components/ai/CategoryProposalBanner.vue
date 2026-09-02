<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import * as aiService from '../../services/ai.service';
import type { CategoryProposal } from '../../services/ai.service';

import AiDisclosure from './AiDisclosure.vue';

/**
 * A suggested category, awaiting a human (Phase 9, US4, Clarifications Q2).
 *
 * VISIBLY A SUGGESTION, NEVER A VALUE (FR-046). It is a banner beside the
 * ticket, not a pre-filled category field — because the ticket's category has
 * not changed and will not until somebody accepts. Styling this as though the
 * field were already set would be a lie about the state of the record, and
 * would train agents to ignore the difference.
 *
 * The accept button is only shown where the agent may set a category; the
 * endpoint is gated on `tickets:update` regardless (Principle II).
 */
const props = defineProps<{ ticketId: number; available: boolean; canUpdate: boolean }>();

const emit = defineEmits<{ (event: 'accepted'): void }>();

const { t } = useI18n();

const proposal = ref<CategoryProposal | null>(null);
const busy = ref(false);

async function load(): Promise<void> {
  if (!props.available) return;

  try {
    proposal.value = (await aiService.categoryProposal(props.ticketId)).proposal;
  } catch {
    // A proposal is advice. Failing to fetch it is not worth telling anyone.
    proposal.value = null;
  }
}

async function accept(): Promise<void> {
  busy.value = true;

  try {
    await aiService.acceptProposal(props.ticketId);
    proposal.value = null;
    // The parent reloads the ticket: the category really has changed now, and
    // it changed as this agent's decision.
    emit('accepted');
  } catch {
    // Most likely a colleague categorised it first, which is the correct
    // outcome — reload and the banner disappears.
    await load();
  } finally {
    busy.value = false;
  }
}

async function dismiss(): Promise<void> {
  busy.value = true;

  try {
    await aiService.dismissProposal(props.ticketId);
    proposal.value = null;
  } catch {
    await load();
  } finally {
    busy.value = false;
  }
}

onMounted(load);
watch(() => props.ticketId, load);
</script>

<template>
  <aside v-if="available && proposal" class="proposal" role="note">
    <p class="proposal__text">
      {{ t('ai.proposal.suggests', { category: t(`ticket.category.${proposal.proposed}`) }) }}
    </p>

    <AiDisclosure />

    <div class="proposal__actions">
      <button
        v-if="canUpdate"
        type="button"
        class="proposal__accept"
        :disabled="busy"
        @click="accept"
      >
        {{ t('ai.proposal.accept') }}
      </button>
      <button
        v-if="canUpdate"
        type="button"
        class="proposal__dismiss"
        :disabled="busy"
        @click="dismiss"
      >
        {{ t('ai.proposal.dismiss') }}
      </button>
    </div>
  </aside>
</template>

<style scoped>
.proposal {
  /* Deliberately unlike a form field: a dashed edge reads as advice, and the
     greyscale pass (T128) has the border style as well as the tint to work
     with. */
  border: 1px dashed #9ca3af;
  border-radius: 0.5rem;
  padding: 0.75rem;
  margin-block-end: 0.75rem;
  background: #fffbeb;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.proposal__text {
  margin: 0;
  font-size: 0.875rem;
}

.proposal__actions {
  display: flex;
  gap: 0.5rem;
}

.proposal__accept,
.proposal__dismiss {
  min-height: 2rem;
  padding-inline: 0.75rem;
  border-radius: 0.25rem;
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
}

.proposal__accept {
  border: 1px solid #1d4ed8;
  background: #1d4ed8;
  color: #fff;
}

.proposal__dismiss {
  border: 1px solid #d1d5db;
  background: none;
}

.proposal__accept:disabled,
.proposal__dismiss:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
