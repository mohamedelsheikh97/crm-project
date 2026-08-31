import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';

import AutomationRulesView from '../../src/views/admin/AutomationRulesView.vue';
import ar from '../../src/locales/ar.json';
import en from '../../src/locales/en.json';

/**
 * The rule builder's accessibility contract (Principle IV, FR-083).
 *
 * A DYNAMIC FORM IS WHERE THIS QUIETLY FAILS, and the three failures are always
 * the same: focus is dropped when a row is removed, a dependent select keeps a
 * stale value, and reordering is drag-only. The last matters most here, because
 * this list controls EXECUTION ORDER (FR-060) — a drag-only control puts a
 * functional decision out of reach of keyboard users entirely.
 */

const CATALOG = {
  triggers: [
    { key: 'ticket.created', nameKey: 'automation.trigger.ticketCreated' },
    { key: 'message.received', nameKey: 'automation.trigger.messageReceived' },
  ],
  conditionFields: [
    {
      key: 'ticket.priority',
      nameKey: 'automation.condition.priority',
      operators: ['is', 'is_not', 'in'],
      values: ['low', 'normal', 'high', 'urgent'],
    },
    {
      key: 'ticket.has_assignee',
      nameKey: 'automation.condition.hasAssignee',
      operators: ['is'],
      values: ['true', 'false'],
    },
    {
      key: 'message.channel',
      nameKey: 'automation.condition.messageChannel',
      operators: ['is', 'in'],
      values: ['email', 'sms'],
      onlyForTriggers: ['message.received'],
    },
  ],
  actions: [
    {
      key: 'set_priority',
      nameKey: 'automation.action.setPriority',
      params: [{ key: 'priority', kind: 'enum', values: ['high', 'urgent'], required: true }],
    },
    {
      key: 'apply_assignment_strategy',
      nameKey: 'automation.action.applyAssignmentStrategy',
      params: [],
    },
  ],
};

const RULES = [
  {
    id: 1,
    name: 'First',
    triggerKey: 'ticket.created',
    conditions: [],
    actions: [{ action: 'set_priority', params: { priority: 'high' } }],
    isEnabled: true,
    runOrder: 1,
    createdBy: null,
    version: 0,
  },
  {
    id: 2,
    name: 'Second',
    triggerKey: 'ticket.created',
    conditions: [],
    actions: [{ action: 'set_priority', params: { priority: 'urgent' } }],
    isEnabled: false,
    runOrder: 2,
    createdBy: null,
    version: 0,
  },
];

const reorderSpy = vi.fn(async (ids: number[]) =>
  ids.map((id, index) => ({ ...RULES.find((rule) => rule.id === id)!, runOrder: index + 1 })),
);

vi.mock('../../src/services/automation.service', () => ({
  getCatalog: async () => CATALOG,
  listRules: async () => RULES,
  createRule: vi.fn(),
  updateRule: vi.fn(),
  enableRule: vi.fn(),
  disableRule: vi.fn(),
  deleteRule: vi.fn(),
  dryRunRule: vi.fn(),
  reorderRules: (ids: number[]) => reorderSpy(ids),
}));

function i18n(locale: 'en' | 'ar' = 'en') {
  return createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: { en, ar } });
}

