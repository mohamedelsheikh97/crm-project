# Phase 4 Research: Agent Dashboard

**Feature**: `005-phase-4-agent-dashboard` | **Date**: 2026-08-29

Decisions taken before design, each one resolving something the spec deliberately left as *what*
rather than *how*. Every decision is traceable to a spec requirement, and every rejected alternative
is recorded so a later phase does not re-litigate it blind.

## Observed starting state

Read from the merged `main` at `2e9fc4b` (Phase 3), not assumed:

- **Auth**: a 15-minute access token in memory on the client, sent as `Authorization: Bearer`.
  The refresh token is an httpOnly cookie. `authenticate` verifies the token then **reloads the
  user's current row every request** — no role or permission claims travel in the token.
- **Authorization**: `requirePermission(key)` middleware over a declared catalog in
  `backend/src/auth/permissions.ts` (`module:action` strings). Grants are seeded per phase and keyed
  by string, so a new module needs no migration. A generated matrix test walks role × key.
- **Layering**: `routes → controllers → services → models`, enforced by review. Declarations that
  every layer reads (`permissions.ts`, `tickets/lifecycle.ts`, `tickets/taxonomy.ts`) live outside
  `services/` on purpose.
- **Tickets**: `tickets` has `assignee_user_id`, `status`, `priority`, `merged_into_ticket_id`, and
  optimistic-locking `version`. There is no `reference` column — it is derived. There is **no due
  date column**, and **no scheduler, job queue, or real-time transport anywhere in the project**.
- **Notes precedent**: `customer_notes` — `author_user_id`, `body`, `edited_at` separate from
  `updated_at`, no visibility column. Permission keys `notes:create` / `notes:manage`.
- **History**: `ticket_history` is append-only with `TICKET_EVENTS`, written in the same transaction
  as the audit log, with a deny-list scrub on free text.
- **Frontend**: Vue 3.5 `<script setup>`, Pinia 3, vue-i18n 11, vue-router 4, Tailwind 4. All HTTP
  goes through `frontend/src/services/http.ts`, which owns a shared single-flight refresh on 401.
- **Testing**: Vitest projects — `backend` (node + supertest against a real `crm_support_test`
  schema, `fileParallelism: false`) and `frontend` (happy-dom + `@vue/test-utils`). Seeders are
  required directly by `backend/tests/helpers/database.ts`; **a new phase's grant seeder must be
  added to that list or every test in the phase fails with a 403 that looks like a permission bug.**

---

## D1. The real-time transport

**Decision**: **Server-Sent Events over a plain Express 5 route**, consumed on the client with
`fetch()` + `ReadableStream` — deliberately **not** the browser's `EventSource`. No new dependency.

```text
GET /api/notifications/stream       Authorization: Bearer <access token>
    → 200, Content-Type: text/event-stream, connection held open
    → server writes `data: {"id":…,"type":…}\n\n` per notification for this user
```

**Rationale**:

1. **The traffic is one-directional.** Every requirement in the spec (FR-042–FR-046) is server →
   client. Nothing needs a client→server channel, so a bidirectional protocol buys nothing.
2. **No new dependency.** The constitution fixes the stack and requires an amendment to deviate.
   Express 5 can hold a response open and write to it; SSE is a wire format, not a library.
3. **`EventSource` cannot set an `Authorization` header.** This project's access token is a Bearer
   header held in memory and never a cookie. Using `EventSource` would force the token into the
   query string, where `pino-http` logs it with the URL — a credential in the logs, against
   Principle II. Consuming the stream with `fetch` keeps the existing header scheme and lets the
   route reuse `authenticate` unchanged.
4. **Correctness never depends on the stream.** FR-047 requires notifications to persist first and be
   waiting at next sign-in, so the stream is an accelerant. That makes reconnection semantics cheap:
   drop, back off, reconnect, ask for anything missed.

**Reconnection and token expiry**: exponential backoff (1s → 30s, capped, jittered). A `401` on the
stream is handled by the same single-flight refresh `http.ts` already owns, then a reconnect. On every
(re)connect the client calls the ordinary unread endpoint, so a gap in the stream self-heals
(FR-054, SC-010).

**Alternatives rejected**:

