---
description: 'Task list for Phase 5 — Communication Channels'
---

# Tasks: Phase 5 — Communication Channels

**Input**: Design documents from `/specs/006-phase-5-communication-channels/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. The constitution's Phase-Gated Delivery principle requires each phase to ship
tested; Principle II makes the authorization matrix non-optional; SC-012 and SC-013 make the
ownership matrix and the public-surface isolation tests non-optional. This phase additionally cannot
be accepted without tests in a way earlier phases could: every channel is exercised through its
simulator (research D2), so **the test suite is the only proof the phase works** until someone
connects a real provider in quickstart V10.

**Organization**: Grouped by user story. Stories run **US2 → US1 → US3 → US6 → US5 → US4 → US7**,
which is neither numeric nor strictly priority order. Two deliberate deviations:

- **US2 (identity) precedes US1 (email intake)**, though US1 is the headline story, because US1's
  first acceptance scenario requires the ticket to be attributed to the right customer. Building
  identity first means intake calls a real resolver instead of a stub that has to be torn out.
- **US4 (timeline) is deferred behind US5 and US6**, though all three are P2, because its
  independent test requires correspondence on *two* channels. Built earlier it could only be tested
  against email, and would have to be revisited.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US7 per spec.md

## Path Conventions

Web app monorepo: `backend/src/`, `backend/tests/`, `frontend/src/`, `frontend/tests/`.

---

## Phase 1: Setup

**Purpose**: Directories, configuration, and — for the first time since Phase 0 — dependencies.

- [X] T001 Create the module directories `backend/src/channels/`, `backend/src/channels/email/`, `backend/src/channels/whatsapp/`, `backend/src/channels/sms/`, `backend/src/channels/chat/`, `backend/src/channels/form/`, `backend/src/routes/channels/`, `backend/src/routes/chat/`, `backend/src/routes/forms/`, `backend/src/routes/messages/`, `backend/src/routes/timeline/`, `backend/src/controllers/channels/`, `backend/src/controllers/chat/`, `backend/src/controllers/forms/`, `backend/src/controllers/messages/`, `backend/src/controllers/timeline/`, `backend/tests/channels/`, `backend/tests/chat/`, `backend/tests/forms/`, `backend/tests/identity/`, `backend/tests/intake/`, `backend/tests/messages/`, `backend/tests/timeline/`, `frontend/src/components/messages/`, `frontend/src/components/timeline/`, `frontend/src/widget/`, `frontend/tests/messages/`, `frontend/tests/timeline/`, `frontend/tests/widget/`
- [X] T002 Add `imapflow`, `mailparser`, `nodemailer` and their `@types/*` where not bundled to `backend/package.json`, and record in the PR description that this ends the no-new-dependency streak per plan.md Complexity Tracking
- [X] T003 [P] Add the `messages.*`, `timeline.*`, `widget.*`, `channels.*`, and `forms.*` namespace skeletons to `frontend/src/locales/en.json` and `frontend/src/locales/ar.json`, so later tasks add keys to an existing branch rather than creating it twice
- [X] T004 [P] Add the channel settings from quickstart.md to the schema in `backend/src/config/env.ts` and to `.env.example`: `CHANNEL_EMAIL_PROVIDER`, `CHANNEL_WHATSAPP_PROVIDER`, `CHANNEL_SMS_PROVIDER` (each defaulting to `simulator`), `MAIL_POLL_SECONDS`, `INTAKE_RATE_PER_MINUTE`, `PUBLIC_RATE_PER_MINUTE`, `CHAT_WIDGET_ORIGIN`
- [X] T005 [P] Add conditional credential validation to `backend/src/config/env.ts`: `MAIL_IMAP_*` / `MAIL_SMTP_*`, `WHATSAPP_*`, and `SMS_*` are required only when the matching provider is not `simulator`, so a channel switched on without credentials fails at startup rather than at the first message
- [X] T006 [P] Add a second Vite entry for the widget in `frontend/vite.config.ts` producing a standalone bundle, per research D14, and a `frontend/public/widget-demo.html` host page for quickstart V5

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, permissions, models, the adapter boundary, and the shared infrastructure every
channel uses.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. Two tasks in particular:

- **T023** — a forgotten test-helper seeder makes every Phase 5 test fail with a 403 that looks
  nothing like its cause, exactly as happened in Phases 2, 3 and 4.
- **T017** — the unique index on `channel_intake (channel, provider_message_id)` is FR-039, FR-055
  and FR-094 in one constraint. Every channel gets idempotency from it and none implements its own.

### Schema

- [X] T007 Create migration `backend/src/db/migrations/20260830000001-alter-tickets-add-source.cjs` adding `source VARCHAR(20) NOT NULL DEFAULT 'manual'` to `tickets`, relaxing `created_by_user_id` to `NULL`, and adding index `tickets_source (source)` per data-model.md and research D9
- [X] T008 [P] Create migration `backend/src/db/migrations/20260830000002-alter-customers-add-provisional.cjs` adding `is_provisional BOOLEAN NOT NULL DEFAULT FALSE` to `customers` plus index `customers_is_provisional`, per research D7
- [X] T009 [P] Create migration `backend/src/db/migrations/20260830000003-create-messages.cjs` with the columns in data-model.md, FK `ticket_id → tickets ON DELETE CASCADE`, FK `author_user_id → users ON DELETE RESTRICT`, indexes `messages_ticket_occurred (ticket_id, occurred_at)` and `messages_provider (channel, provider_message_id)`, and **UNIQUE `messages_outbound_message_id (outbound_message_id)`** — the threading lookup of research D4
- [X] T010 [P] Create migration `backend/src/db/migrations/20260830000004-create-message-attachments.cjs`: `message_id` FK `ON DELETE CASCADE`, `file_name`, `content_type`, `byte_size`, `storage_key`, `is_inline BOOLEAN NOT NULL DEFAULT FALSE`
- [X] T011 [P] Create migration `backend/src/db/migrations/20260830000005-create-channel-intake.cjs`: `channel`, `provider_message_id`, `received_at`, `status`, `reason`, `raw_payload MEDIUMTEXT`, nullable `message_id` FK `ON DELETE SET NULL`, `attempts`, and **UNIQUE `channel_intake_provider (channel, provider_message_id)`**
- [X] T012 [P] Create migration `backend/src/db/migrations/20260830000006-create-channel-settings.cjs`: `channel` UNIQUE, `is_enabled BOOLEAN NOT NULL DEFAULT FALSE`, `settings_json JSON NULL`, `updated_by_user_id` FK `ON DELETE SET NULL`. **No credential column** (FR-006)
- [X] T013 [P] Create migration `backend/src/db/migrations/20260830000007-create-chat-sessions.cjs`: `visitor_token CHAR(64)` UNIQUE storing a hash, nullable `ticket_id` FK `ON DELETE CASCADE`, `visitor_name`, `visitor_identity`, `locale`, `state`, `last_seen_at`
- [X] T014 [P] Create migration `backend/src/db/migrations/20260830000008-create-form-definitions.cjs`: `slug` UNIQUE, `title_en`, `title_ar`, `fields_json JSON NOT NULL`, `default_category`, `default_priority`, `is_published`, `created_by_user_id` FK `ON DELETE SET NULL`
- [X] T015 [P] Create migration `backend/src/db/migrations/20260830000009-create-channel-opt-outs.cjs`: `channel`, `identity_normalised`, `opted_out_at`, `source`, and **UNIQUE `(channel, identity_normalised)`** — keyed by identity and never by customer, so a merge cannot resurrect consent
- [X] T016 Verify each `down` in the nine new files under `backend/src/db/migrations/` (T007–T015) drops FK constraints before the indexes they depend on, the failure mode Phase 1 hit and Phases 3 and 4 re-checked; confirm T007's `down` restores `created_by_user_id` to `NOT NULL` only after asserting no null rows remain
- [X] T017 Run `npm run db:migrate` against a scratch database and confirm the `channel_intake` unique index rejects a duplicate `(channel, provider_message_id)` insert, before any code depends on it

### Permissions

- [X] T018 Add the four permission keys from data-model.md to the catalog in `backend/src/auth/permissions.ts`: `messages:send`, `messages:reattribute`, `channels:manage`, `forms:manage`
- [X] T019 [P] Create seeder `backend/src/db/seeders/20260830000001-channel-permissions.cjs` granting `messages:send` to Agent, Supervisor and Administrator; `messages:reattribute` and `forms:manage` to Supervisor and Administrator; `channels:manage` to Administrator — reconciling only, inserting what is missing and deleting nothing, as every prior phase's seeder does
- [X] T020 [P] Confirm `backend/tests/authorization.matrix.test.ts` picks up the four new keys with no edit, and that a key with no grant or a grant nothing enforces still fails the build

### Models

- [X] T021 [P] Create `backend/src/models/message.model.ts`, `message-attachment.model.ts`, `channel-intake.model.ts`, `channel-setting.model.ts`, `chat-session.model.ts`, `form-definition.model.ts`, and `channel-opt-out.model.ts` per data-model.md
- [X] T022 Add `source` and the nullable `created_by_user_id` to `backend/src/models/ticket.model.ts`, and `is_provisional` to `backend/src/models/customer.model.ts`, then register all seven new models and their associations in `backend/src/models/index.ts` per the relationship diagram in data-model.md
- [X] T023 Register `20260830000001-channel-permissions.cjs` in the seeder list in `backend/tests/helpers/database.ts`, following the rule that helper settles: it seeds **permissions, not content**

### The adapter boundary and shared infrastructure

- [X] T024 [P] Create `backend/src/channels/types.ts` declaring `InboundMessage`, `ThreadHints`, `OutboundMessage`, `SendResult`, `ReplyWindow`, and `ChannelAdapter` exactly as in contracts/channel-adapters.md
- [X] T025 Create `backend/src/channels/registry.ts` resolving each channel's adapter from `CHANNEL_*_PROVIDER`, and **refusing to start when `NODE_ENV=production` and any enabled channel resolves to a simulator** (FR-005c, research D2)
- [X] T026 [P] Create `backend/src/lib/rate-limit.ts`: a fixed-window counter keyed by a caller-supplied string, usable both as Express middleware and as a plain function inside the intake path (research D11)
- [X] T027 [P] Add a `verify` callback to `express.json()` in `backend/src/app.ts` stashing the raw request buffer, leaving the fixed middleware order otherwise untouched, and give the webhook routes their own larger body limit tied to the FR-010 ceiling (research D5)
- [X] T028 Generalise `backend/src/lib/notification-hub.ts` from a `user:{id}` channel key to an opaque channel key, keeping `publish` / `subscribe` / `listenerCount` and the persist-then-emit ordering rule unchanged, and confirm every Phase 4 notification test still passes (research D10)
- [X] T029 [P] Create `backend/src/services/opt-out.service.ts`: record an opt-out, and answer "may this identity be messaged on this channel?" — the single site FR-051, FR-060 and FR-065 all consult

**Checkpoint**: Schema, permissions, models, and the adapter boundary exist. No channel works yet.

---

## Phase 3: User Story 2 — The Message Finds the Right Customer (Priority: P1)

**Goal**: An inbound sender resolves to exactly one customer, is held when ambiguous, and creates a
provisional customer when unknown.

**Independent Test**: Seed customers whose contacts carry known addresses and numbers; resolve a
matching address, a matching number in a different format, an unrecognised sender, and an address
shared by two customers; confirm each is resolved or held by the declared rule and never guessed.

### Tests for User Story 2

- [X] T030 [P] [US2] Write `backend/tests/identity/resolution.test.ts`: exact email match resolves; a phone number in three formats resolves to the same customer through `lib/phone.ts`; an inactive customer still resolves and reports its standing; **no partial or domain match ever resolves** (FR-016)
- [X] T031 [P] [US2] Write `backend/tests/identity/ambiguity.test.ts`: an address held by two customers returns `ambiguous`, chooses neither, and creates no provisional customer (FR-015)
- [X] T032 [P] [US2] Write `backend/tests/identity/provisional.test.ts`: an unknown sender creates a customer with `is_provisional` set; Phase 2's `duplicate.service.findDuplicates` then offers it for merge; merging carries its correspondence to the survivor (FR-014a–FR-014d, SC-016)

### Implementation for User Story 2

- [X] T033 [US2] Create `backend/src/services/identity.service.ts` returning exactly three outcomes — `resolved`, `ambiguous`, `unknown` — from an exact lookup on `customer_contacts.value_normalised` normalised through the existing `backend/src/lib/phone.ts` (research D6)
- [X] T034 [US2] Add provisional-customer creation to `backend/src/services/identity.service.ts`: build a display name from what the sender disclosed, set `is_provisional`, and create the matching `customer_contacts` row so the next message from the same sender resolves normally
- [X] T035 [US2] Add `POST /api/tickets/:id/reattribute` — controller in `backend/src/controllers/messages/messages.controller.ts`, route in `backend/src/routes/messages/messages.routes.ts` — behind `messages:reattribute`, with Phase 3 optimistic locking and an audit entry (FR-017, FR-104)
- [X] T036 [P] [US2] Extend `backend/src/services/customer.service.ts` list filtering so provisional customers are distinguishable wherever customers are listed (FR-014b)

**Checkpoint**: Identity resolves correctly in isolation. Nothing calls it yet.

---

## Phase 4: User Story 1 — An Email Becomes a Ticket, and the Reply Continues It (Priority: P1) 🎯 MVP

**Goal**: Mail arrives, becomes a ticket attributed to the right customer, and a customer's reply
lands on the same ticket.

**Independent Test**: Deliver a message to the simulator from a known customer's address; confirm a
ticket with the correct customer, subject, and body. Reply to it; confirm no second ticket and the
reply appended to the first.

**MVP note**: The MVP is Phase 3 + Phase 4 together. US2 alone is not user-visible; US1 without US2
would attribute nothing.

### Tests for User Story 1

- [X] T037 [P] [US1] Write `backend/tests/intake/ledger.test.ts`: a delivery is a `channel_intake` row before conversion; redelivery is a no-op; `converted` is terminal; a `failed` row retains its raw payload and reprocesses (FR-037, FR-038, FR-039, SC-009, SC-010)
- [X] T038 [P] [US1] Write `backend/tests/intake/threading.test.ts`: `In-Reply-To` threads to the right ticket; a `References` chain threads to the right ticket; **a changed subject still threads** and a matching subject alone never does (FR-023, research D4); a reply to a merged ticket lands on the survivor (FR-024)
- [X] T039 [P] [US1] Write `backend/tests/intake/closed-ticket.test.ts`: a reply to a `closed` ticket creates a **new ticket linked to the closed one**, leaves the closed ticket closed, and never calls the `tickets:reopen` path (research D8, FR-025)
- [X] T040 [P] [US1] Write `backend/tests/intake/automated-mail.test.ts`: each of `Auto-Submitted`, `Precedence: bulk`, `X-Auto-Response-Suppress`, and an empty return path is recorded `ignored` — **not `failed`** — and creates no ticket; the loop bound engages and is recorded (FR-029, FR-030, SC-011)
- [ ] T041 [P] [US1] Write `backend/tests/channels/email.test.ts`: an inbound simulator message becomes a ticket with `source: email` and a null creator; attachments are retained with sniffed content types; an inline image is stored with `is_inline` and excluded from the attachment list; an HTML body yields readable text with no active content (FR-026, FR-034, FR-035, FR-036)

### Implementation for User Story 1

- [X] T042 [P] [US1] Create `backend/src/channels/email/simulator.ts` implementing `ChannelAdapter`: an in-memory outbox, an inbound injection function tests call directly, and full `ThreadHints` population
- [X] T043 [US1] Create `backend/src/services/intake.service.ts`: record the `channel_intake` row first, then resolve identity, then thread, then create or append — in that order, so a downstream failure can never lose an accepted delivery (FR-095, research D13)
- [X] T044 [US1] Add threading resolution to `backend/src/services/intake.service.ts` in the fixed order of contracts/channel-adapters.md — `inReplyTo`, then `references` newest first, then a signed `addressToken`, then a new ticket — never consulting the subject
- [X] T045 [US1] Add the closed-ticket rule to `backend/src/services/intake.service.ts`: create a new ticket and link it to the closed one through Phase 3's `ticket-link.service.ts`, never transitioning the closed ticket (research D8)
- [X] T046 [US1] Add automated-mail detection and the per-sender loop bound to `backend/src/services/intake.service.ts`, recording `ignored` distinctly from `failed` (research D12)
- [X] T047 [P] [US1] Create `backend/src/services/message.service.ts` with thread reads and message creation, and `GET /api/tickets/:id/messages` per contracts/channels-api.md — correspondence only, never touching `ticket_notes`
- [X] T048 [US1] Create `backend/src/channels/email/imap-smtp.ts` using `imapflow` and `mailparser`, populating `ThreadHints` and `isAutomated` from real headers, and sniffing attachment content types against Phase 2's allow-list and ceiling
- [ ] T049 [US1] Create `backend/src/lib/mail-poller.ts` on the `lib/scheduler.ts` pattern, resuming from the last processed UID, and **start it from `backend/src/server.ts`, never `app.ts`**, so importing the app in a test opens no connections
- [X] T050 [P] [US1] Create `frontend/src/services/messages.service.ts` and `frontend/src/components/messages/MessageThread.vue` rendering channel, direction, time, and attachments, distinguishable from Phase 4's note thread by more than colour (FR-002, FR-110)
- [X] T051 [US1] Mount `MessageThread.vue` in `frontend/src/views/tickets/TicketDetailView.vue` beside Phase 4's `TicketNoteThread.vue`, each under its own persistent heading from the locale files

**Checkpoint**: Email arrives and threads. Nobody can reply yet.

---

## Phase 5: User Story 3 — The Agent Answers On the Channel It Arrived On (Priority: P1)

**Goal**: An agent replies from the ticket, on the arriving channel, without being able to confuse a
reply with an internal note.

**Independent Test**: From a ticket created by inbound mail, compose and send a reply; confirm it is
delivered on the originating channel, recorded as outbound, and attributed to the sending agent.

### Tests for User Story 3

- [X] T052 [P] [US3] Write `backend/tests/messages/send.test.ts`: a reply leaves on the conversation's channel and **the channel cannot be overridden by the request**; it is recorded outbound and attributed; the audit trail records correspondence leaving the organisation (FR-046, FR-050)
- [X] T053 [P] [US3] Write `backend/tests/messages/permissions.test.ts`: `messages:send` is refused server-side without the key even when the control is hidden; holding `ticket_notes:create` grants no send capability and vice versa (FR-043, FR-103, SC-006)
- [X] T054 [P] [US3] Write `backend/tests/messages/delivery-state.test.ts`: a created message is never `delivered` at creation; a transient failure retries within bounds; a permanent refusal does not retry; a failure surfaces with its detail (FR-047, FR-048, FR-049)
- [X] T055 [P] [US3] Write `backend/tests/messages/opt-out.test.ts`: sending to an opted-out identity is refused with `RECIPIENT_OPTED_OUT`, and the opt-out survives the identity moving between customers (FR-051)
- [X] T056 [P] [US3] Write `frontend/tests/messages/composer-separation.test.ts`: `ReplyComposer` and Phase 4's `TicketNoteComposer` are distinct components calling distinct services; neither can submit to the other's endpoint; the send control names the act rather than saying "Send" (FR-044, SC-006)

### Implementation for User Story 3

- [X] T057 [US3] Add outbound send to `backend/src/services/message.service.ts`: derive the channel from the conversation, consult `opt-out.service`, call the adapter, and persist the result with an honest `delivery_state`
- [X] T058 [US3] Add `POST /api/tickets/:id/messages` behind `messages:send` — controller in `backend/src/controllers/messages/`, route in `backend/src/routes/messages/` — with the failure codes in contracts/channels-api.md and the `window` sibling key for `CHANNEL_WINDOW_CLOSED`
- [X] T059 [US3] Add transient-failure retry within declared bounds to `backend/src/services/message.service.ts`, driven by the adapter's `retryable` flag and never by parsing a message string (FR-049)
- [X] T060 [US3] Add `Message-ID` generation and storage to the email adapter's `send`, so the customer's reply threads back (FR-040, research D4)
- [X] T061 [P] [US3] Create `frontend/src/components/messages/ReplyComposer.vue` with the standing recipient-and-channel line, a submit control naming the act, and template insertion through Phase 4's unchanged `TemplatePicker.vue` (FR-045)
- [X] T062 [P] [US3] Create `frontend/src/components/messages/DeliveryState.vue` conveying state by icon and text, never colour alone, with the retry affordance shown only for retryable failures (FR-110)
- [X] T063 [US3] Add the `messages.*` keys from contracts/messaging-ui.md to `frontend/src/locales/en.json` and `ar.json`, and confirm `frontend/tests/locales.test.ts` still passes with both files in step

**Checkpoint**: Email works end to end, both directions. This is a deployable increment.

---

## Phase 6: User Story 6 — WhatsApp and SMS Reach the Same Queue (Priority: P2)

**Goal**: Two webhook-driven channels arrive in the same queue with their genuine constraints visible
rather than discovered.

**Independent Test**: Deliver an inbound message on each channel from a number belonging to a known
customer; confirm a ticket; reply from the ticket and confirm delivery.

### Tests for User Story 6

- [X] T064 [P] [US6] Write `backend/tests/channels/webhook-security.test.ts`: a tampered body fails verification and is recorded; verification runs against **raw bytes**, proven by a payload whose re-serialisation differs; an unverifiable request is `401` (FR-054, FR-064, research D5)
- [X] T065 [P] [US6] Write `backend/tests/channels/webhook-idempotency.test.ts`: the same event delivered three times produces one ticket and one message on both channels (FR-055, SC-009)
- [ ] T066 [P] [US6] Write `backend/tests/channels/whatsapp.test.ts`: inbound resolves by phone number; media is retained as an attachment; `replyWindow` refuses free-form outside the window and reports permitted templates; delivery and read state update the message (FR-056–FR-059)
- [ ] T067 [P] [US6] Write `backend/tests/channels/sms.test.ts`: inbound resolves by number; `STOP` records an opt-out and is `ignored` rather than converted; an unreachable number fails visibly; segmentation is reported before send (FR-063, FR-065, FR-067)

### Implementation for User Story 6

- [X] T068 [P] [US6] Create `backend/src/channels/whatsapp/simulator.ts` and `backend/src/channels/sms/simulator.ts` implementing `verifyWebhook`, `parseWebhook`, and `send`, so the verification path is exercised even without a provider
- [X] T069 [P] [US6] Create `backend/src/channels/whatsapp/cloud-api.ts` with signature verification over raw bytes, batch `parseWebhook`, media fetch into attachments, `replyWindow`, and status-webhook handling
- [X] T070 [P] [US6] Create `backend/src/channels/sms/gateway.ts` with signature verification, segmentation reporting, and opt-out keyword recognition
- [X] T071 [US6] Add `POST /api/channels/webhooks/:channel` — controller in `backend/src/controllers/channels/`, route in `backend/src/routes/channels/` — verifying before parsing, recording in `channel_intake`, and **responding `200` as soon as the delivery is recorded**, before conversion, so a provider does not retry into a duplicate
- [X] T072 [US6] Wire opt-out recognition from both adapters into `backend/src/services/opt-out.service.ts`, recording the `source` as `keyword` or `provider`
- [ ] T073 [P] [US6] Add the reply-window state to `frontend/src/components/messages/ReplyComposer.vue`: disable free-form entry and offer permitted templates **before the agent types**, driven by the `window` sibling key (FR-057, FR-058)
- [ ] T074 [P] [US6] Show a recipient's opt-out on the ticket before an agent composes (FR-051), and add the `messages.error.*` keys to both locale files

**Checkpoint**: Three channels arrive in one queue.

---

## Phase 7: User Story 5 — A Visitor Starts a Chat On the Website (Priority: P2)

**Goal**: A visitor converses from a public page; the exchange survives as a ticket.

**Independent Test**: Open the widget on a test page, start a conversation, answer from the dashboard,
close the browser, and confirm the exchange survives as a ticket with the full transcript.

### Tests for User Story 5

- [ ] T075 [P] [US5] Write `backend/tests/chat/session.test.ts`: a first message creates a ticket; the transcript survives the session ending either way; a visitor with no agent available is told and **the ticket still exists** (FR-070, FR-072, FR-074)
- [ ] T076 [P] [US5] Write `backend/tests/chat/isolation.test.ts`: one visitor token reaches exactly one conversation; another conversation is `404`, never `403`; the token is stored hashed and a database read yields no usable capability (FR-075, SC-013)
- [ ] T077 [P] [US5] Extend `backend/tests/ownership.matrix.test.ts` to cover chat sessions, so a future visitor-scoped record cannot be added without a test
- [ ] T078 [P] [US5] Write `backend/tests/chat/stream.test.ts`: a dropped stream reconnects and catches up through `?since=` with no message lost, reusing the Phase 4 mechanism (FR-097)
- [ ] T079 [P] [US5] Write `frontend/tests/widget/widget.test.ts`: the widget renders in both directions from **its own configuration** rather than the host page (FR-076); the live region is polite; the launcher carries an accessible name and a textual unread count

### Implementation for User Story 5

- [X] T080 [P] [US5] Create `backend/src/channels/chat/simulator.ts` — chat's only adapter, since this system is the provider — publishing outbound to the stream hub and using the session id as `providerConversationId`
- [ ] T081 [US5] Create `backend/src/services/chat.service.ts`: open a session issuing a high-entropy opaque token stored hashed, accept visitor messages through intake, and report agent availability (research D14)
- [ ] T082 [US5] Add the three public chat endpoints from contracts/channels-api.md — controller in `backend/src/controllers/chat/`, routes in `backend/src/routes/chat/` — each rate limited through `lib/rate-limit.ts` and none disclosing whether an identity is known (FR-078, FR-106)
- [ ] T083 [US5] Add the visitor SSE stream reusing the generalised hub from T028, keyed by conversation, with `?since=` catch-up identical in shape to Phase 4's notification stream
- [ ] T084 [P] [US5] Create `frontend/src/widget/main.ts` and `frontend/src/widget/ChatWidget.vue`: scoped styles, one documented `z-index`, direction from its own configuration, focus trapped while open and returned to the launcher on close, arriving messages announced politely (FR-076, FR-077)
- [ ] T085 [P] [US5] Create the agent chat console in `frontend/src/views/DashboardView.vue` consuming the same transport, announcing arrivals politely and never stealing focus or presenting modally
- [X] T086 [P] [US5] Add the `widget.*` keys from contracts/messaging-ui.md to both locale files

**Checkpoint**: Four channels. The public surface now exists.

---

## Phase 8: User Story 4 — One Customer, One Conversation (Priority: P2)

**Goal**: Everything said to and by one customer, across every channel, in one chronological place.

**Independent Test**: Give one customer correspondence on two channels across two tickets; open the
customer; confirm one ordered timeline with channel, direction, and time on each entry.

**Why here**: Deferred behind US5 and US6 so its independent test has genuinely more than one channel
to work with.

### Tests for User Story 4

- [X] T087 [P] [US4] Write `backend/tests/timeline/ordering.test.ts`: entries across two channels and two tickets order by `occurred_at` and **not** by `created_at`, proven by inserting a message that arrived earlier but was recorded later (FR-092)
- [X] T088 [P] [US4] Write `backend/tests/timeline/visibility.test.ts`: a ticket the caller may not view contributes no entries and `total` counts only what they may see (FR-090)
- [X] T089 [P] [US4] Write `backend/tests/timeline/correspondence-only.test.ts`: internal notes and ticket history never appear, asserted against a customer that has all three (FR-087a, SC-006)
- [ ] T090 [P] [US4] Write `frontend/tests/timeline/timeline.test.ts`: channel, direction, time and ticket are identifiable without colour; each entry leads to its ticket; the two empty states are distinguished

### Implementation for User Story 4

- [X] T091 [US4] Create `backend/src/services/timeline.service.ts` joining `messages` through `tickets` on `customer_id` — **reading `messages` and nothing else** — paged, ordered by `occurred_at`, filtered by ticket visibility
- [X] T092 [US4] Add `GET /api/customers/:id/timeline` behind `customers:view` — controller in `backend/src/controllers/timeline/`, route in `backend/src/routes/timeline/` — with no separate permission key, per data-model.md
- [ ] T093 [P] [US4] Create `frontend/src/views/CustomerTimelineView.vue` and `frontend/src/components/timeline/TimelineEntry.vue` with the two distinguished empty states from contracts/messaging-ui.md
- [ ] T094 [US4] Add a timeline link to Phase 4's `frontend/src/components/tickets/CustomerContextPanel.vue` without otherwise rebuilding it (FR-093)
- [X] T095 [P] [US4] Add the `timeline.*` keys to both locale files

**Checkpoint**: The Definition of done is now reachable — every clause has an implementation.

---

## Phase 9: User Story 7 — A Form On the Website Becomes a Ticket (Priority: P3)

**Goal**: An administrator defines a bilingual form; a visitor's submission becomes a legible ticket.

**Independent Test**: Define a form with several fields, submit it as a visitor, and confirm a ticket
with each answer attributed to its question in the submission's language.

### Tests for User Story 7

- [X] T096 [P] [US7] Write `backend/tests/forms/submission.test.ts`: a submission creates a ticket carrying each answer with the question it answers; required-field validation is enforced server-side and names the failing field; `defaultCategory` and `defaultPriority` outside Phase 3's taxonomy are refused (FR-082, FR-083, FR-084)
- [X] T097 [P] [US7] Write `backend/tests/forms/versioning.test.ts`: editing a definition does not change what an earlier ticket says, because the submission carries its own copy of the labels (FR-085)
- [X] T098 [P] [US7] Write `backend/tests/forms/rate-limit.test.ts`: repeated automated submissions are refused with `429` without affecting a genuine submission (FR-086)

### Implementation for User Story 7

- [X] T099 [P] [US7] Create `backend/src/channels/form/inbound.ts` building the message body from answers **together with the label text as asked**, with all `threadHints` null
- [X] T100 [US7] Create `backend/src/services/form.service.ts` for definitions and submissions, validating required fields server-side and category and priority against Phase 3's declared taxonomy
- [X] T101 [US7] Add the `forms:manage` admin endpoints and the public `POST /api/public/forms/:slug/submissions` per contracts/channels-api.md, the latter rate limited through `lib/rate-limit.ts`
- [ ] T102 [P] [US7] Create `frontend/src/views/admin/FormBuilderView.vue` showing both language inputs together, so a missing translation is obvious at authoring time
- [ ] T103 [P] [US7] Create the public form renderer with validation errors announced to screen readers, not only shown in colour
- [X] T104 [P] [US7] Add the `forms.*` keys to both locale files

**Checkpoint**: All five channels arrive as tickets.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [ ] T105 [P] Create `frontend/src/views/admin/ChannelSettingsView.vue` and the `channels:manage` endpoints, never displaying a credential and showing no field that would accept one, with `isEnabled: true, isConfigured: false` surfaced prominently (FR-006)
- [ ] T106 [P] Add an administrator view of failed and ignored `channel_intake` rows with a reprocess action, so FR-037, FR-038 and FR-101 have a surface rather than only a table
- [ ] T107 [P] Confirm every list this phase introduces is paged or otherwise bounded (FR-111), and every new endpoint enforces its permission server-side (FR-102, FR-103)
- [ ] T108 Verify the layering rule holds (FR-112): no adapter writes to the database, no service imports a vendor SDK, no component calls `fetch` directly, and every route handler delegates immediately
- [ ] T109 [P] Confirm no endpoint discloses whether an address or number belongs to a known customer, by asserting identical responses for a recognised and an unrecognised sender (FR-106)
- [X] T110 Run `npm run lint`, `npm run build`, and the full `npm test`, and confirm every Phase 0–4 test still passes — in particular the Phase 3 and Phase 4 suites, which the `created_by_user_id` relaxation and the note/message separation are most likely to disturb
- [ ] T111 [P] Keyboard pass over every control introduced by this phase in both directions — message thread, reply composer, timeline, both admin views, the public form, and the widget — confirming a visible focus indicator throughout (FR-109)
- [ ] T112 [P] Screen-reader pass confirming an arriving chat message is announced **without stealing focus**, and that focus is trapped in the open widget and returned to the launcher on close (FR-077)
- [ ] T113 [P] RTL pass over every new screen, plus the widget in Arabic **on an English host page** — its direction must come from its own configuration, not the host (FR-076, FR-107)
- [ ] T114 [P] Greyscale pass confirming channel, direction, delivery state, and the note/message distinction all remain distinguishable with colour removed (FR-002, FR-110)
- [ ] T115 Embed the widget on a page with an aggressive CSS reset and its own `z-index` stacking; confirm it renders correctly and does not restyle the host
- [ ] T116 Run the full `specs/006-phase-5-communication-channels/quickstart.md` V1–V9 and V11
- [ ] T117 Run quickstart V10 against **one real provider** — the only check no test can make, and the one that proves the adapter boundary held (SC-015). Confirm too that a production start with a channel still on `simulator` is refused (FR-005c)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup. **Blocks every user story.**
- **US2 (Phase 3)**: Depends on Foundational.
- **US1 (Phase 4)**: Depends on **US2** — intake attributes through the resolver.
- **US3 (Phase 5)**: Depends on US1 — there is nothing to reply to until a conversation exists.
- **US6 (Phase 6)**: Depends on US1 and US3 for the intake and send paths it reuses; independent of
  US5 and US7.
- **US5 (Phase 7)**: Depends on Foundational T028 (the generalised hub) and on US1's intake service.
- **US4 (Phase 8)**: Depends on messages existing on **two** channels — hence its placement.
- **US7 (Phase 9)**: Depends on US1's intake service only. Genuinely independent of US3–US6 and could
  be moved earlier if a team wanted it sooner.
- **Polish (Phase 10)**: Depends on all desired stories.

### Within Each User Story

- Tests are written first and must fail before implementation.
- Migrations before models; models before services; services before endpoints; endpoints before
  interface.
- Adapters before the intake path that calls them.

### Parallel Opportunities

- T003–T006 in Setup.
- T008–T015 (migrations), then T019–T021, T024, T026–T027, T029 in Foundational.
- Every test task within a story, in every story.
- T068–T070 (three adapters) in US6.
- **US7 can run in parallel with US3–US6** once US1 is done, by a second developer.
- T111–T115 in Polish, though each needs a person rather than a runner.

---

## Parallel Example: Foundational migrations

```bash
Task: "Create migration ...-alter-customers-add-provisional.cjs"
Task: "Create migration ...-create-messages.cjs"
Task: "Create migration ...-create-message-attachments.cjs"
Task: "Create migration ...-create-channel-intake.cjs"
Task: "Create migration ...-create-channel-settings.cjs"
Task: "Create migration ...-create-chat-sessions.cjs"
Task: "Create migration ...-create-form-definitions.cjs"
Task: "Create migration ...-create-channel-opt-outs.cjs"
```

T007 is excluded: it alters `tickets`, which several later migrations reference.

## Parallel Example: User Story 1 tests

```bash
Task: "Write backend/tests/intake/ledger.test.ts"
Task: "Write backend/tests/intake/threading.test.ts"
Task: "Write backend/tests/intake/closed-ticket.test.ts"
Task: "Write backend/tests/intake/automated-mail.test.ts"
Task: "Write backend/tests/channels/email.test.ts"
```

---

## Implementation Strategy

### MVP

Phases 1, 2, 3 and 4 — Setup, Foundational, US2, US1. That delivers PLAN.md's first clause: a message
from a channel becomes a ticket automatically, attributed correctly, threading correctly. **Stop and
validate with quickstart V1, V2, V3 before going further.**

### Recommended increments

1. **Setup + Foundational** → schema, permissions, adapter boundary. Nothing works; nothing is
   broken.
2. **+ US2 + US1** → MVP. Email arrives. Demo V1–V3.
3. **+ US3** → email works both ways. This is the first genuinely deployable increment: an
   organisation could run on it.
4. **+ US6** → WhatsApp and SMS. Demo V6.
5. **+ US5** → chat and the public surface. Demo V5.
6. **+ US4** → the timeline. Demo V9. **The Definition of done is now met.**
7. **+ US7** → forms. Demo V7.
8. **+ Polish** → admin surfaces, the four manual passes, and V10 against a real provider.

### Parallel Team Strategy

After Foundational: one developer takes US2 → US1 → US3 (the critical path, and the machinery
everything else reuses); a second takes US7 once US1 lands, then US5's widget, which is the largest
piece of isolated frontend work in the phase.

---

## Notes

- [P] = different files, no dependencies on incomplete tasks.
- Commit after each task or logical group.
- **The simulator is not a shortcut.** Every channel's tests run through it by design (research D2),
  which is what makes this phase acceptable without a commercial account — and T117 is the one task
  that cannot be satisfied that way.
- **Two composers, never one.** If a task tempts you toward a shared composer with an `isInternal`
  prop, stop: SC-006 is that the mistake must be unrepresentable, not merely unlikely.
- **The ledger row comes first.** Any intake path that resolves identity or creates a ticket before
  writing `channel_intake` has reintroduced the failure FR-095 exists to prevent.