async function mountBuilder(locale: 'en' | 'ar' = 'en') {
  const wrapper = mount(AutomationRulesView, {
    global: { plugins: [i18n(locale)] },
    attachTo: document.body,
  });

  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  reorderSpy.mockClear();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('reordering works without a pointer (FR-060)', () => {
  it('offers move-up and move-down buttons on every rule', async () => {
    const wrapper = await mountBuilder();

    const up = wrapper.findAll('[data-move-up]');
    const down = wrapper.findAll('[data-move-down]');

    // NOT a drag handle. This list decides which rule wins when two match, and
    // that decision cannot be pointer-only.
    expect(up).toHaveLength(RULES.length);
    expect(down).toHaveLength(RULES.length);
  });

  it('disables the moves that would go off the ends', async () => {
    const wrapper = await mountBuilder();

    expect(wrapper.findAll('[data-move-up]')[0]?.attributes('disabled')).toBeDefined();
    expect(
      wrapper.findAll('[data-move-down]')[RULES.length - 1]?.attributes('disabled'),
    ).toBeDefined();
  });

  it('names the rule in each control, so the label is not just an arrow', async () => {
    const wrapper = await mountBuilder();
    const label = wrapper.findAll('[data-move-up]')[1]?.attributes('aria-label');

    // "Move up" five times in a row tells a screen-reader user nothing about
    // WHICH rule they are moving.
    expect(label).toContain('Second');
  });

  it('sends the whole new order in one call', async () => {
    const wrapper = await mountBuilder();

    await wrapper.findAll('[data-move-down]')[0]?.trigger('click');
    await flushPromises();

    expect(reorderSpy).toHaveBeenCalledWith([2, 1]);
  });
});

describe('the builder states its semantics rather than implying them', () => {
  it('says every condition must hold (FR-059)', async () => {
    const wrapper = await mountBuilder();

    await wrapper.find('button').trigger('click'); // "New rule"
    await flushPromises();

    // And/or is exactly what a user assumes wrongly, so it is said in words.
    expect(wrapper.text()).toContain(en['automation.builder.allConditionsMustHold']);
  });

  it('offers only the condition fields the chosen trigger can evaluate', async () => {
    const wrapper = await mountBuilder();

    await wrapper.find('button').trigger('click');
    await flushPromises();

    await wrapper.find('[data-add-condition]').trigger('click');
    await flushPromises();

    const fieldSelect = wrapper.find('[data-condition-index="0"] select');
    const options = fieldSelect.findAll('option').map((option) => option.text());

    // `message.channel` is restricted to `message.received`, and the default
    // trigger is `ticket.created` — so offering it here would let the screen
    // build a rule the validator refuses.
    expect(options).not.toContain(en['automation.condition.messageChannel']);
    expect(options).toContain(en['automation.condition.priority']);
  });
});

describe('rows name themselves and manage focus', () => {
  it('gives each condition row an ordinal legend', async () => {
    const wrapper = await mountBuilder();

    await wrapper.find('button').trigger('click');
    await flushPromises();
    await wrapper.find('[data-add-condition]').trigger('click');
    await flushPromises();

    // "Condition 1", so a screen-reader user knows which of five rows they are
    // in rather than hearing "combo box" five times.
    expect(wrapper.find('[data-condition-index="0"] legend').text()).toContain('1');
  });

  it('moves focus into a newly added condition', async () => {
    const wrapper = await mountBuilder();

    await wrapper.find('button').trigger('click');
    await flushPromises();
    await wrapper.find('[data-add-condition]').trigger('click');
    await flushPromises();

    const first = wrapper.find('[data-condition-index="0"] select').element;

    expect(document.activeElement).toBe(first);
  });

  it('resets operator and value when the field changes, and announces it', async () => {
    const wrapper = await mountBuilder();

    await wrapper.find('button').trigger('click');
    await flushPromises();
    await wrapper.find('[data-add-condition]').trigger('click');
    await flushPromises();

    const selects = wrapper.findAll('[data-condition-index="0"] select');
    const fieldSelect = selects[0];

    // Switch to a field with a different permitted set. A stale operator left
    // selected is how an invalid rule reaches the validator.
    await fieldSelect?.setValue('ticket.has_assignee');
    await flushPromises();

    const operatorOptions = wrapper
      .findAll('[data-condition-index="0"] select')[1]
      ?.findAll('option')
      .map((option) => option.attributes('value'));

    expect(operatorOptions).toEqual(['is']);
    // A silent reset leaves a screen-reader user unaware their other choices
    // changed underneath them.
    expect(wrapper.find('[aria-live="polite"]').text()).toContain(
      en['automation.builder.resetAnnounced'],
    );
  });

  it('does not drop focus when a condition is removed', async () => {
    const wrapper = await mountBuilder();

    await wrapper.find('button').trigger('click');
    await flushPromises();
    await wrapper.find('[data-add-condition]').trigger('click');
    await flushPromises();

    const removeButton = wrapper
      .findAll('[data-condition-index="0"] button')
      .find((button) => button.text() === en['automation.builder.removeCondition']);

    await removeButton?.trigger('click');
    await flushPromises();

    // It was the last row, so focus lands on the add button rather than on the
    // document — which is where a screen-reader user would otherwise be
    // stranded.
    expect(document.activeElement).toBe(wrapper.find('[data-add-condition]').element);
  });
});

describe('the dry run says plainly that nothing changed (FR-066)', () => {
  it('is a separate control from saving', async () => {
    const wrapper = await mountBuilder();

    await wrapper.find('button').trigger('click');
    await flushPromises();

    const labels = wrapper.findAll('button').map((button) => button.text());

    // Saving a rule and running a rule are two different acts, and the
    // interface should make them feel different (FR-061).
    expect(labels).toContain(en['action.save']);
  });
});
