import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MentionPicker from '../../src/components/tickets/MentionPicker.vue';
import * as ticketNotesService from '../../src/services/ticket-notes.service';
import { mountWithPlugins } from '../helpers/mount';

const PEOPLE = [
  { id: 2, fullName: 'Sara', isActive: true },
  { id: 3, fullName: 'Omar', isActive: true },
  { id: 4, fullName: 'Layla', isActive: true },
];

beforeEach(() => {
  vi.spyOn(ticketNotesService, 'fetchMentionableUsers').mockResolvedValue({ items: PEOPLE });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function mountPicker(open = true) {
  const wrapper = mountWithPlugins(MentionPicker, {
    props: { ticketId: 42, query: '', open },
  });

  // The list is fetched in a watcher with `immediate`, so let it settle.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await wrapper.vm.$nextTick();

  return wrapper;
}

function key(name: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: name });
}

describe('MentionPicker offers only what the save would accept', () => {
  it('asks the server for users who can view THIS ticket', async () => {
    await mountPicker();

    // Not "all users": the endpoint filters to those who can open the ticket,
    // so the picker can never offer someone the note would then be refused for
    // (FR-036 with FR-037).
    expect(ticketNotesService.fetchMentionableUsers).toHaveBeenCalledWith(42, '');
  });

  it('renders nothing at all while closed', async () => {
    const wrapper = await mountPicker(false);

    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
  });

  it('says so when nothing matches, rather than rendering an empty box', async () => {
    vi.spyOn(ticketNotesService, 'fetchMentionableUsers').mockResolvedValue({ items: [] });

    const wrapper = await mountPicker();

    expect(wrapper.text()).toContain('No matching colleagues');
  });
});

/**
 * Keyboard operability is a requirement, not a nicety (FR-082). The picker is
 * driven entirely from the composer's keydown handler so that focus NEVER
 * leaves the textarea — an agent mid-sentence must not have the caret taken
 * away to navigate a list.
 */
describe('MentionPicker — keyboard navigation', () => {
  it('exposes the list as a listbox with a current option', async () => {
    const wrapper = await mountPicker();

    const listbox = wrapper.find('[role="listbox"]');

    expect(listbox.exists()).toBe(true);
    // aria-activedescendant, not real focus: the caret stays in the composer.
    expect(listbox.attributes('aria-activedescendant')).toBe('mention-option-2');
  });

  it('moves down and wraps around', async () => {
    const wrapper = await mountPicker();

    expect(wrapper.vm.handleKey(key('ArrowDown'))).toBe(true);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[role="listbox"]').attributes('aria-activedescendant')).toBe(
      'mention-option-3',
    );

    wrapper.vm.handleKey(key('ArrowDown'));
    wrapper.vm.handleKey(key('ArrowDown'));
    await wrapper.vm.$nextTick();

    // Back to the first, rather than sticking at the end.
    expect(wrapper.find('[role="listbox"]').attributes('aria-activedescendant')).toBe(
      'mention-option-2',
    );
  });

  it('moves up from the first option to the last', async () => {
    const wrapper = await mountPicker();

    wrapper.vm.handleKey(key('ArrowUp'));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="listbox"]').attributes('aria-activedescendant')).toBe(
      'mention-option-4',
    );
  });

  it('selects the current option with Enter', async () => {
    const wrapper = await mountPicker();

    wrapper.vm.handleKey(key('ArrowDown'));
    expect(wrapper.vm.handleKey(key('Enter'))).toBe(true);

    expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({ id: 3, fullName: 'Omar' });
  });

  it('dismisses with Escape', async () => {
    const wrapper = await mountPicker();

    expect(wrapper.vm.handleKey(key('Escape'))).toBe(true);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('lets ordinary typing through', async () => {
    const wrapper = await mountPicker();

    // Returning false is what tells the composer NOT to preventDefault, so the
    // character the agent typed still reaches the textarea.
    expect(wrapper.vm.handleKey(key('a'))).toBe(false);
  });

  it('handles no keys at all while closed', async () => {
    const wrapper = await mountPicker(false);

    expect(wrapper.vm.handleKey(key('ArrowDown'))).toBe(false);
    expect(wrapper.vm.handleKey(key('Enter'))).toBe(false);
  });

  it('marks exactly one option as selected', async () => {
    const wrapper = await mountPicker();

    const selected = wrapper
      .findAll('[role="option"]')
      .filter((option) => option.attributes('aria-selected') === 'true');

    expect(selected).toHaveLength(1);
  });
});
