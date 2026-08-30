<script setup lang="ts">
import { ref } from 'vue';

import { useNotificationsStore } from '../../stores/notifications.store';
import NotificationList from './NotificationList.vue';

/**
 * The unread count, visible from EVERY screen (FR-048).
 *
 * Mounted in DefaultLayout rather than on the dashboard, because a notification
 * an agent only sees when they happen to open one particular screen is not a
 * notification.
 */
const notifications = useNotificationsStore();
const open = ref(false);
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="relative rounded p-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      :aria-expanded="open"
      aria-haspopup="true"
      :aria-label="$t('notification.bell', { count: notifications.unreadCount })"
      @click="open = !open"
    >
      <span aria-hidden="true">🔔</span>
      <!-- The count is a NUMBER, not a coloured dot: "3 unread" survives
           greyscale and a screen reader; a red dot survives neither (FR-084). -->
      <span
        v-if="notifications.hasUnread"
        class="absolute -end-0.5 -top-0.5 rounded-full bg-red-700 px-1.5 text-[10px] font-medium text-white"
      >
        {{ notifications.unreadCount }}
      </span>
    </button>

    <!-- `end-0` rather than `right-0`: the panel follows the document
         direction, so it opens on the correct side in Arabic without a
         per-component flip (FR-081). -->
    <div
      v-if="open"
      class="absolute end-0 z-20 mt-1 w-80 rounded border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900"
      @keydown.escape="open = false"
    >
      <NotificationList />
    </div>
  </div>
</template>
