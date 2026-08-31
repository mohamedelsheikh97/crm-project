import { CHANNELS } from '../../models/message.model.js';
import type { ChannelAdapter, InboundMessage, OutboundMessage, SendResult } from '../types.js';

/**
 * Web forms. INBOUND ONLY — a form has no reply path of its own (FR-003).
 *
 * `send` exists because the interface declares it, and it refuses. The refusal
 * is better than omitting the method: a caller trying to reply "on the form
 * channel" has a bug, and a named failure points at it, where a missing method
 * would produce a TypeError three frames away from the cause.
 */

/**
 * Builds the message body from the answers TOGETHER WITH THE LABEL TEXT AS IT
 * WAS ASKED (FR-085).
 *
 * This is what makes form versioning unnecessary. The ticket carries its own
 * copy of the questions, so editing a definition later cannot change what a
 * customer appears to have been asked, and no read of an old ticket needs to
 * join back to a definition that may since have changed shape.
 */
export function renderSubmission(answers: Array<{ label: string; value: string }>): string {
  return answers.map((answer) => `${answer.label}\n${answer.value}`).join('\n\n');
}

export interface FormSubmissionInput {
  submissionId: string;
  senderIdentity: string;
  formTitle: string;
  answers: Array<{ label: string; value: string }>;
  occurredAt?: Date;
}

export function buildInboundSubmission(input: FormSubmissionInput): InboundMessage {
  return {
    channel: CHANNELS.FORM,
    providerMessageId: input.submissionId,
    senderIdentity: input.senderIdentity,
    recipientIdentity: null,
    subject: input.formTitle,
    body: renderSubmission(input.answers),
    bodyFormat: 'text',
    attachments: [],
    occurredAt: input.occurredAt ?? new Date(),
    // Every submission starts a ticket: a form has no conversation to continue.
    threadHints: {
      inReplyTo: null,
      references: [],
      addressToken: null,
      providerConversationId: null,
    },
    isAutomated: false,
    isOptOut: false,
  };
}

export const formAdapter: ChannelAdapter = {
  channel: CHANNELS.FORM,
  provider: 'inbound',

  isConfigured: () => true,

  async send(_message: OutboundMessage): Promise<SendResult> {
    return Promise.resolve({
      providerMessageId: null,
      outboundMessageId: null,
      state: 'failed',
      detail: 'form_channel_is_inbound_only',
      retryable: false,
    });
  },
};
