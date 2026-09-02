import { onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * The dashboard refresh contract (Phase 10, FR-045a-d, research D8).
 *
 * Clarifications Q2 chose interval refresh, which is the option an operations
 * room actually wants — and the one with failure modes that computing on page
 * load does not have. Each of the three below is a requirement rather than a
 * nicety, because each one turns a reporting feature into a different kind of
 * problem.
 *
 *   FR-045a  SKIP, NEVER QUEUE. If a refresh is still running when the next is
 *            due, the next is dropped. Queuing turns a slow query under load
 *            into a growing backlog of identical queries — a reporting feature
 *            becoming an outage during exactly the busy period somebody opened
 *            the dashboard to watch.
 *
 *   FR-045b  STOP WHEN UNOBSERVED. A dashboard left open overnight on an
 *            unattended screen must not query until morning.
 *
 *   FR-045d  KEEP THE LAST GOOD FIGURES on failure, with their own timestamp.
 *            `computedAt` is the last SUCCESSFUL refresh, never the last
 *            attempt — a stale number beside a current-looking clock is worse
 *            than no clock.
 *
 * FR-045c — not announcing updates to a screen reader — is the consuming
 * component's responsibility: figures are deliberately NOT in an `aria-live`
 * region, and the reader gets `refreshNow` as a deliberate control instead. A
 * dashboard that read every changed number aloud every minute would be hostile.
 */
export interface AutoRefreshOptions {
  /** Milliseconds. Configurable rather than fixed, per FR-045. */
  readonly intervalMs: number;
  /** Stop refreshing after this long without user interaction. */
  readonly idleAfterMs?: number;
}

export function useAutoRefresh(load: () => Promise<void>, options: AutoRefreshOptions) {
  const inFlight = ref(false);
  const lastSuccessAt = ref<Date | null>(null);
  const lastError = ref<unknown>(null);
  const paused = ref(false);

  let timer: ReturnType<typeof setInterval> | null = null;
  let lastInteraction = Date.now();

  /** Counted so a test can assert that refreshes never accumulate (SC-018a). */
  const skipped = ref(0);

  async function run(): Promise<void> {
    // FR-045a. The whole of it: one line, and it is the difference between a
    // slow query and an outage.
    if (inFlight.value) {
      skipped.value += 1;
      return;
    }

    inFlight.value = true;

    try {
      await load();
      // Only a SUCCESSFUL load advances the timestamp (FR-045d).
      lastSuccessAt.value = new Date();
      lastError.value = null;
    } catch (error) {
      // The caller keeps whatever figures it already has. Blanking the
      // dashboard or showing zeroes would both be worse than a stale number
      // that says how stale it is.
      lastError.value = error;
    } finally {
      inFlight.value = false;
    }
  }

  function observed(): boolean {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;

    const idleAfter = options.idleAfterMs ?? 30 * 60_000;

    return Date.now() - lastInteraction < idleAfter;
  }

  function tick(): void {
    // FR-045b.
    if (!observed()) {
      paused.value = true;
      return;
    }

    paused.value = false;
    void run();
  }

  function noteInteraction(): void {
    lastInteraction = Date.now();

    // Coming back to a paused dashboard refreshes immediately rather than
    // waiting out the remainder of an interval — otherwise the first thing the
    // returning reader sees is a number from an hour ago.
    if (paused.value) tick();
  }

  function refreshNow(): Promise<void> {
    lastInteraction = Date.now();
    return run();
  }

  onMounted(() => {
    void run();

    timer = setInterval(tick, options.intervalMs);

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', noteInteraction);
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', noteInteraction, { passive: true });
      window.addEventListener('keydown', noteInteraction);
    }
  });

  onBeforeUnmount(() => {
    if (timer !== null) clearInterval(timer);

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', noteInteraction);
    }

    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', noteInteraction);
      window.removeEventListener('keydown', noteInteraction);
    }
  });

  return { inFlight, lastSuccessAt, lastError, paused, skipped, refreshNow, tick };
}
