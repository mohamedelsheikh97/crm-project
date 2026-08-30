# Phase 4 Data Model: Agent Dashboard

**Feature**: `005-phase-4-agent-dashboard` | **Date**: 2026-08-29

Five new tables and two new columns on `tickets`. Nothing is dropped or renamed. Every table follows
the conventions Phases 1–3 established: `INTEGER UNSIGNED` surrogate keys, `snake_case` columns,
`created_at` / `updated_at` on every row, `utf8mb4_0900_ai_ci`, and **no destroy path** — records are
completed, retired, or superseded, never deleted.

---

## Changes to `tickets`

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `due_at` | `DATETIME` | yes | `NULL` | When the ticket is expected to be finished. Set manually in this phase (Clarifications Q1). UTC; compared against the server clock, never the viewer's (FR-020). |
| `due_warning_sent_for` | `DATETIME` | yes | `NULL` | **The due date value already warned about** — not a boolean, not the time the warning was sent. |

**Why `due_warning_sent_for` holds a date and not a flag.** FR-045 requires the warning to fire at
most once per due date, and requires re-saving the *same* date not to re-fire it. Comparing
`due_warning_sent_for <> due_at` gives both behaviours with no extra state:

| Situation | `due_at` | `due_warning_sent_for` | Warns? |
| --- | --- | --- | --- |
| Date set, threshold not yet reached | `10:00` | `NULL` | not yet |
| Threshold reached | `10:00` | `NULL` | **yes**, then sets `10:00` |
| Same date re-saved | `10:00` | `10:00` | no |
| Moved to a new date | `14:00` | `10:00` | **yes** when the new threshold is reached |
| Date cleared | `NULL` | `10:00` | no — nothing to warn about |

**Validation and rules**

- `due_at` MAY be in the past (FR-024) — backdating a missed commitment is legitimate.
- Clearing `due_at` sets it to `NULL` (FR-026); `due_warning_sent_for` is left as it is, which is
  harmless because the sweep never matches a `NULL` `due_at`.
- Setting, changing, or clearing writes a `ticket_history` entry with previous and new value
  (FR-022).
- A Closed ticket is never reported overdue (FR-027) — the queue and the sweep both exclude it.
- Requires `tickets:set_due_date` (FR-025); viewing a ticket never implies it (FR-075).

**Indexes**: `idx_tickets_due_at (due_at)` for the due-soon sweep. The existing
`(assignee_user_id, status)` index serves the queue.

---

## `notifications`

One message delivered to one recipient without being asked.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `INTEGER UNSIGNED` PK | no | |
| `user_id` | `INTEGER UNSIGNED` → `users.id` | no | **The recipient.** The only user who may read this row (FR-051). |
| `type` | `VARCHAR(40)` | no | `ticket.assigned` \| `note.mentioned` \| `task.reminder` \| `ticket.due_soon` |
| `actor_user_id` | `INTEGER UNSIGNED` → `users.id` | yes | Who caused it. `NULL` for system-generated (`task.reminder`, `ticket.due_soon`). |
| `ticket_id` | `INTEGER UNSIGNED` → `tickets.id` | yes | Subject, when it concerns a ticket. |
| `task_id` | `INTEGER UNSIGNED` → `tasks.id` | yes | Subject, when it concerns a task. |
| `note_id` | `INTEGER UNSIGNED` → `ticket_notes.id` | yes | The note containing the mention. |
| `read_at` | `DATETIME` | yes | `NULL` = unread. |
| `created_at` / `updated_at` | `DATETIME` | no | |

**No message column, deliberately.** The row carries a type and the identifiers; the client composes
the sentence from `ar.json` / `en.json`. Two reasons this is structural rather than stylistic: the
same row may be read by an Arabic user and an English one, and Principle I forbids a hardcoded string
anywhere. Display names are joined at read time, so a renamed or deactivated actor still reads
correctly (research D2).

**Rules**

- Written **before** anything is emitted to the stream. The row is the truth; the stream is an
  accelerant (FR-047, SC-009).
