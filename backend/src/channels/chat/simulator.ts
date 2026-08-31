import { conversationChannel, publishTo } from '../../lib/notification-hub.js';
import { CHANNELS } from '../../models/message.model.js';
import type { ChannelAdapter, OutboundMessage, SendResult } from '../types.js';

/**
 * Live chat. THERE IS NO THIRD PARTY — this system is the provider.
 *
 * The adapter exists anyway, and that is the point: chat enters intake through
 * the same door as every other channel and gets identity resolution, threading,
 * the ledger, and opt-out checking for free. A chat implementation that
 * bypassed the boundary would be a second intake path to keep in step, and the
 * first one to drift.
 *
 * `send` publishes to the stream hub rather than calling anything external. The
 * ordering rule Phase 4 established holds here and matters more than anywhere:
 * the message is a row before it is an event, so a visitor whose connection
 * dropped catches up rather than losing what an agent told them.
 */
export const chatAdapter: ChannelAdapter = {
  channel: CHANNELS.CHAT,
  provider: 'simulator',

  // Nothing to configure: there is no account to hold.
  isConfigured: () => true,

  async send(message: OutboundMessage): Promise<SendResult> {
    const sessionId = Number(message.providerConversationId);

    if (!Number.isInteger(sessionId) || sessionId < 1) {
      return Promise.resolve({
        providerMessageId: null,
        outboundMessageId: null,
        state: 'failed',
        detail: 'no_chat_session',
        // Nothing about a missing session improves on a retry.
        retryable: false,
      });
    }

    // A visitor who is not currently connected is the ordinary case, not an
    // error: the message is already stored and they will see it on reconnect.
    publishTo(conversationChannel(sessionId), {
      type: 'chat.message',
      direction: 'outbound',
      body: message.body,
      occurredAt: new Date().toISOString(),
    });

    return Promise.resolve({
      providerMessageId: `chat-${sessionId}-${Date.now()}`,
      outboundMessageId: null,
      // Delivered the moment it is published: there is no external system that
      // could later disagree, so anything more cautious would be false modesty.
      state: 'sent',
      detail: null,
      retryable: false,
    });
  },
};
