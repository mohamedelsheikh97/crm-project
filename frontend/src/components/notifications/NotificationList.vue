<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import type { NotificationView } from '../../services/notifications.service';
import { useNotificationsStore } from '../../stores/notifications.store';
import NotificationItem from './NotificationItem.vue';

/**
 * The notification list, and the live region that announces arrivals.
 *
 * THE LIVE REGION IS THE MOST DELICATE PART OF THIS PHASE. It is `polite` and
 * it never moves focus (FR-083): an agent halfway through typing a note must
 * not be interrupted by a ping. `aria-live="assertive"` or any focus call here
 * would be the single most likely accessibility regression in Phase 4.
 */
const notifications = useNotificationsStore();
const router = useRouter();
const { t } = useI18n();

const items = computed(() => notifications.items);

/** The announcement text, composed the same way an item's is. */
const announcement = computed(() => {
  const arrival = notifications.lastArrival;

  if (!arrival) return '';

  return t(`notification.type.${arrival.type}`, {
    actor: arrival.actor?.fullName ?? '',
    reference: arrival.ticket?.reference ?? '',
    subject: arrival.ticket?.subject ?? '',
    task: arrival.task?.title ?? '',
  });
});

async function open(notification: NotificationView): Promise<void> {
  if (notification.readAt === null) {
    await notifications.markRead(notification.id);
  }

  // The server has already resolved any merge chain, so this always lands on a
  // ticket that can actually be worked (FR-052).
  if (notification.ticket) {
    await router.push({ name: 'ticket-detail', params: { id: notification.ticket.id } });
  }
}
</script>

<template>
  <div>
    <!-- Polite, and outside the list so re-rendering the list does not re-read
         everything in it. -->
    <p aria-live="polite" class="sr-only">{{ announcement }}</p>

    <div class="flex items-center justify-between px-3 py-2">
      <h2 class="text-sm font-medium">{{ $t('notification.title') }}</h2>
      <button
        v-if="notifications.hasUnread"
        type="button"
        class="rounded text-xs text-blue-700 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-blue-300"
        @click="notifications.markAllRead()"
      >
        {{ $t('notification.markAllRead') }}
      </button>
    </div>

    <p v-if="items.length === 0" class="px-3 py-6 text-center text-sm text-slate-600">
      {{ $t('notification.empty') }}
    </p>

    <ul v-else class="max-h-96 overflow-y-auto">
      <NotificationItem
        v-for="notification in items"
        :key="notification.id"
        :notification="notification"
        @open="open"
      />
    </ul>
  </div>
</template>