- Never generated for the actor's own action (FR-053) — checked in the service, not the interface.
- Self-mentions produce nothing (FR-040).
- A `ticket_id` pointing at a merged ticket resolves through Phase 3's merge chain **at read time**,
  so the notification always leads to the survivor (FR-052).
- Contains no credential of any kind (FR-079); there is no free-text column that could carry one.
- Listed newest first, paged and bounded (FR-050).

**Indexes**: `idx_notifications_user_read (user_id, read_at)` — serves both the unread count and the
list; `idx_notifications_user_created (user_id, created_at)` for paging.

---

## `ticket_notes`

An internal, colleague-to-colleague comment on a ticket. Mirrors `customer_notes` from Phase 2
rather than generalising it (research D5).

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `INTEGER UNSIGNED` PK | no | |
| `ticket_id` | `INTEGER UNSIGNED` → `tickets.id` | no | |
| `author_user_id` | `INTEGER UNSIGNED` → `users.id` | no | |
| `body` | `TEXT` | no | Plain text plus `@[user:12]` mention tokens. |
| `edited_at` | `DATETIME` | yes | Separate from `updated_at` for the same reason as `customer_notes`: `updated_at` moves on any write, `edited_at` means *a human changed what this says* (FR-033). |
| `created_at` / `updated_at` | `DATETIME` | no | |

**Why the body stores `@[user:12]` and not a name.** A stored display name goes stale on rename and
misattributes after deactivation, breaking FR-035 and FR-041. The token is resolved against the
mention rows at render time, so the note always shows who was actually meant.

**Rules**

- Internal only. No customer-facing surface may read this table in this or any later phase without a
  decision recorded in that phase's spec (FR-031).
- Requires `ticket_notes:create`; editing another user's note requires `ticket_notes:manage`
  (FR-034). An author may always edit their own.
- Bodies accept Arabic and any non-Latin text (FR-032) — `utf8mb4`, as everywhere.
- Adding a note writes a `ticket_history` entry recording *that* it happened, not the body
  (FR-078) — the history stays a change log, not a second copy of the conversation.
- Readable and attributed after the author is deactivated (FR-035); nothing cascades.

**Indexes**: `idx_ticket_notes_ticket (ticket_id, created_at)`.

---

## `ticket_note_mentions`

Who a note named. A table rather than a parse of the body.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `INTEGER UNSIGNED` PK | no | |
| `note_id` | `INTEGER UNSIGNED` → `ticket_notes.id` | no | |
| `user_id` | `INTEGER UNSIGNED` → `users.id` | no | The mentioned user. |
| `created_at` / `updated_at` | `DATETIME` | no | |

**Unique**: `(note_id, user_id)` — this constraint *is* FR-039. Mentioning the same person twice in
one note cannot produce two notifications, because it cannot produce two rows.

**Rules**

- A mention must resolve to a real, active user at composition time (FR-037). A mention of someone who
  cannot view the ticket is refused with an explanation rather than silently generating a notification
  to a ticket they cannot open.
- Bounded per note (FR-038); the limit is stated to the user when reached.
- Rows survive the mentioned user's deactivation (FR-035).

---

## `tasks`

A personal commitment. Owned by exactly one user and not assignable to another (Clarifications Q3).

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `INTEGER UNSIGNED` PK | no | |
| `owner_user_id` | `INTEGER UNSIGNED` → `users.id` | no | **Taken from the session, never from the request body.** |
| `title` | `VARCHAR(255)` | no | Trimmed on write, as `tickets.subject` is. |
| `due_at` | `DATETIME` | yes | |
| `remind_at` | `DATETIME` | yes | |
| `reminded_at` | `DATETIME` | yes | `NULL` = the reminder has not fired. |
| `completed_at` | `DATETIME` | yes | `NULL` = outstanding. No status column, no delete path. |
| `ticket_id` | `INTEGER UNSIGNED` → `tickets.id` | yes | |
| `customer_id` | `INTEGER UNSIGNED` → `customers.id` | yes | |
| `created_at` / `updated_at` | `DATETIME` | no | |

**Check constraint**: at most one of `ticket_id` / `customer_id` is non-null (FR-056). Enforced in the
service *and* in the schema, so the invariant survives a direct write.

