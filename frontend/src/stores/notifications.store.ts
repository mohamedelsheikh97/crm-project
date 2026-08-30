import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import type { NotificationView } from '../services/notifications.service';
import * as notificationsService from '../services/notifications.service';

/**
 * The notification list, its unread count, and the high-water mark the stream
 * reconnects from.
 *
 * `lastSeenId` is what makes a dropped connection self-healing: on every
 * (re)connect the composable asks for everything newer than it, so a gap in the
 * stream closes without the user noticing (FR-054, SC-010).
 */
export const useNotificationsStore = defineStore('notifications', () => {
  const items = ref<NotificationView[]>([]);
  const unreadCount = ref(0);
  const lastSeenId = ref(0);
  const loading = ref(false);
  /**
   * The most recent arrival, for the live region to announce.
   *
   * Announced politely and WITHOUT moving focus (FR-083) — an agent typing a
   * note must not be interrupted by a ping.
   */
  const lastArrival = ref<NotificationView | null>(null);

  const hasUnread = computed(() => unreadCount.value > 0);

  function track(notification: NotificationView): void {
    if (notification.id > lastSeenId.value) lastSeenId.value = notification.id;
  }

  /** Inserts an arrival at the top, ignoring one already present. */
  function receive(notification: NotificationView): void {
    if (items.value.some((existing) => existing.id === notification.id)) return;

    items.value = [notification, ...items.value];
    if (notification.readAt === null) unreadCount.value += 1;
    track(notification);
    lastArrival.value = notification;
  }

  async function load(): Promise<void> {
    loading.value = true;

    try {
      const page = await notificationsService.fetchNotifications();
      items.value = page.items;
      unreadCount.value = page.unreadCount;
      page.items.forEach(track);
    } finally {
      loading.value = false;
    }
  }

  /**
   * Collects anything the stream missed. Called on every (re)connect, which is
   * why a lost connection costs latency rather than a notification.
   */
  async function catchUp(): Promise<void> {
    const page = await notificationsService.fetchNotifications({ since: lastSeenId.value });

    // Oldest first, so the newest ends up at the top of the list.
    for (const notification of [...page.items].reverse()) receive(notification);

    unreadCount.value = page.unreadCount;
  }

  async function markRead(id: number): Promise<void> {
    const updated = await notificationsService.markRead(id);

    items.value = items.value.map((item) => (item.id === id ? updated : item));
    unreadCount.value = Math.max(0, unreadCount.value - 1);
  }

  async function markAllRead(): Promise<void> {
    const { unreadCount: remaining } = await notificationsService.markAllRead();
    const readAt = new Date().toISOString();

    items.value = items.value.map((item) => (item.readAt ? item : { ...item, readAt }));
    unreadCount.value = remaining;
  }

  function clear(): void {
    items.value = [];
    unreadCount.value = 0;
    lastSeenId.value = 0;
    lastArrival.value = null;
  }

  return {
    items,
    unreadCount,
    lastSeenId,
    loading,
    lastArrival,
    hasUnread,
    receive,
    load,
    catchUp,
    markRead,
    markAllRead,
    clear,
  };
});
