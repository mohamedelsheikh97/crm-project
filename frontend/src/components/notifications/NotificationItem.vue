<script setup lang="ts">
import { computed } from 'vue';

import type { NotificationView } from '../../services/notifications.service';

/**
 * One notification, composed CLIENT-SIDE from its type and parameters.
 *
 * The server sends no sentence, and must not start: the same row is read by an
 * Arabic user and an English one, so the language cannot be decided at write
 * time (Principle I, research D2). If a `message` field ever appears on this
 * type, that decision has been quietly reversed.
 */
const props = defineProps<{ notification: NotificationView }>();

const emit = defineEmits<{ (event: 'open', notification: NotificationView): void }>();

const params = computed(() => ({
  actor: props.notification.actor?.fullName ?? '',
  reference: props.notification.ticket?.reference ?? '',
  subject: props.notification.ticket?.subject ?? '',
  task: props.notification.task?.title ?? '',
}));

const isUnread = computed(() => props.notification.readAt === null);
const createdAt = computed(() => new Date(props.notification.createdAt));
</script>

<template>
  <li class="border-b border-slate-100 last:border-0 dark:border-slate-800">
    <button
      type="button"
      class="flex w-full items-start gap-2 px-3 py-2 text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      :class="isUnread ? 'bg-blue-50 dark:bg-slate-800' : ''"
      @click="emit('open', notification)"
    >
      <!-- Unread is marked by a word, not only by a dot and a background tint
           (FR-084). Greyscale, colour-blindness, and screen readers all lose
           the tint; none of them lose this. -->
      <span
        v-if="isUnread"
        class="mt-0.5 shrink-0 rounded-full bg-blue-700 px-1.5 py-0.5 text-[10px] font-medium text-white"
      >
        {{ $t('notification.unread') }}
      </span>

      <span class="min-w-0 flex-1">
        <span class="block text-sm">
          {{ $t(`notification.type.${notification.type}`, params) }}
        </span>
        <i18n-d
          tag="span"
          class="mt-0.5 block text-xs text-slate-500 dark:text-slate-400"
          :value="createdAt"
          :format="{ dateStyle: 'medium', timeStyle: 'short' }"
        />
      </span>
    </button>
  </li>
</template>
