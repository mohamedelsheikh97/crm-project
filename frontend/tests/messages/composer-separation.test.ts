import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import MessageThread from '../../src/components/messages/MessageThread.vue';
import ReplyComposer from '../../src/components/messages/ReplyComposer.vue';
import TicketNoteComposer from '../../src/components/tickets/TicketNoteComposer.vue';
import type { ComposerContext, TicketMessage } from '../../src/services/messages.service';
import { mountWithPlugins } from '../helpers/mount';

/**
 * SC-006 — an internal note is never delivered to a customer, and no reply is
 * ever sent that the agent believed was a note.
 *
 * This is the single most dangerous surface in Phase 5: two composers on one
 * screen, one of which speaks to a customer in the organisation's name. The
 * tests below check the separation is STRUCTURAL rather than cosmetic.
 */

function context(overrides: Partial<ComposerContext> = {}): ComposerContext {
  return {
    conversation: {
      channel: 'email',
      recipientIdentity: 'hala@example.com',
      providerConversationId: null,
    },
    optOut: null,
    window: null,
    ...overrides,
  };
}

function message(overrides: Partial<TicketMessage> = {}): TicketMessage {
  return {
    id: 1,
    channel: 'email',
    direction: 'inbound',
    author: null,
    senderIdentity: 'hala@example.com',
    body: 'The card reader keeps rebooting.',
    bodyFormat: 'text',
    attachments: [],
    deliveryState: 'delivered',
    deliveryDetail: null,
    occurredAt: '2026-08-30T09:00:00.000Z',
    ...overrides,
  };
}

describe('the two composers are separate components (FR-044)', () => {
  it('are genuinely different components, not one with a flag', () => {
    // If these were ever unified behind an `isInternal` prop, a wrong default
    // would send a colleague's private note to a customer. Two components make
    // that unwritable rather than merely unlikely.
    expect(ReplyComposer).not.toBe(TicketNoteComposer);
  });

  it('the reply composer never imports the note service, and vice versa', () => {
    // Read as SOURCE rather than mounted, because the point is what each file
    // is allowed to reach — a runtime assertion would pass even if the import
    // existed but happened not to fire.
    // Resolved from the working directory rather than `import.meta.url`: the
    // happy-dom environment does not give this module a file: URL.
    const reply = readFileSync(
      resolve('frontend/src/components/messages/ReplyComposer.vue'),
      'utf8',
    );

    const note = readFileSync(
      resolve('frontend/src/components/tickets/TicketNoteComposer.vue'),
      'utf8',
    );

    expect(reply).not.toContain('ticket-notes.service');
    expect(note).not.toContain('messages.service');
  });

  it('names the ACT on its submit control, never a bare "Send"', () => {
    // Read aloud in either language, "Send to customer" and "Save internal
    // note" cannot be confused. "Send" and "Save" can.
    const wrapper = mountWithPlugins(ReplyComposer, {
      props: { context: context(), sending: false },
    });

    expect(wrapper.find('button').text()).toBe('Send to customer');
  });

  it('states who the reply goes to and on which channel, permanently', () => {
    const wrapper = mountWithPlugins(ReplyComposer, {
      props: { context: context(), sending: false },
    });

    // An agent should never have to remember which of the two boxes they are in.
    expect(wrapper.text()).toContain('hala@example.com');
    expect(wrapper.text()).toContain('Email');
  });

  it('warns that the message leaves the organisation', () => {
    const wrapper = mountWithPlugins(ReplyComposer, {
      props: { context: context(), sending: false },
    });

    expect(wrapper.text()).toContain('leaves the organisation');
  });
});

describe('refusals are shown before the agent types (FR-051, FR-057)', () => {
  it('disables the box and explains when the recipient has opted out', () => {
    const wrapper = mountWithPlugins(ReplyComposer, {
      props: {
        context: context({
          optOut: { channel: 'sms', optedOutAt: '2026-08-01T09:00:00.000Z', source: 'keyword' },
        }),
        sending: false,
      },
    });

    expect(wrapper.find('textarea').attributes('disabled')).toBeDefined();
    // Announced, not merely displayed: a screen-reader user must learn the box
    // is unusable before typing into it.
    expect(wrapper.find('[role="status"]').exists()).toBe(true);
  });

  it('disables free-form and offers templates when the channel window is closed', () => {
    const wrapper = mountWithPlugins(ReplyComposer, {
      props: {
        context: context({
          window: {
            freeformAllowed: false,
            reopensAt: null,
            allowedTemplates: ['support_followup'],
          },
        }),
        sending: false,
      },
    });

    expect(wrapper.find('textarea').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('support_followup');
  });

  it('disables the box when there is no conversation to reply to', () => {
    const wrapper = mountWithPlugins(ReplyComposer, {
      props: { context: context({ conversation: null }), sending: false },
    });

    expect(wrapper.find('textarea').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('no conversation');
  });
});

describe('the thread conveys state without colour (FR-002, FR-110)', () => {
  it('labels direction and channel as words', () => {
    const wrapper = mountWithPlugins(MessageThread, {
      props: { messages: [message()], loading: false },
    });

    expect(wrapper.text()).toContain('From the customer');
    expect(wrapper.text()).toContain('Email');
  });

  it('labels delivery state as a word, on outbound messages', () => {
    const wrapper = mountWithPlugins(MessageThread, {
      props: {
        messages: [
          message({
            direction: 'outbound',
            deliveryState: 'failed',
            deliveryDetail: 'mailbox_full',
            author: { id: 1, fullName: 'Sara' },
          }),
        ],
        loading: false,
      },
    });

    expect(wrapper.text()).toContain('Not delivered');
    // The cause, where the agent who sent it will see it (FR-048).
    expect(wrapper.text()).toContain('mailbox_full');
  });

  it('renders an HTML-sourced body as TEXT, never as markup (FR-008)', () => {
    const wrapper = mountWithPlugins(MessageThread, {
      props: {
        messages: [
          message({ body: '<script>alert(1)</script> hello', bodyFormat: 'html_source' }),
        ],
        loading: false,
      },
    });

    // Interpolated, so the markup is visible as characters and inert.
    expect(wrapper.html()).not.toContain('<script>alert(1)</script>');
    expect(wrapper.text()).toContain('alert(1)');
  });

  it('explains an empty thread rather than leaving a blank area', () => {
    const wrapper = mountWithPlugins(MessageThread, {
      props: { messages: [], loading: false },
    });

    expect(wrapper.text()).toContain('No correspondence');
  });
});
