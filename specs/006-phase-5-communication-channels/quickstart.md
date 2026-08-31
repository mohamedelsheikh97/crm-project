# Quickstart: Phase 5 — Communication Channels

**Feature**: `006-phase-5-communication-channels` | **Date**: 2026-08-30

How to run Phase 5 and prove it works. Automated checks first, then the scenarios a test runner
cannot assert — and, uniquely to this phase, one that CI can never assert at all, because it needs a
real provider.

## Prerequisites

- Node.js 22 LTS, MySQL 8.4 running, `.env` present at the repo root (Phase 0 setup unchanged).
- Phases 0–4 migrated and seeded. **If `GET /api/tickets` returns `INTERNAL_ERROR`, the database is
  behind the code — run `npm run db:migrate` before anything else.**
- **New settings**, all with defaults so an existing `.env` keeps working:

  | Variable | Default | Notes |
  | --- | --- | --- |
  | `CHANNEL_EMAIL_PROVIDER` | `simulator` | `simulator` \| `imap-smtp` |
  | `CHANNEL_WHATSAPP_PROVIDER` | `simulator` | `simulator` \| `cloud-api` |
  | `CHANNEL_SMS_PROVIDER` | `simulator` | `simulator` \| `gateway` |
  | `MAIL_POLL_SECONDS` | `60` | Email collection interval |
  | `INTAKE_RATE_PER_MINUTE` | `60` | Per channel, per sender |
  | `PUBLIC_RATE_PER_MINUTE` | `20` | Chat and form submission, per visitor |
  | `CHAT_WIDGET_ORIGIN` | — | Origin permitted to embed the widget |

  Provider credentials (`MAIL_IMAP_*`, `MAIL_SMTP_*`, `WHATSAPP_*`, `SMS_*`) are required **only**
  when the corresponding provider is not `simulator`. `config/env.ts` validates that pairing at
  startup, so a channel switched on without its credentials fails fast rather than at the first
  message.

- **Everything below except V10 runs on simulators.** No commercial account is needed to accept this
  phase (FR-005b, SC-015).
- Two browser profiles, or one normal and one private window — several checks need an agent and a
  visitor at once.

## Setup

