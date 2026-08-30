# Implementation Plan: Phase 4 — Agent Dashboard

**Branch**: `005-phase-4-agent-dashboard` | **Date**: 2026-08-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-phase-4-agent-dashboard/spec.md`

**PLAN.md Reference**: Phase 4 — Agent Dashboard

**Builds on**: Phase 3 — Ticket Management (Core), merged to `main` at `2e9fc4b`

## Summary

Phase 4 gives the agent a workspace: their own queue on one screen, the customer beside the ticket,
colleague-to-colleague notes with mentions, personal follow-up tasks, a reply-template library, and —
the genuinely new capability — notifications that arrive without being asked for.

Four decisions shape the whole implementation.

**Real-time delivery is Server-Sent Events over a plain Express route, with no new dependency.** The
traffic is entirely server → client, so a bidirectional protocol buys nothing. The client consumes
the stream with `fetch()` + `ReadableStream` rather than `EventSource`, because `EventSource` cannot
send an `Authorization` header and this project's access token is a Bearer header held in memory —
putting it in a query string would write a credential into `pino-http`'s URL logs. See research D1.

**Every notification is a row before it is an event.** FR-047 requires notifications generated while
a user is signed out to be waiting at next sign-in, so the database is the truth and the stream is an
accelerant. That inverts the usual anxiety about dropped connections: a lost stream costs latency,
never a notification, which is what makes SC-010 achievable and the reconnection logic simple.

**A notification stores a type and parameters, never a sentence.** The same event may be read by an
Arabic agent and an English one, so the text cannot be composed at write time. The row says
`note.mentioned`, `actor_user_id`, `ticket_id`; the client renders from its locale files. This is
Principle I applied to a surface that did not exist before this phase.

**The due date is one nullable column plus one bookkeeping column, and nothing else knows where it
came from.** `due_at` holds the date a person set (Clarifications Q1); `due_warning_sent_for` holds
the date value already warned about, which makes "fire once per due date, and do not re-fire when the
same date is re-saved" a comparison rather than a state machine. FR-028 requires that the queue sort,
the overdue indicator, and the warning all read `due_at` and nothing else — so Phase 6 can populate
it from a computed SLA target without rebuilding a single consumer.

## Technical Context

**Language/Version**: TypeScript ~6.0.2 strict on Node.js 22 LTS, both workspaces — unchanged from
Phases 0–3.

**Primary Dependencies**: **No new dependencies.** Express 5, Sequelize 6 + `mysql2`, `zod`, `pino` /
`pino-http`, `jsonwebtoken`, `bcrypt` on the backend; Vue 3.5 `<script setup>`, Pinia 3, vue-router 4,
vue-i18n 11, Tailwind 4 on the frontend. Server-Sent Events are a wire format Express 5 can write
directly, and the reminder ticker is a `setInterval` — neither needs a library (research D1, D4).

**Storage**: MySQL 8.4, `utf8mb4_0900_ai_ci`. **Five new tables** — `notifications`, `ticket_notes`,
`ticket_note_mentions`, `tasks`, `reply_templates` — and **two new columns on `tickets`**
(`due_at`, `due_warning_sent_for`). No table is dropped or renamed.

**Testing**: Vitest across both workspaces. The Phase 1 permission matrix extends automatically over
the eight new keys; one new generated matrix covers ownership isolation for user-scoped records
(SC-012). The scheduler is tested by calling its tick directly with a controlled clock, never by
waiting on a timer (research D10).

**Target Platform**: Linux/Windows server; evergreen browsers. `ReadableStream` over `fetch` is
required on the client, which every supported browser has.

**Performance Goals**: An assignment or mention reaches a connected agent within five seconds
(SC-008). Queue, note, task, and notification lists return without perceptible delay at realistic
volume, with no unbounded load (SC-018).

**Constraints**:

- Notifications persist before they emit; no delivery path may bypass the row (FR-047, SC-009).
- Notification text is composed client-side from locale keys; the row holds no rendered string
  (FR-080).
- `due_at` is compared against the server clock, never the viewer's device (FR-020).
- Nothing that consumes `due_at` may assume a human set it (FR-028).
- Tasks carry an owner taken from the session, never from the request body (Clarifications Q3).
- Note bodies store `@[user:12]` mention tokens, never inline display names (FR-035, FR-041).
- The scheduler starts in `server.ts`, never `app.ts`, so importing the app in a test spawns no
  timers.
- Single backend process (research D1, D4) — see Complexity Tracking.

**Scale/Scope**: ~20 new backend endpoints, 5 new tables, 2 new ticket columns, 8 new permission
catalog entries, 2 new frontend views and ~10 new components, plus one modification to Phase 3's
merge service (FR-065).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### Initial evaluation (pre-research)

| Principle | Assessment |
| --- | --- |
| **I — Bilingual-First & RTL** (NON-NEGOTIABLE) | **At risk, and the risk is specific.** Notifications are the first server-originated text in the project. If the server composes the message, Principle I is broken at the source and no amount of front-end care recovers it. Constrains the design: the row must carry a type and parameters only. |
| **II — Security by Default** (NON-NEGOTIABLE) | **At risk.** A held streaming connection is a new authentication surface, and the obvious implementation (`EventSource`) forces the token into a logged URL. Also new: three record types scoped by *ownership* rather than by role — notifications, tasks, and one's own notes. |
| **III — Layered Architecture** (NON-NEGOTIABLE) | **At risk.** A scheduler and a stream hub are neither routes nor services. Left unplaced they end up as logic in `server.ts` or in a route handler. |
| **IV — Accessibility** | **At risk.** Content arriving unbidden is the classic screen-reader failure: either it is announced by stealing focus, or it is not announced at all. |
| **V — Phase-Gated Delivery** | **Passes.** `/speckit-specify` complete with three clarifications resolved; this plan precedes `/speckit-tasks`; PLAN.md traceability tables are in the spec. |

**Outcome: proceed to research with four named constraints**, each carried into a decision.

### Post-design re-evaluation

| Principle | Resolution |
| --- | --- |
| **I** | **Passes.** Research D2 fixes the notification row as `type` + parameters; the client renders from `ar.json` / `en.json`. Template bodies are per-language columns (D8) with at least one required, so a one-language template is a declared state rather than a fallback bug. FR-081 covers the dashboard layout, the context panel's side, and the notification list in both directions. |
| **II** | **Passes.** D1 keeps the `Authorization: Bearer` header by consuming the stream with `fetch`, so the stream reuses the existing `authenticate` middleware and no credential reaches a log. D6 adds eight permission keys with server-side enforcement. Ownership scoping is enforced in the service layer and verified by a *generated* isolation matrix (D10.2), not by per-endpoint hand-written tests. FR-079 keeps credentials out of notification and task rows. |
| **III** | **Passes.** `notification-hub.ts` and `scheduler.ts` live in `backend/src/lib/` — infrastructure, not business logic — following the precedent that declarations every layer reads (`permissions.ts`, `tickets/lifecycle.ts`) sit outside `services/`. The hub emits; it decides nothing. The scheduler queries through services and holds no rules of its own. Route handlers delegate immediately, as in Phases 1–3. |
| **IV** | **Passes.** FR-083 requires a polite live region — announced without stealing focus. FR-082 puts the mention picker, template picker, due-date control, and notification list under keyboard operation with a visible focus indicator in both directions. FR-084 forbids colour as the sole carrier of overdue, escalated, and unread. |
| **V** | **Passes.** Artifacts complete; this section is the reviewer's gate before `/speckit-tasks`. |

**Outcome: gate passes with no violations.** Two operational limits are recorded in Complexity
Tracking; neither is a principle violation.

## Project Structure

### Documentation (this feature)

```text
specs/005-phase-4-agent-dashboard/
├── plan.md              # This file
├── research.md          # Phase 0 output — D1–D10
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── dashboard-api.md      # Queue, due dates, notes, tasks, templates
│   ├── notifications.md      # Notification records, the SSE stream, the scheduler
│   └── dashboard-ui.md       # Screens, states, i18n keys, a11y contract
├── checklists/
│   └── requirements.md  # Spec quality checklist (complete)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── auth/
│   │   └── permissions.ts                    # + 8 catalog entries (D6)
│   ├── config/
│   │   └── env.ts                            # + DUE_WARNING_LEAD_MINUTES
│   ├── controllers/
│   │   ├── dashboard/dashboard.controller.ts
│   │   ├── notifications/notifications.controller.ts
│   │   ├── tasks/tasks.controller.ts
│   │   ├── templates/templates.controller.ts
│   │   └── tickets/tickets.controller.ts     # + due date, + notes
│   ├── db/
│   │   ├── migrations/                       # 5 new tables, 2 ticket columns
│   │   └── seeders/                          # Phase 4 grants + starter templates
│   ├── lib/
│   │   ├── notification-hub.ts               # In-process emitter (D1)
│   │   └── scheduler.ts                      # Ticker; started by server.ts (D4)
│   ├── models/
│   │   ├── notification.model.ts
│   │   ├── reply-template.model.ts
│   │   ├── task.model.ts
│   │   ├── ticket-note.model.ts
│   │   └── ticket-note-mention.model.ts
│   ├── routes/
│   │   ├── dashboard/  notifications/  tasks/  templates/
│   │   └── tickets/                          # + due date, + notes routes
│   ├── services/
│   │   ├── dashboard.service.ts              # The queue (D7)
│   │   ├── notification.service.ts           # Persist-then-emit (D2)
│   │   ├── task.service.ts
│   │   ├── template.service.ts
│   │   ├── ticket-note.service.ts            # Notes + mentions (D5)
│   │   ├── ticket.service.ts                 # + due date; merge repoints tasks (D9)
│   │   └── ticket-due.service.ts             # Due-date rules and the sweep (D3)
│   └── server.ts                             # Starts the scheduler — app.ts does not
└── tests/
    ├── dashboard/  notifications/  tasks/  templates/  ticket-notes/
    ├── ownership.matrix.test.ts              # New generated matrix (D10.2)
    ├── scheduler.test.ts                     # Direct tick, controlled clock
    └── helpers/database.ts                   # MUST register the Phase 4 seeder