| Alternative | Rejected because |
| --- | --- |
| `socket.io` | A dependency and a protocol for bidirectional messaging we do not have. |
| Bare `ws` | Still a dependency, and WebSocket auth would need a token in the URL or a post-connect handshake — more moving parts than SSE for the same one-way delivery. |
| Native `EventSource` | Cannot send the `Authorization` header; forces the access token into a logged URL. |
| Short polling | SC-008's five-second ceiling means polling every ≤5s for every signed-in agent — strictly more database load than an idle held connection, and still slower. |

**Known limit, recorded deliberately**: an SSE hub in process memory means **one backend process**.
Running two would leave a notification delivered live only to agents connected to the emitting
process — the persisted row is still correct, so nobody loses a notification, but the "instant" half
degrades to "on next poll or reload" for some users. Horizontal scaling is a Phase 11 deployment
concern; when it arrives, the hub needs a shared bus. This is written into `plan.md` Complexity
Tracking rather than solved speculatively.

## D2. Notifications: storage, shape, and language

**Decision**: a `notifications` table written **before** anything is emitted, plus an in-process
`EventEmitter` hub in `backend/src/lib/notification-hub.ts`. The row is the truth; the hub is a
loudspeaker.

**The row stores a type and parameters, never a rendered sentence.** A notification says
`type: 'note.mentioned'`, `actor_user_id: 12`, `ticket_id: 88` — the client composes the text from
its locale files. Two reasons this is not negotiable: Principle I forbids hardcoded strings, and the
same notification may be read by an Arabic user and an English one, so the language cannot be decided
at write time. Actor and ticket details are joined at read time, so a renamed user's old
notifications read correctly.

**Types** (FR-042–FR-045): `ticket.assigned`, `note.mentioned`, `task.reminder`, `ticket.due_soon`.

**Merged tickets** (FR-052): the subject ticket is resolved through Phase 3's existing merge chain at
read time, so a notification never lands on an unworkable ticket. Storing the survivor at write time
would be wrong — the merge may not have happened yet.

**No permission key of its own.** Notifications are ownership-scoped: the recipient is the only
reader, enforced in the service (FR-051, FR-076). See D6 for how FR-073 is satisfied without a key
that every role holds unconditionally.

## D3. Due dates, and what "approaching due" means

**Decision**: two columns on `tickets` — `due_at DATETIME NULL` and `due_warning_sent_for DATETIME
NULL`.

`due_warning_sent_for` stores **the due date value that was warned about**, not a boolean and not a
timestamp of the warning. That single choice implements FR-045 exactly:

- warn when `due_warning_sent_for IS NULL OR due_warning_sent_for <> due_at`;
- re-saving the same date does not re-fire (the values still match);
- moving the date to a genuinely new value arms a new warning, which is the correct behaviour;
- no separate bookkeeping table.

**Threshold**: one system-wide lead time, `DUE_WARNING_LEAD_MINUTES` (default 60), validated in
`config/env.ts` like every other setting. The spec's Assumptions fix it as system-wide; per-priority
and per-customer thresholds are Phase 6 policy.

**Clock** (FR-020): `DATETIME` stored in UTC and compared against the server clock in the service —
never the browser's. The client formats for display only.

**Why a column and not a computed target**: Clarifications Q1. FR-028 additionally requires that
nothing consuming the date assumes a human set it, so the queue sort, the overdue indicator, and the
warning all read `due_at` and nothing else. Phase 6 can populate `due_at` from an SLA policy and
every consumer keeps working.

## D4. Scheduling reminders and warnings without a job queue

**Decision**: an in-process ticker, `backend/src/lib/scheduler.ts`, started from **`server.ts` and
not `app.ts`**, running every 60 seconds. No new dependency, no cron library.

Placement matters: tests import `app`, so starting timers in `app.ts` would leave stray intervals in
every test run. `server.ts` is the only place that owns process lifetime.

Two queries per tick, both written so that **missing a tick is harmless**:

```text
due task reminders   remind_at <= now  AND reminded_at IS NULL
due-soon warnings    due_at <= now + lead  AND status is workable  AND not merged
                     AND assignee_user_id IS NOT NULL
                     AND (due_warning_sent_for IS NULL OR due_warning_sent_for <> due_at)
```

