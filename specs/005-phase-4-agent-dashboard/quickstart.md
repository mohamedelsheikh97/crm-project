# Quickstart: Phase 4 — Agent Dashboard

**Feature**: `005-phase-4-agent-dashboard` | **Date**: 2026-08-29

How to run Phase 4 and prove it works. Automated checks first, then the scenarios that cannot be
asserted from a test runner — the ones a person has to see.

## Prerequisites

- Node.js 22 LTS, MySQL 8.4 running, `.env` present at the repo root (Phase 0 setup unchanged).
- Phases 0–3 migrated and seeded.
- **New setting**: `DUE_WARNING_LEAD_MINUTES` (default `60`). `config/env.ts` validates it at
  startup, so a bad value fails fast rather than at the first sweep.
- Two browser profiles, or one normal and one private window. **Several checks below need two users
  signed in at once** — that is the only way to see a notification arrive.

## Setup

```powershell
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

`db:seed` adds the Phase 4 permission grants and a small starter set of reply templates in both
languages.

Sign in as the seeded administrator, then confirm the roles screen lists the eight new permissions
(`dashboard:view`, `dashboard:view_any`, `tickets:set_due_date`, `ticket_notes:create`,
`ticket_notes:manage`, `tasks:manage`, `templates:use`, `templates:manage`). If any is missing from
the screen, the catalog and the seeder have drifted apart.

For the manual checks you need at least: one **Supervisor**, and two **Agents** (call them A and B).

## Automated validation

```powershell
npm test                          # both projects
npx vitest run --project backend  # backend only
npx vitest run --project frontend # frontend only
```

Expected coverage for this phase:

| Suite | Proves |
| --- | --- |
| `backend/tests/authorization.matrix.test.ts` | The eight new keys are enforced server-side for every role (SC-011). Extends automatically. |
| `backend/tests/ownership.matrix.test.ts` | **New.** No user can read another user's notifications or tasks by any route (FR-076, SC-012). Generated over record types, so a future user-scoped record cannot be added without a test. |
| `backend/tests/scheduler.test.ts` | A reminder whose time passed while the process was down still fires (FR-063); a due warning fires exactly once; re-saving the same date does not re-fire; changing the date re-arms; a Closed ticket is never warned (FR-045, FR-027). |
| `backend/tests/dashboard/` | Queue scoping, server-side sort and filter, NULL due dates grouped at one end in **both** directions, priority rank matching `taxonomy.ts` (FR-006, FR-008, FR-023). |
| `backend/tests/ticket-notes/` | Mentions resolve, deduplicate, refuse the non-visible, respect the limit, and survive deactivation (FR-035–FR-039). |
| `backend/tests/notifications/` | Persist-before-emit; unread count; mark read and mark all; merged ticket resolves to the survivor (FR-047, FR-052). |
| `backend/tests/tasks/` | Ownership from the session, the one-link constraint, complete/reopen, and the merge repoint (FR-056, FR-065). |
| `frontend/tests/dashboard/`, `notifications/`, `templates/` | Queue ordering and empty states, notification text composed from locale keys in both languages, mention and template pickers by keyboard. |

**If every Phase 4 backend test fails with 403**, the Phase 4 grant seeder was not registered in
`backend/tests/helpers/database.ts`. That is the known trap this project has hit at every phase
boundary; check it before debugging anything else.

## Manual validation

### V1 — The queue (US1)

As Agent A with several assigned tickets: open `/dashboard`. Every ticket assigned to A is listed and
nothing assigned to B is. Sort by priority — Urgent leads, not "High" alphabetically. Filter by
status, then combine with priority. Clear the filters from the empty state message.

Confirm the two empty states differ: filter to something that matches nothing (should offer to clear
the filter), then sign in as an agent with no tickets at all (should say the queue is empty).

### V2 — Due dates and overdue (US1, FR-019–FR-028)

Set a due date on one of A's tickets for tomorrow, and on another for yesterday. The past-dated one
is marked overdue in the queue — **check that the marking survives with colour disabled** (browser
grayscale filter): the badge must still read as overdue.

Sort by due date ascending, then descending. Tickets with no due date stay grouped at one end both
times — they must not drift to the middle.

Open the ticket history: the due-date change is recorded with its previous and new value.

Sign in as a user without `tickets:set_due_date` — the control is gone. Then call
`PUT /api/tickets/:id/due-date` directly with that user's token: it must be refused. Hiding the
control is never the restriction.

Close an overdue ticket. It stops being reported overdue (FR-027).

### V3 — Customer context (US2)

Open a ticket for a customer that has other tickets and recent notes. The panel shows identity,
contacts, other tickets, and notes without a navigation. Change the ticket's status with the panel
open — the ticket stays open and the panel stays visible.

Deactivate the customer, reload: the panel marks them deactivated and the ticket is still workable.

Sign in as a user without `customers:view`: the panel is absent and every ticket action still works.

### V4 — Notes and mentions (US3)

**Two windows.** As Agent A, add a note on a ticket mentioning Agent B. In B's window, the
notification arrives **without a reload**.

Then check the refusals:

- Mention yourself → no notification (FR-040).
- Mention the same person twice in one note → exactly one notification (FR-039).
- Mention someone who cannot view the ticket → refused at composition, with an explanation naming
  them (FR-037).
- Exceed the mention limit → refused, with the limit stated (FR-038).

Deactivate B and reload the ticket: the note still reads correctly and the mention is still
attributed (FR-035).

### V5 — Notifications end to end (US4)

**Two windows.** As the Supervisor, assign a ticket to Agent A. It appears in A's queue and as a
notification, both without a reload (FR-042, US1 scenario 8).

Then the part that matters most:

1. Sign A out. Assign another ticket. Sign A back in — the notification is waiting and unread
   (FR-047, SC-009).
2. With A signed in, stop the backend, assign nothing, restart it. A's client reconnects on its own
   and the unread count is still correct.
3. **Block the stream entirely** (dev tools → block `/api/notifications/stream`). The dashboard must
   remain fully usable, and notifications must still appear on navigation or reload (FR-054, SC-010).
   A broken banner over a working screen is a failure of this check.

Open a notification: it navigates to its ticket and becomes read. Mark all read: the count clears.

Merge a ticket that has a notification pointing at it, then open that notification — it must land on
the **surviving** ticket (FR-052).

### V6 — Tasks and reminders (US5)

Create a task on a ticket with a due date and a reminder a couple of minutes out. It appears under
"My tasks". Wait for the reminder — the notification arrives (FR-044).

Then the one that is easy to get wrong: create a task with a reminder time, **stop the backend before
it fires**, wait past the time, and restart. The reminder must still arrive on the next sweep
(FR-063). This is the check that distinguishes a real scheduler from a timer.

Complete the task — it leaves the outstanding list without disappearing from the record. Reopen it.

Close a ticket that has an outstanding task: the task is surfaced, and the close is **not** refused
(FR-064). Merge a ticket that has a task: the task follows the survivor (FR-065).

Finally, as Agent B, request A's task directly by id — it must not be returned.

### V7 — Templates (US6)

As a user with `templates:manage`, create a template with both Arabic and English bodies, and a
second with English only. As Agent A (`templates:use` only), open the picker from a note composer:

- Search finds both by title and by body.
- Inserting the bilingual one uses the version matching the active language.
- The English-only one is offered **with its language identified**, not silently substituted
  (FR-070).
- Inserted text is editable before saving (FR-068).
- Copy to clipboard works for use outside the application.

Retire a template: it leaves the picker, and a note already written from it is unchanged (FR-071).
Confirm Agent A cannot reach the management screen, and that the API refuses them too.

### V8 — Arabic and RTL

Switch to Arabic and repeat V1, V3, V4, and V5. Check specifically:

- The dashboard's three regions and the customer context panel move to the correct side by document
  direction — no component flipping itself.
- Notification text reads correctly in Arabic, with the actor name and ticket reference in the right
  places. **This is where a server-composed message would show up as untranslated English**, which is
  the whole reason the row carries no sentence.
- An Arabic note body, including one with mentions, stores and redisplays exactly as entered.
- Focus indicators remain visible in RTL.

### V9 — Accessibility

Keyboard only, no mouse, in both languages:

- Reach and operate every queue sort and filter control, the due-date control, the mention picker
  (arrows, Enter, Escape), the template picker, the task controls, and the notification list.
- With a screen reader: while typing a note, have the other window generate a mention. **The arrival
  must be announced without moving focus out of the composer** (FR-083). Focus theft here is the most
  likely regression in this phase.
- Apply a grayscale filter and confirm overdue, escalated, and unread are all still distinguishable
  (FR-084).

## A standing note on V8 and V9

These are not a final pass. Principle I and Principle IV are gates for every screen as it is built —
a component that has never been seen in Arabic is not finished, and one that cannot be operated by
keyboard is not finished either. V8 and V9 are the confirmation, not the first look.
