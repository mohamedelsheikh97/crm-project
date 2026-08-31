<script setup lang="ts">
import { useI18n } from 'vue-i18n';

import type { TicketMessage } from '../../services/messages.service';

import DeliveryState from './DeliveryState.vue';

/**
 * CUSTOMER CORRESPONDENCE on a ticket, oldest first — a conversation reads
 * forwards, the same choice Phase 3 made for history and Phase 4 for notes.
 *
 * A SEPARATE COMPONENT FROM `TicketNoteThread.vue`, deliberately (FR-002,
 * FR-044, SC-006). The two sit on the same screen and hold different kinds of
 * writing: one is a colleague talking to a colleague under an expectation of
 * privacy, the other is the organisation speaking to a customer. They are told
 * apart by a persistent heading, a border treatment that survives greyscale, a
 * direction label on every message, and an icon with a text alternative — never
 * by colour alone.
 */
defineProps<{ messages: TicketMessage[]; loading: boolean }>();

const { t, d } = useI18n();
</script>

<template>
  <section aria-labelledby="message-thread-heading" class="space-y-3">
    <header>
      <h3 id="message-thread-heading" class="flex items-center gap-2 text-base font-semibold">
        <!-- Text alternative rather than aria-hidden: the icon carries meaning
             the heading alone does not, namely that this leaves the building. -->
        <span role="img" :aria-label="t('messages.thread.heading')">✉️</span>
        {{ t('messages.thread.heading') }}
      </h3>
      <p class="text-sm text-slate-600 dark:text-slate-400">
        {{ t('messages.thread.description') }}
      </p>
    </header>

    <p v-if="loading" class="text-sm text-slate-600 dark:text-slate-400">
      {{ t('table.loading') }}
    </p>

    <p
      v-else-if="messages.length === 0"
      class="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-400"
    >
      {{ t('messages.thread.empty') }}
    </p>

    <ol v-else class="space-y-3">
      <li
        v-for="message in messages"
        :key="message.id"
        class="rounded-md border-2 p-3"
        :class="
          message.direction === 'inbound'
            ? 'border-slate-400 border-dashed'
            : 'border-slate-700 border-solid dark:border-slate-300'
        "
      >
        <p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <!-- Direction and channel as WORDS, so greyscale and a screen reader
               both convey them (FR-110). -->
          <span class="font-semibold">{{ t(`messages.direction.${message.direction}`) }}</span>
          <span>{{ t(`messages.channel.${message.channel}`) }}</span>
          <span v-if="message.author">{{ message.author.fullName }}</span>
          <span v-else-if="message.senderIdentity" class="font-mono">
            {{ message.senderIdentity }}
          </span>
          <time :datetime="message.occurredAt">{{ d(new Date(message.occurredAt), 'long') }}</time>

          <DeliveryState
            v-if="message.direction === 'outbound'"
            :state="message.deliveryState"
            :detail="message.deliveryDetail"
          />
        </p>

        <!-- Rendered as TEXT, never as markup. The server already reduced HTML
             mail to readable text with no active content (FR-008, FR-034); this
             uses interpolation so nothing can reintroduce it. -->
        <p class="mt-2 whitespace-pre-wrap text-sm">{{ message.body }}</p>

        <ul v-if="message.attachments.length > 0" class="mt-2 space-y-1 text-sm">
          <li class="font-medium">{{ t('messages.attachments.label') }}</li>
          <li v-for="attachment in message.attachments" :key="attachment.id" class="font-mono">
            {{ attachment.fileName }}
          </li>
        </ul>
      </li>
    </ol>
  </section>
</template>
