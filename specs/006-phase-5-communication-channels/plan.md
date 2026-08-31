# Implementation Plan: Phase 5 — Communication Channels

**Branch**: `006-phase-5-communication-channels` | **Date**: 2026-08-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-phase-5-communication-channels/spec.md`

**PLAN.md Reference**: Phase 5 — Communication Channels

**Builds on**: Phase 4 — Agent Dashboard, merged to `main` at `f16301c`

## Summary

Phase 5 gives the system an outside edge. Messages arrive from email, WhatsApp, SMS, a chat widget,
and web forms; they become tickets in the Phase 4 queue without anyone typing them; agents answer
from the ticket on the channel the customer used; and every exchange with one customer is readable
as a single conversation.

Five decisions shape the whole implementation.

**Every channel is an adapter, and the default adapter is a simulator.** Clarifications Q1 fixes the
provider question as a configuration choice rather than a commitment. The seam is a normalised
inbound message: intake, identity, threading, the timeline, and the reply surface are written
against it and never against a vendor payload, so swapping the simulator for a real provider is a
configuration change (research D1, D2). The one thing that must never be possible is a production
process quietly running against a simulator, so `env.ts` refuses to start in that configuration.

**Identity is exact or it is unresolved, and it reuses what Phase 2 built.** Matching is a lookup on
`customer_contacts.value_normalised` through the existing `lib/phone.ts` — the same index Phase 2's
duplicate check uses. The resolver returns one of three outcomes, never a nullable id: `resolved`,
`ambiguous`, `unknown`. An unknown sender creates a provisional customer (Clarifications Q2), which
is a flag on Phase 2's table rather than a second kind of record, so no existing consumer has to
learn about it (research D6, D7).

**Threading is by recorded message identifier, never by subject.** Outbound email carries a
`Message-ID` this system generates and stores; inbound mail threads by `In-Reply-To` and
`References`, falling back to a signed token in the delivery address. FR-023 forbids the subject, and
a subject line is edited, translated, and prefixed differently by every client (research D4).

**One ledger row exists before any message does.** Every accepted delivery is recorded in
`channel_intake` — provider identifier uniquely indexed, raw payload retained, outcome recorded —
before conversion is attempted. That single table is idempotency (FR-007, FR-039, FR-055, FR-094),
nothing-is-lost retention (FR-037, FR-038), and the intake audit trail (FR-101) at once. It is the
Phase 4 ordering rule applied to intake: persist first, act second (research D13).

**The timeline holds correspondence only.** Clarifications Q3. Phase 4's internal notes and Phase 3's
history stay on the ticket. That is not a layout preference — it means the structure Phase 8 will
build a customer-facing view on contains nothing internal to leak, and it is worth defending in
later phases.

**One correction to the spec came out of planning.** The spec assumed a reply to a closed ticket
reopens it "where Phase 3's lifecycle permits". It does not: `closed → open` requires
`tickets:reopen`, which Phase 3 restricted to Supervisors on purpose, and an inbound message holds no
permission. A reply to a closed ticket therefore creates a **new ticket linked to the closed one**
through Phase 3's existing `ticket_links` (research D8). See *Changed during planning*.

## Technical Context

**Language/Version**: TypeScript ~6.0.2 strict on Node.js 22 LTS, both workspaces — unchanged from
Phases 0–4.

**Primary Dependencies**: **Three new backend dependencies, all for email**: `imapflow` (IMAP
collection), `mailparser` (MIME parsing), `nodemailer` (SMTP send). Phases 1–4 added none, and that
streak ends here for a reason recorded in Complexity Tracking: MIME is a standardised format with a
decades-deep tail of real-world malformation, and hand-rolling it means silently mangling customer
messages, which FR-009 forbids. Everything else reuses what exists — Server-Sent Events for chat
(Phase 4's transport), an in-process rate limiter written here, `lib/phone.ts` for normalisation,
Phase 2's attachment storage rules.

**Storage**: MySQL 8.4, `utf8mb4_0900_ai_ci`. **Seven new tables** — `messages`,
`message_attachments`, `channel_intake`, `channel_settings`, `chat_sessions`, `form_definitions`,
`channel_opt_outs` — plus **one new column on `customers`** (`is_provisional`) and **two changes to
`tickets`** (`source` added, `created_by_user_id` relaxed to nullable). No table is dropped or
renamed.

**Testing**: Vitest across both workspaces, backend serially against `crm_support_test`. Every
channel is exercised end to end through its simulator adapter, so the whole phase is testable with no
commercial account (FR-005b, SC-015). The Phase 1 authorization matrix extends automatically over the
four new permission keys; Phase 4's ownership matrix extends to chat sessions. Intake is tested by
calling the processing function directly with a fixture delivery, never by waiting on a poller — the
same discipline Phase 4 applied to the scheduler.

**Target Platform**: Linux/Windows server; evergreen browsers. The chat widget additionally targets
third-party pages the organisation does not control, which is why it is a separate build output
(research D14).

**Performance Goals**: An inbound message becomes a ticket visible in the dashboard within one
collection interval. A chat message reaches the other party within the five-second budget Phase 4
set for its stream (SC-005). Timeline and message lists return without perceptible delay at realistic
volume, with no unbounded load.

**Constraints**:

- Every accepted delivery is a `channel_intake` row before conversion is attempted (FR-095).
- Provider identifiers are uniquely indexed per channel; redelivery is a no-op (FR-094).
- Webhook signatures are verified against the **raw** request bytes, never a re-serialisation (D5).
- Inbound content is never rendered as active content and never interpreted as instruction (FR-008).
- Identity matching is exact on the normalised value; no fuzzy or domain matching (FR-016).
- `tickets.customer_id` stays `NOT NULL`; an unknown sender produces a provisional customer, not a
  customerless ticket (D7).
- Intake never assigns a ticket — assignment stays Supervisor-only (FR-027, Phase 3 Q3).
- Intake never reopens a closed ticket; it links a new one (D8).
- The reply surface and the note surface are structurally distinct components; neither can submit to
  the other's endpoint (FR-044).
- The timeline query returns correspondence only, filtered by ticket visibility (FR-087a, FR-090).
- No channel may run against the simulator in production; startup refuses (FR-005c).
- Single backend process, inherited unchanged from Phase 4 — see Complexity Tracking.

**Scale/Scope**: ~24 new backend endpoints across five channel routers plus timeline and admin, 7 new
tables, 3 schema changes to existing tables, 4 new permission catalog entries, 5 channel adapters
with a simulator each, 3 new frontend views, ~12 new components, and one new frontend build output
(the widget).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### Initial evaluation (pre-research)

| Principle | Assessment |
| --- | --- |
| **I — Bilingual-First & RTL** (NON-NEGOTIABLE) | **At risk in a new way.** The widget renders on a third-party page whose direction the organisation does not control, so it cannot inherit direction from the document root the way every screen since Phase 0 has. Also new: customer content arrives in a script and direction unrelated to the agent's interface language. |
| **II — Security by Default** (NON-NEGOTIABLE) | **At maximum risk, and this is the phase's defining hazard.** Every guard built so far answers "is this known user allowed to do this?". This phase adds unauthenticated public endpoints, untrusted content, third-party webhooks, and — through provisional customers — the first table the outside world can cause rows in. |
| **III — Layered Architecture** (NON-NEGOTIABLE) | **At risk.** Five vendor integrations is five chances for a provider's shape to leak into the service layer, and a mail poller is neither a route nor a service. |
| **IV — Accessibility** | **At risk.** The widget must be operable by keyboard and screen reader on a page whose styles it does not own, and arriving chat messages repeat Phase 4's announce-without-stealing-focus problem in a harder setting. |
| **V — Phase-Gated Delivery** | **Passes.** `/speckit-specify` complete with three clarifications resolved and no markers remaining; this plan precedes `/speckit-tasks`; PLAN.md traceability tables are in the spec. |

**Outcome: proceed to research with four named constraints**, each carried into a decision.

### Post-design re-evaluation

| Principle | Resolution |
| --- | --- |
| **I** | **Passes.** The widget sets its own direction from its configured language rather than inheriting it (FR-076), which is the one place per-component direction is correct precisely because there is no shared root to apply it at — recorded here so it is not mistaken for the per-component flipping Principle I prohibits. Customer content is stored and displayed as sent, with the message's own direction, while every label around it comes from the locale files (FR-107, FR-108). |
| **II** | **Passes with the defence written down.** Public endpoints are enumerated and closed-ended (FR-105): chat, form submission, webhooks, and nothing else. Webhook authenticity is verified against raw bytes before parsing (D5). Untrusted content is never active and never instruction (FR-008). Provisional-customer creation is bounded by per-channel intake rate limits (D11) and by FR-020. No endpoint discloses whether an address is known (FR-106). Four new permission keys are enforced server-side and covered by the generated matrix. |
| **III** | **Passes.** Adapters own every provider particular and expose `receive`/`send` only (D1); services hold the decisions; `lib/` holds the mail poller, the rate limiter, and the generalised stream hub, following the Phase 4 precedent that infrastructure reading no business rules sits outside `services/`. |
| **IV** | **Passes.** The widget carries its own focus management, keyboard operation, and a polite live region for arriving messages (FR-077), reusing the pattern Phase 4 established rather than inventing a second one. FR-110 keeps channel, direction, and delivery state off colour alone. |
| **V** | **Passes.** Artifacts complete; this section is the reviewer's gate before `/speckit-tasks`. |

**Outcome: gate passes with no violations.** Three items are recorded in Complexity Tracking — the
three new dependencies, seven new tables, and the inherited single-process limit. None is a principle
violation; all three are the kind of thing the constitution asks to be justified rather than
absorbed silently.

## Project Structure

### Documentation (this feature)

```text
specs/006-phase-5-communication-channels/
├── plan.md              # This file
├── research.md          # Phase 0 output — D1–D14
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── channels-api.md       # Intake, messages, replies, timeline, admin
│   ├── channel-adapters.md   # The adapter contract and each channel's specifics
│   └── messaging-ui.md       # Screens, the widget, states, i18n keys, a11y contract
├── checklists/
│   └── requirements.md  # Spec quality checklist (complete)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── auth/
│   │   └── permissions.ts                      # + 4 catalog entries (D1)
│   ├── channels/                               # NEW — the adapter boundary (D1)
│   │   ├── types.ts                            # InboundMessage, SendResult, ChannelAdapter
│   │   ├── registry.ts                         # Config → adapter; production refusal (D2)
│   │   ├── email/{simulator,imap-smtp}.ts
│   │   ├── whatsapp/{simulator,cloud-api}.ts
│   │   ├── sms/{simulator,gateway}.ts
│   │   ├── chat/simulator.ts                   # Chat has no external provider
│   │   └── form/inbound.ts
│   ├── config/
│   │   └── env.ts                              # + channel config; simulator-in-production refusal
│   ├── controllers/
│   │   ├── channels/                           # Admin settings, webhooks
│   │   ├── chat/                               # Public visitor endpoints
│   │   ├── forms/                              # Definitions (admin) + submission (public)
│   │   ├── messages/                           # Read thread, send reply, reattribute
│   │   └── timeline/
│   ├── db/
│   │   ├── migrations/                         # 7 new tables + 3 alterations
│   │   └── seeders/                            # Channel permission grants
│   ├── lib/
│   │   ├── mail-poller.ts                      # NEW — IMAP collection loop (D3)
│   │   ├── rate-limit.ts                       # NEW — fixed-window limiter (D11)
│   │   └── notification-hub.ts                 # Generalised to an opaque channel key (D10)
│   ├── models/                                 # 7 new models + 3 model changes
│   ├── routes/
│   │   ├── channels/ chat/ forms/ messages/ timeline/
│   └── services/
│       ├── identity.service.ts                 # NEW — resolve/ambiguous/unknown (D6)
│       ├── intake.service.ts                   # NEW — ledger, threading, conversion (D13)
│       ├── message.service.ts                  # NEW — thread reads, outbound sends
│       ├── chat.service.ts  form.service.ts  timeline.service.ts  opt-out.service.ts
└── tests/
    ├── channels/ chat/ forms/ intake/ messages/ timeline/
    └── ownership.matrix.test.ts                # Extended to chat sessions

