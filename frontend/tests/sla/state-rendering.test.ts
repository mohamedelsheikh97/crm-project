import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';

import SlaCountdown from '../../src/components/sla/SlaCountdown.vue';
import SlaState from '../../src/components/sla/SlaState.vue';
import en from '../../src/locales/en.json';
import ar from '../../src/locales/ar.json';
import type { SlaTargetState, SlaTargetView } from '../../src/services/sla.service';

/**
 * FR-085 and FR-084, as assertions rather than review items.
 *
 * The way these requirements fail is mundane and invisible in code review:
 * somebody renders the state as a coloured dot, and it disappears for every
 * colourblind user and in every printout. Or somebody writes
 * `${count} ${unit}` and the Arabic reads backwards. Both pass a screenshot
 * review by a sighted English speaker.
 */

function i18n(locale: 'en' | 'ar' = 'en') {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'en',
    messages: { en, ar },
  });
}

const STATES: SlaTargetState[] = ['met', 'on_track', 'at_risk', 'breached'];

describe('SLA state is identifiable without colour (FR-085)', () => {
  it.each(STATES)('renders %s with a distinct icon and its own text', (state) => {
    const wrapper = mount(SlaState, {
      props: { state },
      global: { plugins: [i18n()] },
    });

    // The icon is exposed as data so this assertion does not depend on an icon
    // font being available in happy-dom.
    const icon = wrapper.attributes('data-sla-icon');
    const text = wrapper.text();

    expect(icon).toBeTruthy();
    expect(text.trim()).not.toBe('');
  });

  it('gives each state a DIFFERENT icon and a DIFFERENT label', () => {
    // The real greyscale property: stripped of colour, no two states may look
    // or read the same. Distinct-but-present is not enough — two states sharing
    // a clock icon and differing only in hue would pass the test above.
    const icons = new Set<string>();
    const labels = new Set<string>();

    for (const state of STATES) {
      const wrapper = mount(SlaState, { props: { state }, global: { plugins: [i18n()] } });

      icons.add(wrapper.attributes('data-sla-icon') ?? '');
      labels.add(wrapper.text().trim());
    }

    expect(icons.size).toBe(STATES.length);
    expect(labels.size).toBe(STATES.length);
  });

  it('renders NOTHING for a ticket with no SLA', () => {
    // FR-014 at the interface: a ticket nobody made a commitment about is not
    // annotated with the absence of one in every row of the queue.
    const wrapper = mount(SlaState, { props: { state: null }, global: { plugins: [i18n()] } });

    expect(wrapper.text().trim()).toBe('');
  });

  it('puts the target time in the accessible name, not only a tooltip', () => {
    const wrapper = mount(SlaState, {
      props: { state: 'at_risk', targetAt: '2026-09-01T09:00:00.000Z' },
      global: { plugins: [i18n()] },
    });

    // A screen-reader user must not have to hover to learn when it is due.
    expect(wrapper.attributes('aria-label')).toBeTruthy();
    expect(wrapper.attributes('aria-label')?.length).toBeGreaterThan(wrapper.text().trim().length);
  });
});

describe('durations are composed, never concatenated (FR-084)', () => {
  const target = (overrides: Partial<SlaTargetView> = {}): SlaTargetView => ({
    targetAt: '2026-09-01T09:00:00.000Z',
    state: 'on_track',
    remainingMinutes: 45,
    satisfiedAt: null,
    ...overrides,
  });

  it('renders a remaining duration in English', () => {
    const wrapper = mount(SlaCountdown, {
      props: { target: target() },
      global: { plugins: [i18n('en')] },
    });

    expect(wrapper.text()).toContain('45');
    // No raw key leaked through: a missing message renders its key, which is
    // the failure mode this catches.
    expect(wrapper.text()).not.toContain('sla.');
  });

  it('renders the same duration in Arabic without leaking a key', () => {
    const wrapper = mount(SlaCountdown, {
      props: { target: target() },
      global: { plugins: [i18n('ar')] },
    });

    const text = wrapper.text();

    expect(text.trim()).not.toBe('');
    expect(text).not.toContain('sla.');
    // The number is bidi-ISOLATED so it cannot reorder the Arabic around it —
    // the difference between "متبقٍ ٤٥ دقيقة" and a sentence that reads
    // backwards.
    expect(text).toContain('⁨');
    expect(text).toContain('⁩');
  });

  it('renders "overdue by" rather than a negative number when breached', () => {
    const wrapper = mount(SlaCountdown, {
      props: {
        target: target({
          state: 'breached',
          remainingMinutes: null,
          targetAt: new Date(Date.now() - 90 * 60_000).toISOString(),
        }),
      },
      global: { plugins: [i18n('en')] },
    });

    // "-90 minutes left" is arithmetic, not language.
    expect(wrapper.text()).not.toContain('-');
    expect(wrapper.text().toLowerCase()).toContain('overdue');
  });
});

describe('a paused ticket does not appear to be burning its clock', () => {
  it('shows the captured remainder with a pause affordance, and does not tick', async () => {
    const wrapper = mount(SlaCountdown, {
      props: {
        target: {
          targetAt: '2026-09-01T09:00:00.000Z',
          state: 'on_track',
          remainingMinutes: 45,
          satisfiedAt: null,
        },
        paused: true,
      },
      global: { plugins: [i18n('en')] },
    });

    expect(wrapper.attributes('data-sla-paused')).toBe('true');

    const before = wrapper.text();

    // There is NO local ticker — the state is the server's (FR-011), and a
    // client-side countdown would drift into disagreeing with the sweep.
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(wrapper.text()).toBe(before);
  });
});
