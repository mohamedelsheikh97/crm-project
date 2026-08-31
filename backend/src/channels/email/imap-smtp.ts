import { createHmac, timingSafeEqual } from 'node:crypto';

import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import nodemailer, { type Transporter } from 'nodemailer';

import { env } from '../../config/env.js';
import { CHANNELS } from '../../models/message.model.js';
import type {
  ChannelAdapter,
  InboundAttachment,
  InboundHandler,
  InboundMessage,
  OutboundMessage,
  SendResult,
} from '../types.js';

/**
 * Real mail: IMAP in, SMTP out.
 *
 * The three dependencies this phase adds all land here (research.md D3). MIME
 * is a standardised format with a decades-deep tail of real-world
 * malformation — nested multiparts, transfer encodings, character sets, and
 * mail that simply breaks the rules. Hand-rolling a parser for untrusted input
 * would mean silently mangling customer messages, which FR-009 forbids.
 *
 * The COLLECTION LOOP is not here. It lives in `lib/mail-poller.ts`, started
 * from server.ts, because a connection opened at import time would attach
 * itself to every test that imports the app — the mistake Phase 4 avoided by
 * starting the scheduler outside `app.ts`.
 */

let transporter: Transporter | null = null;

function smtp(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: env.MAIL_SMTP_HOST,
    port: env.MAIL_SMTP_PORT,
    // Implicit TLS on 465, STARTTLS elsewhere. Never plaintext.
    secure: env.MAIL_SMTP_PORT === 465,
    auth: { user: env.MAIL_SMTP_USER, pass: env.MAIL_SMTP_PASSWORD },
  });

  return transporter;
}

/**
 * The `support+<token>@` reply address (research.md D4).
 *
 * SIGNED, because it is the threading fallback for clients that strip
 * References — and an unsigned token would let anyone attach their mail to
 * someone else's ticket by guessing a number.
 */
export function signAddressToken(ticketId: number): string {
  const secret = env.CHANNEL_ADDRESS_TOKEN_SECRET ?? '';
  const signature = createHmac('sha256', secret).update(String(ticketId)).digest('hex').slice(0, 16);

  return `${ticketId}.${signature}`;
}

export function verifyAddressToken(token: string): number | null {
  const [rawId, signature] = token.split('.');
  const ticketId = Number(rawId);

  if (!Number.isInteger(ticketId) || ticketId < 1 || !signature) return null;

  const expected = signAddressToken(ticketId).split('.')[1] ?? '';

  // Constant-time: a token check that returns early leaks the prefix.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);

  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return ticketId;
}

function addressOf(field: AddressObject | AddressObject[] | undefined): string | null {
  const first = Array.isArray(field) ? field[0] : field;
  return first?.value?.[0]?.address ?? null;
}

/**
 * Automated mail, by header (research.md D12, FR-029).
 *
 * Headers rather than subject text, deliberately: "Out of Office" and
 * "Automatic reply" are language-dependent, and this project is bilingual by
 * constitution. RFC 3834 exists precisely so this does not have to be guessed.
 */
function detectAutomated(parsed: ParsedMail): boolean {
  const header = (name: string): string =>
    String(parsed.headers.get(name) ?? '')
      .toLowerCase()
      .trim();

  const autoSubmitted = header('auto-submitted');
  if (autoSubmitted && autoSubmitted !== 'no') return true;

  const precedence = header('precedence');
  if (['bulk', 'list', 'junk'].includes(precedence)) return true;

  if (parsed.headers.has('x-auto-response-suppress')) return true;

  // A NULL return path — literally `<>` — is how a bounce identifies itself.
  //
  // ABSENT IS NOT EMPTY, and conflating them classified every ordinary message
  // as automated: most mail arriving over IMAP has no Return-Path at all,
  // because the header is added by the receiving MTA and is frequently stripped
  // before the message reaches a mailbox. `has()` before reading is the
  // difference between "the sender said this is a bounce" and "nobody said
  // anything".
  if (parsed.headers.has('return-path')) {
    const raw = parsed.headers.get('return-path');

    // `mailparser` parses Return-Path as an ADDRESS, not a string, so `<>`
    // arrives as an address object with no address in it rather than as the
    // two characters. Both shapes are handled because which one you get
    // depends on whether the header parsed cleanly.
    const asAddress = raw as { value?: Array<{ address?: string }> } | undefined;

    if (Array.isArray(asAddress?.value)) {
      const address = asAddress.value[0]?.address ?? '';
      if (address.trim() === '') return true;
    } else {
      const returnPath = header('return-path');
      if (returnPath === '<>' || returnPath === '') return true;
    }
  }

  return false;
}