frontend/
├── src/
│   ├── components/
│   │   ├── messages/                           # Thread, reply composer, delivery state
│   │   └── timeline/
│   ├── views/
│   │   ├── admin/{ChannelSettingsView,FormBuilderView}.vue
│   │   └── CustomerTimelineView.vue
│   ├── services/  stores/                      # Per the established pattern
│   └── widget/                                 # NEW — separate Vite entry (D14)
│       ├── main.ts
│       └── ChatWidget.vue
└── tests/
    ├── messages/ timeline/ widget/
```

**Structure Decision**: The established two-workspace layout is unchanged. One genuinely new
top-level concept appears in the backend — `src/channels/`, the adapter boundary — placed beside
`src/tickets/` (Phase 3's lifecycle declaration) rather than inside `services/`, on the same
reasoning: it is a declaration and a boundary that several layers read, not a place decisions are
made. One genuinely new frontend output appears — `src/widget/`, a separate Vite entry — because
FR-068 requires embedding on a page that must never receive the authenticated application.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --- | --- | --- |
| **Three new runtime dependencies** (`imapflow`, `mailparser`, `nodemailer`), breaking a four-phase streak of none | PLAN.md names SMTP/IMAP explicitly, and MIME is a standardised format with a deep tail of real-world malformation | Hand-rolling a MIME subset means silently mangling customer messages, which FR-009 forbids, and a parser for untrusted input is a security surface this project should not own. Requiring a JSON-webhook mail vendor instead would force the commercial dependency Clarifications Q1 removed (research D3). |
| **Seven new tables in one phase** (two more than Phase 4) | Five channels with genuinely different shapes, plus the intake ledger and opt-out register that every channel shares | Each is a distinct entity in the spec's Key Entities. The merges available were considered and rejected in research: a separate processed-ids table and dead-letter table hold the same rows (D13), and a separate provisional-sender table duplicates `customers` (D7). Consolidation already happened — `channel_intake` is one table doing what three requirements separately implied. |
| **Single backend process**, inherited | The stream hub and the mail poller are both in-process; two processes would double-collect | Recorded unchanged from Phase 4, which deferred lifting it to Phase 11. This phase does not worsen it, but it does add a second consumer of the assumption: the mail poller must not run twice. Lifting it needs a lock, not a rewrite. |

### Changed during planning

Recorded because each was a decision forced by reading existing code, not a typo, and the next phase
will meet the consequences.

| Planned in the spec | Will be built | Why |
| --- | --- | --- |
| A reply to a closed ticket **reopens** it "where Phase 3's lifecycle permits" (spec Assumptions) | A reply to a closed ticket creates a **new ticket linked to the closed one** | The lifecycle does not permit it. `closed → open` carries `tickets:reopen`, restricted to Supervisors by Phase 3 Clarifications Q2, and an inbound message holds no permission. Honouring the assumption would need a system bypass of the lifecycle gate — a second enforcement path, which is the failure Phase 3's generated matrix exists to catch (research D8). |
| — | `tickets.created_by_user_id` becomes **nullable**, and `tickets.source` is added | FR-026 needs a system-created ticket to be distinguishable, and the column is currently `NOT NULL`. A seeded system user would appear in user lists and assignment pickers and would break Phase 1's last-administrator tests (research D9). |
| — | `express.json()` gains a `verify` callback capturing the raw body | Webhook signatures are over exact bytes; re-serialising breaks them intermittently. The alternative — mounting webhook routers before the JSON middleware — would split the fixed, commented middleware order in `app.ts` that Phases 0–4 have all respected (research D5). |
| — | `lib/notification-hub.ts` is generalised from `user:{id}` to an opaque channel key | Chat needs per-conversation channels on the same transport. The publish/subscribe surface and the persist-then-emit ordering rule are unchanged; only the key becomes opaque (research D10). |

### Changed during implementation

Recorded because each was a decision forced by the code, not a typo, and the next phase will meet
the consequences.

| Planned | Built | Why |
| --- | --- | --- |
| Three columns relaxed to nullable (`tickets.created_by_user_id`) | **Three columns across three tables**: `tickets.created_by_user_id`, `ticket_history.actor_user_id`, `ticket_links.created_by_user_id` | Research D9 reasoned about tickets and stopped there. Phase 5 is the first phase in which the system acts without a person, and *every* table that records who did something meets it: intake raises a ticket, records that it happened, and — under the closed-ticket rule — links two tickets. One idea, three columns. The seeded "system user" alternative gets worse with each one. |
| Webhook responds `200` immediately, converts after | **Converts, then responds** | The first draft acknowledged before `intake.accept` had written the ledger row, so it promised to remember something not yet written down, and made every conversion failure invisible because the response had already gone. The work is bounded and the ledger makes a provider retry harmless. Being briefly slow beats being confidently wrong. |
| — | `hookTimeout` raised from 30s to 90s in `vitest.config.ts` | `setupTestDatabase` shells out to `sequelize-cli db:migrate` once per file; eleven new migrations pushed the slowest file past the old budget. A timeout tuned to yesterday's schema fails for a reason unrelated to the test it kills. |
| — | Bug found and fixed: automated-mail detection treated an **absent** `Return-Path` as an empty one | Most mail arriving over IMAP has no `Return-Path` — the header is added by the receiving MTA and frequently stripped. Conflating absent with empty classified *every ordinary message* as automated, which would have meant no email ever became a ticket. Caught by `intake/automated-mail.test.ts`. |
| — | Bug found and fixed: an outbound reply returned with `author: null` | `Message.create` hydrates no association, so a sent reply rendered as though nobody sent it, against FR-046. The author is now attached from the actor rather than reloaded. |
| — | Pre-existing Phase 4 gap fixed: `loadNotes()` was never called on mount | Opening a ticket showed an empty note thread until you posted a note. Found while wiring the message thread beside it; both now load with the ticket. |

### Non-violations worth recording

- **No `timeline:view` permission key.** The timeline is reachable to anyone holding `customers:view`
  and is filtered by ticket visibility (FR-090). A key every role holds unconditionally cannot refuse
  anything — the same reasoning Phase 4 applied when it declined to add `notifications:view`.
- **The widget setting its own direction** is not the per-component flipping Principle I prohibits.
  Principle I forbids components overriding a shared document root; the widget has no shared root to
  inherit from, because it renders inside a page the organisation does not control.
- **`src/channels/` outside `services/`** is not a new layer. It follows `src/tickets/lifecycle.ts`
  and `src/auth/permissions.ts`: a declaration several layers read, holding no business decisions.

## Phase closeout

**PLAN.md Phase 5 Definition of done** — _"A message from any channel becomes a ticket automatically
and shows up correctly in the agent dashboard and the customer's timeline."_

| Clause | Delivered by | Verified by |
| --- | --- | --- |
| "A message from any channel becomes a ticket automatically" | `intake.service` + five adapters, each with a simulator | `backend/tests/intake/`, `backend/tests/channels/` — every channel end to end with no commercial account |
| "shows up correctly in the agent dashboard" | Tickets created with `source` flow into Phase 4's queue and notification stream unchanged (FR-028); the message thread sits beside Phase 4's note thread | `backend/tests/messages/`, `frontend/tests/messages/` |
| "and the customer's timeline" | `timeline.service` — correspondence only, ordered by when it happened, filtered by ticket visibility | `backend/tests/timeline/`, `frontend/tests/timeline/` |

**What the automated suite will not verify**, and is therefore owed to `quickstart.md`:

- A real provider. Every test runs against a simulator by construction (D2). The first real-provider
  connection is a configuration exercise the quickstart walks through, and it is the one thing in
  this phase that cannot be proved in CI.
- The widget on a genuinely foreign page — a host with its own CSS reset, its own direction, and its
  own z-index stacking.
- Keyboard and screen-reader operation of the widget, and an arriving chat message announced without
  stealing focus. Phase 4 recorded the same limit for notifications; happy-dom reaches the live
  region's attributes and no further.

**Carried into Phase 6.** SLA clocks start and stop on the transitions declared in
`tickets/lifecycle.ts`, and this phase adds the first ticket transitions that no human caused. Phase 6
must decide whether an inbound message resets a response clock, and must not assume a status change
had an actor.

**Carried into Phase 8.** The timeline holds correspondence only (Clarifications Q3), which is what
makes it structurally safe to build a customer-facing view on. Phase 8 inherits that property and
must not add internal content to the structure. The chat widget's per-conversation opaque token
(D14) is the closest thing this project has to a customer credential, and Phase 8 should decide
deliberately whether to promote it or replace it.

**Carried into Phase 10.** A provisional customer is not an onboarded one (D7). Reporting must not
count them together.

**Carried into Phase 11.** The single-process limit now has two consumers rather than one: the stream
hub and the mail poller. The poller must not run twice.

## Outstanding from earlier phases

- **Constitution Open Item — messaging provider selection.** Newly identified in this phase's
  Clarifications Q1 and not currently listed among the constitution's Open Items alongside the AI
  (Phase 9) and ERP (Phase 11) decisions. This phase makes the choice cheap by deferring it behind an
  adapter; recording it in the constitution is an amendment requiring the governance procedure, and
  is **not** performed by this plan.
- **Constitution Open Item — SLA targets before Phase 6.** Still open, still untouched. Phase 4's
  manual due date remains the only date in the system.
- **Phase 4 carried forward**: T103–T106, the manual keyboard, RTL, greyscale, and quickstart passes,
  are unfinished on Phase 4 and are not absorbed by this phase.
- Remaining Open Items (ERP identity for Phase 11, AI provider for Phase 9, branding for Phase 12)
  are untouched and not due.