**Why `owner_user_id` is not a request field.** Clarifications Q3 makes tasks personal. The safest
expression of "you cannot give someone a task" is an ownership column the client has no way to
influence — a validation rule can be forgotten, a column that is never read from the body cannot be.

**Rules**

- `reminded_at` is what makes FR-063 true by construction: the sweep matches
  `remind_at <= now AND reminded_at IS NULL`, with no lower bound, so a reminder whose time passed
  while the process was down still fires on the next tick after restart. There is no catch-up code
  path to forget.
- Changing `remind_at` clears `reminded_at`, re-arming the reminder; clearing `remind_at` cancels it
  (FR-062).
- Completing sets `completed_at` (FR-059); reopening clears it (FR-060). Only the owner may do either.
- Merging a ticket repoints `tasks.ticket_id` at the survivor (FR-065) — a change to Phase 3's merge
  service, listed as an integration point in `plan.md`.
- Closing a ticket returns its outstanding tasks so the interface can surface them (FR-064). Closing
  is never refused because a task is open.
- Requesting another user's task is refused (FR-076), verified by the generated ownership matrix.

**Indexes**: `idx_tasks_owner_open (owner_user_id, completed_at)` for the dashboard list;
`idx_tasks_remind (remind_at, reminded_at)` for the sweep; `idx_tasks_ticket (ticket_id)` for the
merge repoint and the ticket panel.

---

## `reply_templates`

A shared library of reusable text. Inserted into the internal note composer or copied to the
clipboard — nothing is sent to a customer in this phase (Clarifications Q2).

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `INTEGER UNSIGNED` PK | no | |
| `title_en` / `title_ar` | `VARCHAR(160)` | yes | |
| `body_en` / `body_ar` | `TEXT` | yes | |
| `retired_at` | `DATETIME` | yes | `NULL` = offered in the picker. |
| `created_by_user_id` | `INTEGER UNSIGNED` → `users.id` | no | |
| `created_at` / `updated_at` | `DATETIME` | no | |

**At least one language pair must be present** — validated with `zod` at the controller boundary,
since MySQL cannot express "not both null" as cleanly as the validator can. FR-070's "when only one
language is present, offer it with its language identified" then describes a legitimate state rather
than a bug worked around.

**Rules**

- Retirement, not deletion (FR-071): a retired template leaves the picker, and text already written
  from it is untouched — the library never rewrites history.
- `templates:use` to search, preview, and insert; `templates:manage` to create, edit, and retire
  (FR-069).
- Management is recorded in the Phase 1 audit log (FR-077). Note, task, and notification activity is
  not — that would flood the log an investigator reads.
- The picker is searchable and bounded, never a full render of the library (FR-072).

**Indexes**: `idx_reply_templates_retired (retired_at)`.

---

## Relationships

```text
users ──< notifications          (recipient; the only reader)
users ──< notifications          (actor, nullable)
users ──< ticket_notes           (author)
users ──< ticket_note_mentions   (mentioned)
users ──< tasks                  (owner — from the session, never the body)
users ──< reply_templates        (creator)

tickets ──< ticket_notes
tickets ──< tasks                (nullable; repointed on merge)
tickets ──< notifications        (nullable subject; resolved through the merge chain on read)
tickets ─── due_at, due_warning_sent_for      (new columns)

customers ──< tasks              (nullable; mutually exclusive with ticket_id)

ticket_notes ──< ticket_note_mentions   (unique per (note, user) — this IS FR-039)
ticket_notes ──< notifications          (nullable subject)
tasks        ──< notifications          (nullable subject)
```

No foreign key cascades to delete. Deactivating a user leaves every note, mention, task, and
notification intact and attributed, exactly as Phases 1–3 established.

## Derived, not stored

- **The queue** is not a table. It is a filtered, sorted, bounded view over `tickets` where
  `assignee_user_id` is the viewer (research D7).
- **Overdue** is not a column. It is `due_at < now()` evaluated against the server clock, excluding
  Closed and merged tickets (FR-020, FR-027).
- **Unread count** is `COUNT(*) WHERE user_id = ? AND read_at IS NULL`, served by
  `idx_notifications_user_read`.
- **A notification's text** is not stored at all — see `notifications` above.