frontend/
├── src/
│   ├── components/
│   │   ├── dashboard/  (QueueTable, QueueFilters, DueDateBadge, TaskList, TaskForm)
│   │   ├── notifications/ (NotificationBell, NotificationList, NotificationItem)
│   │   ├── tickets/ (CustomerContextPanel, TicketNoteThread, TicketNoteComposer,
│   │   │             MentionPicker, DueDateControl)
│   │   └── templates/ (TemplatePicker, TemplateForm)
│   ├── composables/useNotificationStream.ts  # Connect, back off, catch up
│   ├── locales/ar.json, en.json              # Identical key sets (SC-017)
│   ├── router/index.ts                       # + /dashboard, + /admin/templates
│   ├── services/
│   │   ├── dashboard.service.ts  notifications.service.ts
│   │   ├── tasks.service.ts  templates.service.ts  ticket-notes.service.ts
│   ├── stores/ (dashboard.store.ts, notifications.store.ts, tasks.store.ts)
│   └── views/
│       ├── DashboardView.vue
│       └── admin/TemplatesView.vue
└── tests/
    ├── dashboard/  notifications/  templates/
```

**Structure Decision**: the Phase 1–3 layout continues unchanged, with two placements worth stating
explicitly. First, `backend/src/lib/` holds `notification-hub.ts` and `scheduler.ts` — process
infrastructure that decides nothing, kept out of `services/` for the same reason `permissions.ts` and
`tickets/lifecycle.ts` are. Second, due-date rules get their own `ticket-due.service.ts` rather than
swelling `ticket.service.ts` (already 889 lines), and because Phase 6 will replace the *source* of
the date — a seam on a file boundary is cheaper to replace than a seam inside one.

The customer context panel lives in `components/tickets/`, not `components/customers/`: it is part of
the ticket screen's composition and reads customer data through the existing customers service.

## Integration points with existing phases

Recorded so they are not discovered during implementation:

| Existing code | Change | Why |
| --- | --- | --- |
| `ticket.service.ts` — merge | Repoint `tasks.ticket_id` at the survivor | FR-065 |
| `ticket.service.ts` — assign | Emit `ticket.assigned` notification | FR-042 |
| `ticket.service.ts` — close | Return outstanding tasks in the response | FR-064 |
| `ticket-history.service.ts` | Add events for due date set/changed/cleared and note added | FR-022, FR-078 |
| `auth/permissions.ts` | Eight new catalog entries | D6 |
| `config/env.ts` | `DUE_WARNING_LEAD_MINUTES`, validated at startup | D3 |
| `server.ts` | Start the scheduler | D4 |
| `layouts/DefaultLayout.vue` | Notification bell with unread count, on every screen | FR-048 |
| `tests/helpers/database.ts` | Register the Phase 4 grant seeder | D10 — omitting it fails every Phase 4 test with a misleading 403 |

## Complexity Tracking

> No constitution violations. Two operational limits are recorded here because they are real
> constraints on deployment, not design debt to be paid down now.

| Limit | Why accepted | What it would take to lift |
| --- | --- | --- |
| **Single backend process** — the SSE hub is in process memory | Two processes would still deliver every notification correctly, because the row is written first (FR-047); only the *live* half degrades for agents connected elsewhere. The project has run single-process since Phase 0 and PLAN.md schedules no scaling work before Phase 11. | A shared pub/sub bus behind `notification-hub.ts`. The hub is a single module with one emit path, so the change is local. |
| **Single scheduler instance** — the ticker runs in-process | Same constraint, same phase. Reminder and warning writes happen in the same transaction as the notification insert, so a second process duplicates at worst and never loses. | A lock (advisory row or scheduler election) before the tick. |

### Changed during implementation

Recorded because each one was a decision, not a typo, and the next phase will meet the consequences.

| Planned | Built | Why |
| --- | --- | --- |
| Migration order `notifications` second | `notifications` **last** (`…000006`) | It has foreign keys to `tasks` and `ticket_notes`, so the referenced tables have to exist first. Caught on the first `db:migrate`. |
| `tasks.ticket_id` / `customer_id` with `ON UPDATE CASCADE` | `ON UPDATE RESTRICT` | MySQL refuses a CHECK constraint on a column whose FK carries a referential action that rewrites it. The CASCADE was ceremonial — these are auto-increment keys this project never updates — and the `tasks_one_link` CHECK is not (FR-056). |
| Starter templates seeded in tests | Seeded in the app only, **not** in `tests/helpers/database.ts` | The seeder attributes each template to the seeded administrator through a `RESTRICT` FK, which makes that account undeletable and broke the existing last-administrator tests. Settled rule: the test helper seeds **permissions, not content**. |
| — | `backend/src/lib/clock.ts` added | MySQL `DATETIME` is second-precision. A `new Date()` written and then returned in the same response reports milliseconds the row does not have, so an idempotent retire looked like a change and `due_warning_sent_for <> due_at` compared a truncated column against an untruncated one. Truncating at the stamp fixes all three. |
| `VALIDATION_ERROR` 422, `TICKET_MERGED` 409 in contracts | **400** and **422** | The contract misstated what Phases 1–3 actually built. The code was right; `contracts/dashboard-api.md` was corrected rather than the codebase. |
| — | `mountWithPlugins` gained an optional `pinia` | A test that seeds a store before mounting needs the helper to install *that* instance; otherwise the component resolves a different one and renders an empty state. |

### Non-violations worth recording

- **Five new tables in one phase** is not sprawl: each is a distinct entity in the spec's Key Entities
  section, and the one merge that was available — folding `ticket_notes` into `customer_notes` — was
  rejected in research D5 as a speculative abstraction with different permissions on each side.
- **`ticket-due.service.ts` as a separate service** is not premature layering. It is a deliberate seam
  at the exact boundary Phase 6 will replace (FR-028).
- **No `notifications:view` permission key** is a decision, not an omission (research D6): a key every
  role holds unconditionally cannot refuse anything, and ownership — verified by the generated
  isolation matrix — is the actual control.

## Phase closeout

**PLAN.md Phase 4 Definition of done** — *"An agent can triage their whole queue from one screen
without navigating away, and gets real-time pings for anything urgent."*

| Clause | Delivered by | Verified by |
| --- | --- | --- |
| "triage their whole queue from one screen" | `DashboardView` + `dashboard.service.queue` — server-side sort and filter over the whole queue, priority by declared rank, due dates, two distinct empty states | `backend/tests/dashboard/queue*.test.ts`, `frontend/tests/dashboard/QueueTable.test.ts` |
| "without navigating away" | `CustomerContextPanel` — identity, contacts, other tickets, and recent notes in one call beside the ticket; note thread and composer on the same screen | `backend/tests/dashboard/context.test.ts`, `frontend/tests/dashboard/CustomerContextPanel.test.ts` |
| "real-time pings for anything urgent" | SSE stream + persist-then-emit notifications for assignment, mention, reminder, and approaching due date | `backend/tests/notifications/`, `backend/tests/scheduler.test.ts`, `frontend/tests/notifications/` |

**What is NOT verified by the automated suite**, and is therefore still owed to
`quickstart.md` V1–V9 (tasks T103–T106):

- A held SSE connection driven end to end. The tests cover the hub, the route's authentication, and
  the `?since=` catch-up — which is the guarantee the design actually rests on (research D10.5).
- The three manual passes: keyboard-only operation of every new control in both directions, RTL
  layout, and greyscale legibility.
- The screen-reader check that an arriving notification is announced **without stealing focus**
  (FR-083). This is the single most likely regression in the phase; the component test asserts the
  live region is `polite` and `sr-only`, which is as far as happy-dom can go.

**Carried into Phase 6.** The due date is a *promise a person made*, not a computed target
(Clarifications Q1). Phase 6 must decide whether an SLA target overrides a manually set `due_at`,
sits beside it, or migrates it — and must not assume these dates were machine-generated. FR-028 is
what makes the substitution cheap: every consumer reads `due_at` and nothing else.

**Carried into Phase 6 and beyond.** Tasks are personal (Clarifications Q3), so automation rules
cannot create one for another user. The single-process limit for both the SSE hub and the scheduler
is recorded in Complexity Tracking above; Phase 11 is where it needs lifting.

## Outstanding from earlier phases

- **Constitution Open Item — SLA targets before Phase 6.** Untouched by this phase and still open.
  Clarifications Q1 deliberately avoided pre-empting it: Phase 4 ships a *manual* due date, and
  FR-028 guarantees Phase 6 can substitute a computed target without rebuilding any consumer.
- **Phase 3 carried forward**: assignment stays Supervisor-only, so the dashboard is read-only with
  respect to assignment (FR-012). This plan does not reopen it.
- Remaining Open Items (ERP identity for Phase 11, AI provider for Phase 9, branding for Phase 12)
  are untouched and not due.
