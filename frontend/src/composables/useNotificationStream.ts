import { onScopeDispose, ref, watch } from 'vue';

import { StreamUnauthorised, openNotificationStream } from '../services/notifications.service';
import { useAuthStore } from '../stores/auth.store';
import { useNotificationsStore } from '../stores/notifications.store';

/**
 * Keeps the live notification stream open for as long as someone is signed in.
 *
 * THE THING TO REMEMBER WHILE READING THIS: none of it is load-bearing for
 * correctness. Every notification is a database row before it is an event, so a
 * stream that never connects costs immediacy and nothing else — notifications
 * still arrive on load and on the next navigation (FR-054, SC-010). That is why
 * a failure here is logged rather than surfaced: an error banner over a working
 * dashboard would be a worse bug than the one it reports.
 */

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export function useNotificationStream(): { connected: ReturnType<typeof ref<boolean>> } {
  const auth = useAuthStore();
  const notifications = useNotificationsStore();

  const connected = ref(false);

  let controller: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let backoff = INITIAL_BACKOFF_MS;
  let stopped = false;

  function clearRetry(): void {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function scheduleRetry(): void {
    if (stopped || !auth.isAuthenticated) return;

    clearRetry();

    // Jittered, so a server restart does not bring every agent's browser back
    // in the same millisecond.
    const delay = backoff + Math.floor(Math.random() * 1_000);

    retryTimer = setTimeout(() => {
      void connect();
    }, delay);

    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }

  async function connect(): Promise<void> {
    if (stopped || !auth.isAuthenticated) return;

    controller?.abort();
    controller = new AbortController();

    try {
      // The catch-up FIRST, so the window between "the stream dropped" and
      // "the stream is back" leaves no gap. Anything that arrived while
      // disconnected is collected here.
      await notifications.catchUp();

      connected.value = true;
      backoff = INITIAL_BACKOFF_MS;

      await openNotificationStream(
        (notification) => notifications.receive(notification),
        controller.signal,
      );

      // A clean end still means the connection is gone; reconnect.
      connected.value = false;
      scheduleRetry();
    } catch (error) {
      connected.value = false;

      if (controller.signal.aborted) return;

      if (error instanceof StreamUnauthorised) {
        // The access token expired mid-stream. `http.ts` owns the single-flight
        // refresh, so any ordinary request triggers it; the catch-up call at
        // the top of the next attempt is exactly such a request.
        scheduleRetry();
        return;
      }

      scheduleRetry();
    }
  }

  function stop(): void {
    stopped = true;
    clearRetry();
    controller?.abort();
    controller = null;
    connected.value = false;
  }

  // Follows the session rather than the component: connect on sign-in, drop on
  // sign-out. `immediate` covers a page loaded by an already-authenticated user.
  watch(
    () => auth.isAuthenticated,
    (authenticated) => {
      if (authenticated) {
        stopped = false;
        backoff = INITIAL_BACKOFF_MS;
        void notifications.load().then(() => connect());
      } else {
        stop();
        notifications.clear();
      }
    },
    { immediate: true },
  );

  onScopeDispose(stop);

  return { connected };
}
