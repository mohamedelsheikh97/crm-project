<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import type { ComposerContext } from '../../services/messages.service';

/**
 * THE REPLY TO A CUSTOMER.
 *
 * A DIFFERENT COMPONENT FROM `TicketNoteComposer.vue`, submitting to a
 * different service and a different endpoint (FR-044, SC-006). There is no
 * shared composer with an `isInternal` prop, because a wrong prop default would
 * be a disclosure — SC-006 requires the mistake to be unrepresentable, not
 * merely unlikely.
 *
 * Three things make the difference visible without relying on colour:
 *
 *   - a standing line naming the recipient AND the channel
 *   - a submit control that names the act ("Send to customer"), never "Send"
 *   - a warning that this leaves the organisation
 */
const props = defineProps<{ context: ComposerContext | null; sending: boolean }>();

const emit = defineEmits<{ (event: 'send', body: string): void }>();

const { t, d } = useI18n();

const body = ref('');

/**
 * Refusals are shown BEFORE the agent types, not after they write (FR-051,
 * FR-057). Discovering that a message could never be sent, after composing it,
 * is the experience this exists to prevent.
 */
const optedOut = computed(() => props.context?.optOut ?? null);

const windowClosed = computed(
  () => props.context?.window !== null && props.context?.window?.freeformAllowed === false,
);

const disabled = computed(
  () =>
    props.sending || optedOut.value !== null || windowClosed.value || !props.context?.conversation,
);

function submit(): void {
  const text = body.value.trim();

  if (text === '' || disabled.value) return;

  emit('send', text);
  body.value = '';
}

/** Exposed so the template picker can insert into this composer (FR-045). */
function insert(text: string): void {
  body.value = body.value === '' ? text : `${body.value}\n\n${text}`;
}

defineExpose({ insert });
</script>

<template>
  <section
    aria-labelledby="reply-composer-heading"
    class="space-y-2 rounded-md border-2 border-solid border-slate-700 p-3 dark:border-slate-300"
  >
    <h3 id="reply-composer-heading" class="flex items-center gap-2 text-base font-semibold">
      <span role="img" :aria-label="t('messages.composer.heading')">✉️</span>
      {{ t('messages.composer.heading') }}
    </h3>

    <!-- Names WHO and on WHICH CHANNEL, permanently. An agent should never have
         to remember which of the two boxes they are in. -->
    <p v-if="context?.conversation" class="text-sm">
      {{
        t('messages.composer.sendingTo', {
          identity: context.conversation.recipientIdentity,
          channel: t(`messages.channel.${context.conversation.channel}`),
        })
      }}
    </p>

    <p v-else class="text-sm">{{ t('messages.error.noReplyChannel') }}</p>

    <p class="text-sm font-medium">{{ t('messages.composer.warning') }}</p>

    <!-- Both refusals are ANNOUNCED, not merely displayed: an agent using a
         screen reader must learn the box is unusable before typing into it. -->
    <p v-if="optedOut" role="status" class="text-sm font-medium">
      {{
        t('messages.optedOut.notice', {
          channel: t(`messages.channel.${optedOut.channel}`),
          date: d(new Date(optedOut.optedOutAt), 'long'),
        })
      }}
    </p>

    <div v-else-if="windowClosed" role="status" class="space-y-1 text-sm">
      <p class="font-medium">{{ t('messages.window.notice') }}</p>
      <p v-if="(context?.window?.allowedTemplates.length ?? 0) > 0">
        {{ t('messages.window.templates') }}:
        <span class="font-mono">{{ context?.window?.allowedTemplates.join(', ') }}</span>
      </p>
    </div>

    <label class="block">
      <span class="sr-only">{{ t('messages.composer.heading') }}</span>
      <textarea
        v-model="body"
        :disabled="disabled"
        rows="4"
        :placeholder="t('messages.composer.placeholder')"
        class="w-full rounded-md border border-slate-300 p-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 dark:border-slate-600"
      ></textarea>
    </label>

    <!-- Names the ACT, so it cannot be confused with saving a note. -->
    <button
      type="button"
      :disabled="disabled || body.trim() === ''"
      class="rounded-md border-2 border-slate-700 px-3 py-1.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 dark:border-slate-300"
      @click="submit"
    >
      {{ sending ? t('messages.composer.sending') : t('messages.composer.send') }}
    </button>
  </section>
</template>
