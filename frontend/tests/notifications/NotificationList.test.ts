import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteRecordRaw } from 'vue-router';

import NotificationList from '../../src/components/notifications/NotificationList.vue';
import type { NotificationView } from '../../src/services/notifications.service';
import * as notificationsService from '../../src/services/notifications.service';
import { useNotificationsStore } from '../../src/stores/notifications.store';
import { mountWithPlugins } from '../helpers/mount';

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: { template: '<div/>' } },
  { path: '/tickets/:id', name: 'ticket-detail', component: { template: '<div/>' } },
];

function notification(overrides: Partial<NotificationView> = {}): NotificationView {
  return {
    id: 1,
    type: 'ticket.assigned',
    actor: { id: 2, fullName: 'Sara' },
    ticket: { id: 42, reference: 'TKT-000042', subject: 'Cannot sign in' },
    task: null,
    noteId: null,
    readAt: null,
    createdAt: '2026-08-29T09:00:00.000Z',
    ...overrides,
  };
}

let pinia: ReturnType<typeof createPinia>;

beforeEach(() => {
  // Seeded before mounting, so the helper installs THIS instance rather than
  // making its own — otherwise the store the test fills and the store the
  // component reads are two different objects.
  pinia = createPinia();
  setActivePinia(pinia);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The server sends a TYPE and PARAMETERS, never a sentence. These tests are the
 * guard on that: if a `message` field ever starts arriving and being rendered,
 * the same row would read as English to an Arabic user, and Principle I would
 * be broken at the source.
 */
describe('NotificationList composes its text from locale keys', () => {
  it('renders every notification type in English', () => {
    const store = useNotificationsStore();

    store.items = [
      notification({ id: 1, type: 'ticket.assigned' }),
      notification({ id: 2, type: 'note.mentioned' }),
      notification({
        id: 3,
        type: 'task.reminder',
        actor: null,
        ticket: null,
        task: { id: 5, title: 'Call back' },
      }),
      notification({ id: 4, type: 'ticket.due_soon', actor: null }),
    ];

    const wrapper = mountWithPlugins(NotificationList, { routes, pinia });
    const text = wrapper.text();

    expect(text).toContain('Sara assigned you TKT-000042');
    expect(text).toContain('Sara mentioned you on TKT-000042');
    expect(text).toContain('Reminder: Call back');
    expect(text).toContain('TKT-000042 is due soon');
    // A raw key leaking through means a missing translation.
    expect(text).not.toContain('notification.type.');
  });

  it('renders every notification type in Arabic from the same rows', () => {
    const store = useNotificationsStore();

    store.items = [
      notification({ id: 1, type: 'ticket.assigned' }),
      notification({ id: 2, type: 'note.mentioned' }),
      notification({
        id: 3,
        type: 'task.reminder',
        actor: null,
        ticket: null,
        task: { id: 5, title: 'Call back' },
      }),
      notification({ id: 4, type: 'ticket.due_soon', actor: null }),
    ];

    const wrapper = mountWithPlugins(NotificationList, { routes, pinia, locale: 'ar' });
    const text = wrapper.text();

    expect(text).toContain('أسند إليك');
    expect(text).toContain('أشار إليك');
    expect(text).toContain('تذكير');
    expect(text).not.toContain('notification.type.');
  });
});

describe('NotificationList — unread state', () => {
  it('marks unread with a word, not only a background tint (FR-084)', () => {
    const store = useNotificationsStore();
    store.items = [notification({ readAt: null })];

    const wrapper = mountWithPlugins(NotificationList, { routes, pinia });

    expect(wrapper.text()).toContain('New');
  });

  it('does not mark a read notification', () => {
    const store = useNotificationsStore();
    store.items = [notification({ readAt: '2026-08-29T10:00:00.000Z' })];

    const wrapper = mountWithPlugins(NotificationList, { routes, pinia });

    expect(wrapper.text()).not.toContain('New');
  });

  it('offers "mark all read" only while something is unread', () => {
    const store = useNotificationsStore();
    store.items = [notification()];
    store.unreadCount = 0;

    const none = mountWithPlugins(NotificationList, { routes, pinia });
    expect(none.text()).not.toContain('Mark all read');

    store.unreadCount = 2;
    const some = mountWithPlugins(NotificationList, { routes, pinia });
    expect(some.text()).toContain('Mark all read');
  });

  it('marks a notification read when it is opened', async () => {
    const store = useNotificationsStore();
    store.items = [notification({ id: 9, readAt: null })];

    vi.spyOn(notificationsService, 'markRead').mockResolvedValue(
      notification({ id: 9, readAt: '2026-08-29T10:00:00.000Z' }),
    );

    const wrapper = mountWithPlugins(NotificationList, { routes, pinia });
    await wrapper.findAll('button').find((b) => b.text().includes('Sara'))!.trigger('click');

    expect(notificationsService.markRead).toHaveBeenCalledWith(9);
  });
});

/**
 * THE MOST DELICATE REQUIREMENT IN THIS PHASE (FR-083).
 *
 * An arriving notification must be announced without stealing focus: an agent
 * halfway through typing a note is not to be interrupted by a ping. The two
 * ways to get this wrong are `aria-live="assertive"` and calling `.focus()`,
 * and both are easy to introduce while "improving" this component.
 */
describe('NotificationList — arrivals are announced politely', () => {
  it('uses a polite live region, never assertive', () => {
    const wrapper = mountWithPlugins(NotificationList, { routes, pinia });

    const live = wrapper.find('[aria-live]');

    expect(live.exists()).toBe(true);
    expect(live.attributes('aria-live')).toBe('polite');
  });

  it('announces the newest arrival through that region', async () => {
    const store = useNotificationsStore();
    const wrapper = mountWithPlugins(NotificationList, { routes, pinia });

    store.receive(notification({ id: 11 }));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[aria-live]').text()).toContain('Sara assigned you TKT-000042');
  });

  it('keeps the announcement out of the visual flow', () => {
    // Screen-reader-only: the notification is already visible in the list, so
    // announcing it again on screen would be duplicate noise.
    const wrapper = mountWithPlugins(NotificationList, { routes, pinia });

    expect(wrapper.find('[aria-live]').classes()).toContain('sr-only');
  });
});

describe('NotificationList — empty state', () => {
  it('says there is nothing new rather than rendering a blank panel', () => {
    const wrapper = mountWithPlugins(NotificationList, { routes, pinia });

    expect(wrapper.text()).toContain('Nothing new');
  });
});