The reminder query has no lower bound on `remind_at`, which is what makes FR-063 true *by
construction*: a reminder whose time passed while the process was down is still matched on the next
tick after restart, because the only thing that stops it being matched is `reminded_at` being set.
There is no catch-up code path to forget to write.

**Testability**: the tick function is exported and called directly by tests, so no test waits on a
timer. The interval is a thin wrapper.

**Known limit**: same single-process constraint as D1 — two processes would double-fire. The
`reminded_at`/`due_warning_sent_for` writes happen in the same transaction as the notification
insert, so a race duplicates at worst, never loses; but multi-process operation needs a lock before
it is safe. Recorded in Complexity Tracking.

**Alternatives rejected**: `node-cron` (a dependency for a `setInterval`); lazy evaluation on request
(a reminder would only fire when its owner happened to load a page — the opposite of "the system
speaks first"); a database event scheduler (moves logic out of the service layer, against Principle
III).

## D5. Ticket notes and mentions

**Decision**: `ticket_notes` mirroring `customer_notes` (author, body, `edited_at` distinct from
`updated_at`), plus a `ticket_note_mentions` join table.

**Why not one polymorphic notes table.** Merging `customer_notes` and `ticket_notes` into a
`notable_type`/`notable_id` table would be a speculative abstraction the constitution prohibits, and
the two have genuinely different permissions (`notes:*` vs `ticket_notes:*`). Two small tables that
say what they are beat one that needs a discriminator to be read.

**Why mentions are rows, not just text.** A join table makes FR-039 a unique constraint
`(note_id, user_id)` rather than dedupe logic, makes "who was mentioned" queryable without parsing,
and keeps FR-037's refusal a real check against a real user.

**Body storage**: the body holds a stable token — `@[user:12]` — and the client renders the current
display name from the mention rows. Storing the name inline would go stale on rename and misattribute
after deactivation, breaking FR-035 and FR-041. The token is opaque to the scrubber and safe to
store.

## D6. Permission catalog additions

**Decision**: **eight** new catalog entries, in the existing `module:action` shape.

| Key | Governs | Spec |
| --- | --- | --- |
| `dashboard:view` | Own queue, own notifications, own tasks | FR-001, FR-073 |
| `dashboard:view_any` | Another user's queue | FR-010, FR-011, FR-074 |
| `tickets:set_due_date` | Setting, changing, clearing a due date | FR-025, FR-075 |
| `ticket_notes:create` | Writing an internal note, and editing one's own | FR-029, FR-033 |
| `ticket_notes:manage` | Editing another user's note | FR-034, FR-074 |
| `tasks:manage` | Creating, completing, reopening one's own tasks | FR-055, FR-060 |
| `templates:use` | Searching, previewing, inserting a template | FR-066, FR-067 |
| `templates:manage` | Creating, editing, retiring templates | FR-069, FR-074 |

**On FR-073 and notifications.** There is no `notifications:view` key. A permission that every role
holds unconditionally and that never refuses anything is not a gate — it is noise in the roles screen
and a row in the matrix test that can never fail. The route is gated by `dashboard:view`, and the
*real* control is ownership, enforced in the service and verified by the isolation matrix in D10
(SC-012). This is the same reasoning Phase 3 applied to `tickets:manage_any`, which is conditional
and never a route gate.

**Grants**: Agent gets `dashboard:view`, `ticket_notes:create`, `tasks:manage`, `templates:use`, and
`tickets:set_due_date`. Supervisor adds `dashboard:view_any`, `ticket_notes:manage`, and
`templates:manage`. Administrator holds the whole catalog, as established.

Giving an Agent `tickets:set_due_date` is deliberate: a due date in this phase is a promise the person
doing the work made, and Phase 3 already trusts an Agent to resolve and close. The key exists so the
authority is *separable* (FR-075), not because it is withheld today.

## D7. The queue query

**Decision**: one service-layer query with server-side sort, filter, and paging (FR-008, FR-009).

Two ordering details that are easy to get wrong and are therefore fixed here:

- **NULL due dates** (FR-023): `ORDER BY (due_at IS NULL), due_at ASC|DESC`. MySQL would otherwise
  sort NULLs first ascending and last descending, so "no due date" would drift around as the user
  toggles direction. The leading expression pins them to one end in both directions.
