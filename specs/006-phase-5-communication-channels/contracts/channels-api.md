# Contract: Channels API

**Feature**: `006-phase-5-communication-channels` | **Date**: 2026-08-30

Covers message threads, outbound replies, the customer timeline, channel administration, form
definitions, and the public intake surfaces. The adapter interface each channel implements is in
[channel-adapters.md](./channel-adapters.md); screens and the widget are in
[messaging-ui.md](./messaging-ui.md).

Envelopes follow the shape Phases 1–4 fixed: a read returns the resource directly, a list returns
`{ items, page, pageSize, total }`, a failure returns `{ "error": { "code", "message", "details" } }`
with `details` as `{ field, message }` pairs.

Four rules apply throughout and are not repeated per endpoint:

- **Keys, never labels.** `channel`, `direction`, `deliveryState`, and every enumerated value travel
  as keys and are rendered through i18n (FR-107, FR-108). No endpoint returns a display sentence.
- **Authenticated unless listed under Public surfaces.** The public endpoints are enumerated at the
  end of this document and are closed-ended: chat, form submission, webhooks, and nothing else
  (FR-105).
- **No endpoint confirms whether an address or number is known** (FR-106). A submission from a
  recognised sender and one from a stranger are indistinguishable in the response.
- **Correspondence is never notes.** No endpoint here reads or writes `ticket_notes`, and no Phase 4
  note endpoint reads or writes `messages`. The separation is structural, not conventional (FR-044,
  SC-006).

---

## Messages on a ticket

### `GET /api/tickets/:id/messages`

**Permission**: the same visibility rule Phase 3 applies to the ticket itself.

Returns the customer correspondence on one ticket, oldest first, paged. Internal notes are **not**
included — they are Phase 4's `GET /api/tickets/:id/notes`.

```json
{
  "items": [
    {
      "id": 812,
      "channel": "email",
      "direction": "inbound",
      "author": null,
      "senderIdentity": "hala@example.com",
      "body": "لم أستلم الفاتورة بعد.",
      "bodyFormat": "text",
      "attachments": [
        { "id": 91, "fileName": "receipt.pdf", "contentType": "application/pdf", "byteSize": 20481 }
      ],
      "deliveryState": "delivered",
      "deliveryDetail": null,
      "occurredAt": "2026-08-30T08:12:00.000Z"
    },
    {
      "id": 813,
      "channel": "email",
      "direction": "outbound",
      "author": { "id": 3, "fullName": "Sara Kamal" },
      "senderIdentity": "hala@example.com",
      "body": "نعتذر عن التأخير، سنرسلها اليوم.",
      "bodyFormat": "text",
      "attachments": [],
      "deliveryState": "failed",
      "deliveryDetail": "mailbox_full",
      "occurredAt": "2026-08-30T08:40:00.000Z"
    }
  ],
  "page": 1,
  "pageSize": 50,
  "total": 2
}
```

`body` is always safe to render as text. When the original was HTML, `bodyFormat` is `html_source`
and the server has already reduced it to readable text with no active content — the client never
receives markup it is expected to sanitise itself (FR-008, FR-034).

`attachments` never include inline images referenced by an HTML body (FR-036); those are stored with
`is_inline` set and are excluded from this list.

### `POST /api/tickets/:id/messages`

**Permission**: `messages:send`.

Sends a reply on the channel the conversation is taking place on. The channel is **not** a request
parameter — it is derived from the conversation, so a caller cannot redirect a reply to a channel the
customer never used.

```json
{ "body": "سنرسل الفاتورة اليوم." }
```

Returns `201` with the created message, `deliveryState` of `pending` or `sent` depending on whether
the adapter reports synchronously. **It never returns `delivered` at creation** (FR-047).

| Failure | Status | Code |
| --- | --- | --- |
| Caller lacks `messages:send` | `403` | `FORBIDDEN` |
| Ticket has no conversation to reply to | `409` | `NO_REPLY_CHANNEL` |
| Recipient has opted out | `409` | `RECIPIENT_OPTED_OUT` |
| Outside the channel's permitted reply window | `409` | `CHANNEL_WINDOW_CLOSED` |
| Channel disabled or unconfigured | `503` | `CHANNEL_UNAVAILABLE` |
| Body empty or over the channel limit | `400` | `VALIDATION_ERROR` |

`CHANNEL_WINDOW_CLOSED` carries its structure as a **sibling** of `error`, following the precedent
Phase 2 set with `duplicates` and Phase 3 with `transition`:

```json
{
  "error": { "code": "CHANNEL_WINDOW_CLOSED", "message": "...", "details": [] },
  "window": { "channel": "whatsapp", "reopensAt": null, "allowedTemplates": ["appointment_reminder"] }
}
```

This is what lets the composer tell the agent what the channel permits rather than letting them write
a message that will be refused (FR-057, FR-058).

### `POST /api/tickets/:id/reattribute`

**Permission**: `messages:reattribute`.

Moves a ticket — and therefore its correspondence — to the correct customer (FR-017). Audited with
the acting user (FR-104).