/**
 * Strip HTML to readable text (FR-034, FR-008).
 *
 * `mailparser` gives us `text` for almost everything; this is the fallback for
 * HTML-only mail. Scripts and styles are removed CONTENT AND ALL rather than
 * just having their tags dropped, or an agent would read a stylesheet.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function toInboundMessage(raw: Buffer): Promise<InboundMessage> {
  const parsed = await simpleParser(raw);

  const references = parsed.references
    ? Array.isArray(parsed.references)
      ? parsed.references
      : [parsed.references]
    : [];

  const recipient = addressOf(parsed.to);

  // support+<token>@example.com — the local part after the plus.
  const addressToken = recipient?.includes('+')
    ? (recipient.split('@')[0]?.split('+')[1] ?? null)
    : null;

  const attachments: InboundAttachment[] = parsed.attachments.map((attachment) => ({
    fileName: attachment.filename ?? 'attachment',
    content: attachment.content,
    declaredContentType: attachment.contentType ?? null,
    // FR-036: an image the body references by Content-ID is not a document the
    // customer chose to send.
    isInline: attachment.contentDisposition === 'inline' || Boolean(attachment.cid),
  }));

  const hasHtmlOnly = !parsed.text && typeof parsed.html === 'string';

  return {
    channel: CHANNELS.EMAIL,
    // A message with no Message-ID cannot be deduplicated by one, so it gets a
    // content-derived identifier rather than a random one — a redelivery of the
    // same bytes must still collide in the ledger.
    providerMessageId:
      parsed.messageId ??
      `sha-${createHmac('sha256', 'intake').update(raw).digest('hex').slice(0, 40)}`,
    senderIdentity: addressOf(parsed.from) ?? '',
    recipientIdentity: recipient,
    subject: parsed.subject ?? null,
    body: parsed.text ?? (hasHtmlOnly ? htmlToText(parsed.html as string) : ''),
    bodyFormat: hasHtmlOnly ? 'html_source' : 'text',
    attachments,
    occurredAt: parsed.date ?? new Date(),
    threadHints: {
      inReplyTo: parsed.inReplyTo ?? null,
      references,
      addressToken,
      providerConversationId: null,
    },
    isAutomated: detectAutomated(parsed),
    isOptOut: false,
  };
}

export const emailImapSmtpAdapter: ChannelAdapter = {
  channel: CHANNELS.EMAIL,
  provider: 'imap-smtp',

  isConfigured: () =>
    Boolean(
      env.MAIL_IMAP_HOST && env.MAIL_IMAP_USER && env.MAIL_SMTP_HOST && env.MAIL_FROM_ADDRESS,
    ),

  async send(message: OutboundMessage): Promise<SendResult> {
    try {
      const from = message.replyToToken
        ? // The reply address the customer will answer to, carrying the signed
          // threading token (FR-040).
          `${env.MAIL_FROM_ADDRESS?.split('@')[0]}+${message.replyToToken}@${env.MAIL_FROM_ADDRESS?.split('@')[1]}`
        : env.MAIL_FROM_ADDRESS;

      const info = await smtp().sendMail({
        from,
        replyTo: from,
        to: message.recipientIdentity,
        subject: message.subject ?? '(no subject)',
        text: message.body,
      });

      return {
        providerMessageId: info.messageId ?? null,
        // What an inbound reply's In-Reply-To will be matched against.
        outboundMessageId: info.messageId ?? null,
        state: 'sent',
        detail: null,
        retryable: false,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);

      // 5xx is a permanent refusal; anything else is worth retrying. Only the
      // adapter can make this call — the service cannot tell a full mailbox
      // from a malformed address by reading a string (FR-049).
      const permanent = /\b5\d\d\b/.test(detail);

      return {
        providerMessageId: null,
        outboundMessageId: null,
        state: 'failed',
        detail: detail.slice(0, 500),
        retryable: !permanent,
      };
    }
  },

  // start/stop are absent on purpose: collection is lib/mail-poller.ts, which
  // owns the connection and the resume position.
  start: undefined,
  stop: undefined,
};

export type { InboundHandler };
