import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

import { useAutoRefresh } from '../../src/composables/useAutoRefresh';

/**
 * The refresh contract (Phase 10, FR-045a-d, SC-018a-b).
 *
 * The first test is the one that matters. FR-045a is a single `if` in the
 * composable, and without it a slow query under load produces a growing backlog
 * of identical queries — the reporting feature becoming an outage during exactly
 * the busy period somebody opened the dashboard to watch. It is the cheapest
 * requirement in the phase to implement and the most expensive to omit.
 */
function harness(load: () => Promise<void>, intervalMs = 1000) {
  const api: { value: ReturnType<typeof useAutoRefresh> | null } = { value: null };

  const Component = defineComponent({
    setup() {
      api.value = useAutoRefresh(load, { intervalMs });
      return () => h('div');
    },
  });

  const wrapper = mount(Component);

  return { wrapper, api };
}

describe('dashboard auto-refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('SKIPS a refresh while one is in flight, never queues it (FR-045a)', async () => {
    let started = 0;
    let release: (() => void) | null = null;

    const load = (): Promise<void> => {
      started += 1;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };

    const { api } = harness(load, 100);

    // The mount triggers the first load, which never settles.
    expect(started).toBe(1);

    // Three intervals pass while it is still running.
    api.value!.tick();
    api.value!.tick();
    api.value!.tick();

    // SC-018a: never more than one in flight. Without the guard this would be 4.
    expect(started).toBe(1);
    expect(api.value!.skipped.value).toBe(3);

    release?.();
  });

  it('resumes refreshing once the in-flight request settles', async () => {
    let started = 0;
    const load = async (): Promise<void> => {
      started += 1;
    };

    /**
     * A deliberately long interval, so only the explicit `tick()` below drives
     * a refresh.
     *
     * The first version of this test used 100ms and asserted `started === 2`.
     * It failed at 11, and the code was right: `vi.waitFor` advances fake
     * timers, so the interval legitimately fired nine more times while the test
     * waited. Pinning the interval out of range isolates the behaviour under
     * test from the timer that also drives it.
     */
    const { api } = harness(load, 10 * 60_000);
    await vi.waitFor(() => expect(api.value!.inFlight.value).toBe(false));

    expect(started).toBe(1);

    api.value!.tick();
    await vi.waitFor(() => expect(started).toBe(2));
  });

  it('STOPS refreshing when the document is hidden (FR-045b, SC-018b)', async () => {
    let started = 0;
    const load = async (): Promise<void> => {
      started += 1;
    };

    const { api } = harness(load, 100);
    await vi.waitFor(() => expect(started).toBe(1));

    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

    api.value!.tick();
    api.value!.tick();

    // A dashboard left open on an unattended screen must not query until
    // morning.
    expect(started).toBe(1);
    expect(api.value!.paused.value).toBe(true);

    spy.mockRestore();
  });

  it('advances the timestamp only on a SUCCESSFUL refresh (FR-045d)', async () => {
    let shouldFail = false;

    const load = async (): Promise<void> => {
      if (shouldFail) throw new Error('report query failed');
    };

    const { api } = harness(load, 100);
    await vi.waitFor(() => expect(api.value!.lastSuccessAt.value).not.toBeNull());

    const firstSuccess = api.value!.lastSuccessAt.value;

    shouldFail = true;
    await api.value!.refreshNow();

    // A stale number beside a current-looking clock is worse than no clock, so
    // the timestamp must NOT move on a failure.
    expect(api.value!.lastSuccessAt.value).toBe(firstSuccess);
    expect(api.value!.lastError.value).toBeInstanceOf(Error);
  });

  it('stops its timer when the component unmounts', async () => {
    let started = 0;
    const load = async (): Promise<void> => {
      started += 1;
    };

    const { wrapper } = harness(load, 100);
    await vi.waitFor(() => expect(started).toBe(1));

    wrapper.unmount();
    vi.advanceTimersByTime(1000);

    expect(started).toBe(1);
  });
});