```json
{ "customerId": 7, "version": 3 }
```

Optimistic locking follows Phase 3: a missing or stale `version` is `409 STALE_RECORD`.

---

## Customer timeline

### `GET /api/customers/:id/timeline`

**Permission**: `customers:view`. No separate key — see data-model.md.

Returns one chronological sequence of that customer's correspondence across every ticket and channel,
ordered by `occurredAt` (FR-092), paged (FR-091).

```json
{
  "items": [
    {
      "id": 812,
      "channel": "email",
      "direction": "inbound",
      "occurredAt": "2026-08-30T08:12:00.000Z",
      "preview": "لم أستلم الفاتورة بعد.",
      "ticket": { "id": 42, "reference": "TKT-000042", "subject": "فاتورة غير مستلمة" }
    }
  ],
  "page": 1,
  "pageSize": 25,
  "total": 18
}
```

**Correspondence only** (FR-087a). No internal notes, no ticket history. This is the property Phase 8
will depend on, and it is enforced by the query reading `messages` and nothing else.

**Filtered by ticket visibility** (FR-090). A ticket the caller may not view contributes no entries,
and its absence is not signalled — `total` counts what the caller may see.

---

## Channel administration

### `GET /api/channels`

**Permission**: `channels:manage`.

Returns every channel with its enablement, its resolved provider, and whether it is usable. **Never
returns a credential** (FR-006).

```json
{
  "items": [
    { "channel": "email", "isEnabled": true, "provider": "imap-smtp", "isConfigured": true },
    { "channel": "whatsapp", "isEnabled": false, "provider": "simulator", "isConfigured": true },
    { "channel": "sms", "isEnabled": true, "provider": "gateway", "isConfigured": false }
  ]
}
```

`isConfigured: false` with `isEnabled: true` is the state an administrator must be able to see — the
channel is switched on and cannot work.

### `PATCH /api/channels/:channel`

**Permission**: `channels:manage`. Body: `{ "isEnabled": true, "settings": { ... } }`. Audited
(FR-104). Rejects any key that looks like a credential rather than silently storing it.

---

## Form definitions

### `GET /api/forms` · `POST /api/forms` · `PATCH /api/forms/:id`

**Permission**: `forms:manage` (FR-080). Definitions carry bilingual titles and field labels
(FR-079); `defaultCategory` and `defaultPriority` are validated against Phase 3's declared taxonomy
and refused otherwise (FR-084).

---

## Public surfaces

These four are the **only** unauthenticated endpoints this phase introduces (FR-105). Each is rate
limited independently, and none exposes anything beyond creating or continuing one conversation.

### `POST /api/public/chat/sessions`

Opens a conversation. Returns an opaque `visitorToken` (research D14) that authorises exactly that
conversation and nothing else.

```json
{ "locale": "ar", "name": "هالة", "identity": "hala@example.com" }
```

`name` and `identity` are optional (FR-069). When `identity` is given it is resolved by the same
identity rule as every other channel (FR-073) — and the response is identical whether or not it
matched (FR-106).

### `POST /api/public/chat/sessions/:token/messages` · `GET /api/public/chat/sessions/:token/stream`

Send a visitor message; subscribe to agent replies over Server-Sent Events (research D10). The token
authorises one conversation: any other conversation is `404`, never `403` — whether another
conversation exists is not a visitor's business, the same reasoning Phase 4 applied to other users'
tasks.

When no agent is available the send still succeeds and the response says so, because the conversation
must still become a ticket (FR-074):

```json
{ "id": 5, "occurredAt": "...", "agentsAvailable": false }
```

### `POST /api/public/forms/:slug/submissions`

Creates a ticket from a submission (FR-082). Required-field validation is server-side (FR-083) and
names the failing field in the submission's language:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [{ "field": "orderNumber", "message": "..." }] } }
```

### `POST /api/channels/webhooks/:channel`

Provider delivery. The signature is verified against the **raw request bytes** before the payload is
parsed or trusted (research D5, FR-054, FR-064). Unverifiable requests are `401` and recorded
(FR-054). Redelivery of an already-recorded event returns `200` and does nothing (FR-055).

Responds `200` as soon as the delivery is recorded in `channel_intake` — conversion happens after,
because a provider that is made to wait for conversion will retry and duplicate.

---

## Status code conventions

Unchanged from Phases 1–4, and worth restating because this phase's contracts were the first written
against the wrong assumption in Phase 4:

| Situation | Status | Code |
| --- | --- | --- |
| Validation failure | `400` | `VALIDATION_ERROR` |
| Not authenticated | `401` | `UNAUTHENTICATED` |
| Authenticated, lacks permission | `403` | `FORBIDDEN` |
| Absent, or not the caller's business | `404` | `NOT_FOUND` |
| Conflict with current state | `409` | (specific code) |
| Rate limited | `429` | `RATE_LIMITED` |
| Channel disabled or unconfigured | `503` | `CHANNEL_UNAVAILABLE` |
