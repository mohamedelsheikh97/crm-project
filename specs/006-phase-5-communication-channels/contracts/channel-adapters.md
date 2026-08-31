# Contract: Channel Adapters

**Feature**: `006-phase-5-communication-channels` | **Date**: 2026-08-30

The boundary that keeps five vendor integrations out of the service layer (research D1, FR-004,
FR-112). Everything a provider knows lives behind this interface; everything above it — intake,
identity, threading, the timeline, the reply surface — is written against the normalised shapes
declared here and never against a vendor payload.

## The interface

```ts
export interface InboundMessage {
  channel: Channel;
  providerMessageId: string;      // idempotency key (FR-007)
  senderIdentity: string;         // address or number, as received
  recipientIdentity: string | null;
  subject: string | null;         // email only; NEVER used for threading (FR-023)
  body: string;
  bodyFormat: 'text' | 'html_source';
  attachments: InboundAttachment[];
  occurredAt: Date;               // per the channel, not per this system (FR-092)
  threadHints: ThreadHints;       // see below
  isAutomated: boolean;           // research D12
}

export interface ThreadHints {
  inReplyTo: string | null;       // email In-Reply-To
  references: string[];           // email References, oldest first
  addressToken: string | null;    // signed token from support+<token>@…
  providerConversationId: string | null; // WhatsApp/SMS/chat continuity
}

export interface SendResult {
  providerMessageId: string | null;
  outboundMessageId: string | null;  // the Message-ID we generated, email only
  state: 'sent' | 'failed';
  detail: string | null;             // shown to the sending agent (FR-048)
  retryable: boolean;                // drives FR-049
}

export interface ChannelAdapter {
  readonly channel: Channel;
  readonly provider: string;

  isConfigured(): boolean;
  send(message: OutboundMessage): Promise<SendResult>;
  replyWindow?(identity: string): Promise<ReplyWindow>;  // WhatsApp only
  start?(onInbound: (m: InboundMessage) => Promise<void>): Promise<void>;  // pollers
  stop?(): Promise<void>;
  verifyWebhook?(rawBody: Buffer, headers: Headers): boolean;
  parseWebhook?(rawBody: Buffer): InboundMessage[];
}
```

**`isAutomated` is decided by the adapter, not above it.** Only the adapter can see the headers or
provider flags that reveal an auto-responder (research D12), and forcing that judgement upward would
mean leaking raw headers through the boundary — which is exactly what the boundary exists to prevent.

**`retryable` is the adapter's judgement too.** Only it knows whether a provider's refusal is
transient. FR-049 forbids retrying a permanent refusal, and the service layer cannot tell the
difference from a message string.

**Optional members are the honest shape.** Not every channel polls, has a webhook, or has a reply
window. An interface that required all of them would force four empty implementations per adapter and
teach nothing about what each channel actually does.

## Selection and refusal

`CHANNEL_<NAME>_PROVIDER` selects the adapter; `simulator` is the default for every channel. At
startup, `channels/registry.ts` resolves each enabled channel and **refuses to start** when
`NODE_ENV=production` and any resolved adapter is a simulator (FR-005c, research D2).

This is a startup check rather than a request-time check on purpose: a request-time refusal would
mean a production process that runs, accepts tickets, and reports replies as sent while delivering
nothing — the one failure in this phase that is completely invisible from the inside.

---

## Email

**Providers**: `simulator`, `imap-smtp`.

**Inbound** is a poller, not a webhook: `lib/mail-poller.ts` on the `lib/scheduler.ts` pattern —
started from `server.ts`, never `app.ts`, so importing the app in a test spawns no connections.
Collection resumes from the last processed UID, and the `channel_intake` unique index is what makes a
re-read harmless rather than the UID bookkeeping being perfect (FR-032, FR-039).

**Threading** populates `inReplyTo`, `references`, and `addressToken`. Resolution order is fixed and
is the whole of research D4:

1. `inReplyTo` against `messages.outbound_message_id`
2. each entry of `references`, newest first, against the same
3. `addressToken`, verified by signature
4. no match → a new ticket

Subject is never consulted at any step (FR-023).

**Outbound** generates and returns a `Message-ID` (`outboundMessageId`), which is stored and becomes
what the customer's reply threads against (FR-040).

**Automated mail** sets `isAutomated` when `Auto-Submitted` is present and not `no`, `Precedence` is
`bulk`/`list`/`junk`, `X-Auto-Response-Suppress` is present, or the return path is empty
(research D12).

**Attachments** are sniffed for content type and checked against Phase 2's allow-list and size
ceiling. `Content-Disposition: inline` with a `Content-ID` referenced by the body sets `is_inline`
(FR-036).

---

## WhatsApp

**Providers**: `simulator`, `cloud-api`.

**Inbound** is a webhook. `verifyWebhook` checks the provider signature over the raw bytes
(research D5). `parseWebhook` returns zero or more `InboundMessage`s — a single delivery can carry a
batch, and status-only deliveries carry none.

**`replyWindow`** is implemented here and nowhere else. It reports whether a free-form reply is
currently permitted and, when it is not, which pre-approved formats are available (FR-057, FR-058).
The composer calls it before the agent starts typing, which is the difference between telling someone
what they may send and letting them discover it after writing.

**Delivery and read state** arrive as later webhooks against the same `providerMessageId` and update
`messages.delivery_state` (FR-059).

**Media** is fetched by the adapter and handed over as `attachments`; the service layer never learns
that a media id existed (FR-056).

**Opt-out** arrives through the provider's own signal and is written to `channel_opt_outs`
(FR-060).

---

## SMS

**Providers**: `simulator`, `gateway`.

**Inbound** is a webhook, verified and idempotent as for WhatsApp (FR-064).

**Segmentation** is reported by the adapter so the composer can show the agent the limit and the
segment count **before** sending (FR-063). The adapter does not silently truncate.

**Opt-out keywords** (`STOP` and its documented equivalents) are recognised at the adapter and
recorded; the message is `ignored` in the ledger rather than converted to a ticket, because "STOP" is
an instruction to the system, not a question for an agent (FR-065).

**Unreachable numbers** return `state: 'failed'` with `retryable: false`, which surfaces on the
ticket rather than as silence (FR-067).

---

## Live chat

**Provider**: `simulator` only. There is no third party — this system is the provider.

The adapter exists anyway, so that chat enters intake through the same door as every other channel
and gets the same identity resolution, threading, and ledger treatment for free. `send` publishes to
the stream hub; `start`/`stop` and the webhook members are unimplemented.

**Continuity** is `providerConversationId` = the chat session id, so every message in one session
threads to one ticket without consulting anything else.

---

## Web form

**Provider**: `inbound` only. Inbound-only by definition — a form has no reply path (FR-003).

`body` is built from the submitted answers **together with the label text as it was asked**
(FR-085, data-model.md). `providerMessageId` is a submission uuid. `threadHints` are all null: every
submission starts a ticket.

---

## What an adapter may never do

Stated as prohibitions because each has a tempting shortcut:

- **Write to the database.** Adapters return values; `intake.service` and `message.service` persist.
  An adapter that writes has moved a business decision behind the boundary.
- **Decide which customer a message belongs to.** That is `identity.service`, once, for every
  channel (FR-011, research D6).
- **Decide which ticket a message threads to.** That is `intake.service`, using `threadHints`.
- **Create or reopen a ticket.** Intake never assigns (FR-027) and never reopens (research D8), and
  an adapter that could do either would bypass both rules.
- **Render or format for display.** Adapters normalise; the interface renders from locale files
  (FR-108).