- **Priority** (FR-006): `priority` is a string column, so the rank comes from the existing
  `tickets/taxonomy.ts` ordering, rendered into a `FIELD(...)` expression from that declaration —
  never a second hardcoded list that can drift from the first.

**Indexes**: `(assignee_user_id, status)` for the queue, `(due_at)` for the due-soon sweep,
`(user_id, read_at)` on notifications for the unread count, `(owner_user_id, completed_at)` on tasks.

## D8. Reply templates

**Decision**: a `reply_templates` table with per-language title and body columns
(`title_en`, `title_ar`, `body_en`, `body_ar`), `retired_at` for soft retirement (FR-071), and an
author reference.

Both languages are nullable but **at least one must be present**, validated with `zod` at the
controller boundary. FR-070's "when only one language is present, offer it with its language
identified" is then a real state rather than an edge case bolted on.

**Retirement, not deletion** (FR-071): consistent with every other record in this project — customers
deactivate, tickets merge, nothing is destroyed.

## D9. Tasks

**Decision**: a `tasks` table owned by exactly one user, with at most one link.

- `owner_user_id` is set from the session and is **not** a request field. Clarifications Q3 makes
  tasks personal; the safest expression of that is an ownership column the client cannot influence.
- `ticket_id` and `customer_id` are both nullable, at most one non-null — enforced in the service and
  by a check constraint, so the invariant survives a direct write.
- `completed_at` marks completion (FR-059) and `NULL` is the outstanding state; there is no separate
  status column and no delete path.
- **FR-065 touches Phase 3.** The ticket merge service must repoint `tasks.ticket_id` at the survivor.
  This is the one place this phase modifies existing Phase 3 code, and it is listed as an explicit
  integration point in `plan.md` rather than left to be discovered.
- **FR-064** is a response, not a block: closing a ticket returns its outstanding tasks so the
  interface can surface them. Closing is never refused because a task is open.

## D10. Testing approach

**Decision**: extend the established suite, and add one new generated matrix.

1. **Permission matrix** — extends automatically over the eight new keys. The new grant seeder
   **must** be registered in `backend/tests/helpers/database.ts` (see Observed starting state).
2. **Ownership isolation matrix** (new, SC-012): for every user-scoped record — notification, task —
   a second user requesting it directly is refused. Generated over the record types rather than
   hand-written per endpoint, so a future user-scoped record cannot be added without a test.
3. **Scheduler**: the tick function called directly with a controlled clock. Covers a reminder whose
   time passed while "down" (FR-063), a warning firing once (FR-045), and a re-saved date not
   re-firing.
4. **Due-date and queue ordering**: NULL grouping in both directions, priority rank matching
   `taxonomy.ts`, and overdue excluding Closed tickets (FR-027).
5. **SSE**, honestly scoped: the hub and the route's authentication and headers are tested
   directly; a held streaming connection is not driven through supertest. The guarantee the tests
   actually assert is the one the spec relies on — the notification is persisted and retrievable
   (FR-047), so delivery over the stream is an optimisation whose failure mode is covered by the
   catch-up path.
6. **Frontend**: component tests for the notification list, the mention picker, the queue's sort and
   filter controls, and the template picker, in the pattern Phase 3's `frontend/tests/tickets/`
   established.

---

## Resolved unknowns

Every "NEEDS CLARIFICATION" from Technical Context is closed:

| Unknown | Resolved by |
| --- | --- |
| How real-time delivery works without a new dependency | D1 — SSE over Express, consumed via `fetch` |
| How the stream authenticates given a Bearer-header token | D1 — `fetch` keeps the header; `EventSource` rejected |
| Where a due date lives and how a warning fires once | D3 — `due_at` + `due_warning_sent_for` |
| What schedules reminders with no job queue | D4 — in-process ticker started by `server.ts` |
| Whether notes reuse `customer_notes` | D5 — a separate table; no polymorphic abstraction |
| How mentions survive a rename or deactivation | D5 — `@[user:12]` token plus mention rows |
| How many permission keys, and whether notifications need one | D6 — eight keys; notifications are ownership-scoped |
| How NULL due dates and string priorities sort | D7 — leading `IS NULL` expression; rank from `taxonomy.ts` |
| Whether a template can exist in one language | D8 — yes, with at least one required |
| How a task follows a merged ticket | D9 — merge repoints `tasks.ticket_id` |