```powershell
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

`npm install` fetches three new backend dependencies (`imapflow`, `mailparser`, `nodemailer`) — the
first added since Phase 0, justified in plan.md Complexity Tracking.

`db:seed` adds the four Phase 5 permission grants. Sign in as the seeded administrator and confirm
the roles screen lists `messages:send`, `messages:reattribute`, `channels:manage`, and
`forms:manage`. If any is missing, the catalog and the seeder have drifted apart.

For the manual checks you need: one **Supervisor**, one **Agent**, and one customer with a contact
holding a known email address.

## Automated validation

```powershell
npm test                          # both projects
npx vitest run --project backend  # backend only
npx vitest run --project frontend # frontend only
```

Expect the Phase 0–4 suites to pass unchanged. **If any Phase 3 or Phase 4 test now fails, stop** —
the likeliest cause is the `tickets.created_by_user_id` relaxation or the `messages`/`ticket_notes`
separation, and both are the kind of regression this phase must not ship.

| Suite | Proves |
| --- | --- |
| `backend/tests/authorization.matrix.test.ts` | The four new keys are enforced server-side for every role (SC-012). Extends automatically. |
| `backend/tests/ownership.matrix.test.ts` | Extended to chat sessions: one visitor token reaches exactly one conversation (FR-075, SC-013). |
| `backend/tests/intake/` | Idempotency on every channel (SC-009); nothing accepted is lost (SC-010); automated mail creates no ticket and the loop bound holds (SC-011); a reply threads to its ticket, to a merge survivor, and — for a closed ticket — to a **new linked ticket** (research D8). |
| `backend/tests/identity/` | Exact match resolves; ambiguity is never guessed; an unknown sender creates a provisional customer that Phase 2's duplicate detection then offers for merge (SC-004, SC-016). |
| `backend/tests/channels/` | Every channel end to end through its simulator: inbound becomes a ticket, outbound is delivered and recorded (SC-001, SC-003). Webhook signature verification rejects a tampered body (FR-054). |
| `backend/tests/messages/` | A reply leaves on the arriving channel; `messages:send` is refused without the key; a note endpoint never returns a message and vice versa (SC-005, SC-006). |
| `backend/tests/timeline/` | Cross-channel ordering by `occurredAt`; correspondence only; a ticket the caller may not view contributes nothing (SC-007, FR-090). |
| `frontend/tests/messages/` | Reply and note composers are distinct components against distinct services; delivery state renders honestly; a closed reply window disables free-form entry before typing. |
| `frontend/tests/widget/` | Widget renders in both directions from its own configuration; the live region is polite; the launcher carries an accessible name. |

## Manual validation

### V1 — An email becomes a ticket

With `CHANNEL_EMAIL_PROVIDER=simulator`, post a message to the simulator's inbound endpoint from a
known customer's address. Within one poll interval a ticket exists in the Phase 4 dashboard queue
with that customer, subject, and body — and nobody typed it (SC-001).

Confirm the ticket shows `source: email` and no human creator.

### V2 — The reply continues the conversation

Reply from the ticket. The outbound message appears in the thread, attributed to you, with an honest
delivery state. Now post an inbound simulator message carrying the outbound `Message-ID` in
`In-Reply-To`. It lands on the **same ticket**, not a new one (SC-002).

Repeat with the subject line changed entirely. It still threads — subject is never consulted
(FR-023).

### V3 — Identity, three ways

1. From a known contact's address → attributed to that customer.
2. From an unrecognised address → a **provisional customer** is created and marked unverified; open
   it and confirm Phase 2's duplicate detection offers the merge (SC-016).
3. Add the same address to a second customer's contacts, then send again → the ticket is flagged
   ambiguous and **no customer was chosen** (FR-015).

### V4 — The two composers cannot be confused

On one ticket, write an internal note and send a customer reply. Confirm:

- each region names itself and survives greyscale (FR-002, FR-110)
- the reply control says *"Send to customer"*, the note control says *"Save internal note"*
- the note never appears in the customer timeline (SC-006, FR-087a)

Then sign in as a user **without** `messages:send`. The reply surface is gone — and a direct `POST`
to the endpoint returns `403`, not a hidden control (FR-103).

### V5 — Chat, end to end

Open `widget-demo.html` in one browser; answer from the dashboard in the other.

1. A visitor's first message creates a ticket (FR-070).
2. Replies pass both ways without a reload (FR-071).
3. Close the visitor's tab. The transcript survives on the ticket (FR-072).
4. Stop the backend mid-conversation, restart it, and reconnect: the visitor catches up through
   `?since=` with no message lost (FR-097).
5. With no agent signed in, start a chat: the visitor is told, **and the ticket still exists**
   (FR-074).

### V6 — WhatsApp and SMS constraints are visible, not discovered

Through the simulators:

1. An inbound message from a number on a customer's contact resolves to that customer (FR-012).
2. Put the WhatsApp conversation outside its reply window. The composer **disables free-form entry
   and offers the permitted templates before you type** (FR-057) — it does not accept a message and
   then fail.
3. Send `STOP` on SMS. No ticket is created, the opt-out is recorded, and the ticket screen shows it
   before an agent composes (FR-051, FR-065).
4. Redeliver the same webhook three times. One ticket, one message (SC-009).
5. Tamper with the payload after signing. Rejected and recorded (FR-054).

### V7 — Nothing is lost

1. Deliver a malformed message. No ticket — but a `channel_intake` row with `failed` and a reason,
   visible to an administrator (FR-037).
2. Fix the cause and reprocess it. It converts (FR-038).
3. Deliver an out-of-office reply. Recorded as `ignored`, **not** `failed`, and it creates no ticket
   (FR-029) — the distinction matters, or a failure review fills with correctly-handled mail.

### V8 — The closed-ticket rule

Reply to a **closed** ticket. A **new ticket is created, linked to the closed one**, and the link is
visible on both. The closed ticket stays closed.

This is the rule research D8 substituted for the spec's original assumption, because `closed → open`
requires `tickets:reopen` and an inbound message holds no permission. Confirm a Supervisor can still
reopen the old ticket by hand.

### V9 — One customer, one conversation

Give one customer correspondence on two channels across two tickets. Open the timeline:

1. Everything in one sequence, ordered by when it happened (FR-092).
2. Channel, direction, time, and ticket identifiable on each entry, without colour (FR-088).
3. Each entry leads to its ticket (FR-089).
4. As a user who may not view one of those tickets, its messages are absent (FR-090).

### V10 — One real provider *(cannot be done in CI)*

The one check no test can make. Point **one** channel at a real provider — email is the cheapest —
by setting `CHANNEL_EMAIL_PROVIDER=imap-smtp` and its credentials.

1. Send a genuine email from an ordinary mail client. It becomes a ticket.
2. Reply from the ticket. It arrives in the real mailbox.
3. Reply to that from the mail client. It threads to the same ticket.
4. Set `NODE_ENV=production` with a channel still on `simulator`: **the process refuses to start**
   (FR-005c). This is the check that stops a production system from silently delivering nothing.

Steps 1–3 prove the adapter boundary held: nothing above `channels/` changed between simulator and
provider (SC-015).

### V11 — Accessibility and bilingual passes

Manual, as in Phase 4, and not assertable from happy-dom:

1. **Keyboard only**, both directions, over: message thread, reply composer, timeline, both admin
   views, the public form, and the widget. Visible focus throughout (FR-109).
2. **Focus** is trapped in the open widget and returns to the launcher on close.
3. **Screen reader**: an arriving chat message is announced and **does not steal focus** (FR-077).
   Phase 4 recorded the same check for notifications; it is the likeliest regression in both phases.
4. **RTL** over every new screen, and the widget in Arabic **on an English host page** — its
   direction must come from its own configuration, not the host (FR-076).
5. **Greyscale**: channel, direction, delivery state, and the note/message distinction all survive
   (FR-002, FR-110).
6. **Foreign host page**: embed the widget on a page with an aggressive CSS reset and its own
   `z-index` stacking. It must render correctly and must not restyle the host.

## Definition of done for this phase

PLAN.md: *"A message from any channel becomes a ticket automatically and shows up correctly in the
agent dashboard and the customer's timeline."*

| Clause | Proven by |
| --- | --- |
| A message from any channel becomes a ticket automatically | V1, V5, V6, V7, and `backend/tests/channels/` for all five |
| shows up correctly in the agent dashboard | V1, V4, V6 |
| and the customer's timeline | V9 |

V10 is not required for the Definition of done — the phase is accepted on simulators by design
(Clarifications Q1) — but it is required before any customer is told the system is live.
