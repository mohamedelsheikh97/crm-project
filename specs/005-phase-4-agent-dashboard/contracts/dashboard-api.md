# Contract: Dashboard API

**Feature**: `005-phase-4-agent-dashboard` | **Date**: 2026-08-29

Covers the queue, due dates, internal notes and mentions, tasks, and reply templates. Notifications
and the stream are in [notifications.md](./notifications.md).

Every route requires authentication and carries a permission enforced by route-level
`requirePermission()`. Envelopes follow the shape Phases 1–3 fixed: a read returns the resource
directly, a list returns `{ items, page, pageSize, total }`, a failure returns
`{ "error": { "code", "message", "details" } }` with `details` as `{ field, message }` pairs.

Two rules apply throughout and are not repeated per endpoint:

- **Keys, never labels.** `type`, `status`, `priority`, and every enumerated value travel as keys and
  are rendered through i18n (FR-080). No endpoint returns a display sentence.
- **Ownership is enforced in the service, not the route.** For notifications and tasks, holding the
  permission is necessary but not sufficient — the record must belong to the caller (FR-076). A
  request for another user's record returns `404`, not `403`: whether someone else's task exists is
  itself not the caller's business.

---

## Queue

### `GET /api/dashboard/queue`

**Permission**: `dashboard:view` — or `dashboard:view_any` when `userId` names another user.

**Query**: `userId` (optional), `status` (repeatable), `priority` (repeatable), `overdue` (`true`),
`includeClosed` (`true`), `sort` (`priority` \| `status` \| `age` \| `dueAt`), `direction`
(`asc` \| `desc`), `page`, `pageSize`.

Returns the tickets assigned to the target user. Excludes Closed by default (FR-003) and always
excludes merged tickets (FR-004). Sorting and filtering are applied over the whole queue, never over
the loaded page (FR-008).

```json
{
  "items": [
    {
      "id": 42,
      "reference": "TKT-000042",
      "subject": "لا يمكنني تسجيل الدخول",
      "customer": { "id": 7, "displayName": "شركة النور", "isActive": true },
      "status": "open",
      "priority": "high",
      "dueAt": "2026-08-30T09:00:00.000Z",
      "isOverdue": false,
      "waitingSince": "2026-08-28T09:14:00.000Z"
    }
  ],
  "page": 1,
  "pageSize": 25,
  "total": 37,
  "viewingUser": { "id": 3, "name": "Sara" }
}
```

`isOverdue` is computed **server-side against the server clock** (FR-020) — the client never derives
it, or two agents in different timezones would disagree about what is late. `viewingUser` is present
so the interface can show whose queue is displayed (FR-011).

**Ordering guarantees** (research D7):

- `sort=dueAt` puts tickets with no due date at one end **in both directions** (FR-023).
- `sort=priority` uses the rank declared in `tickets/taxonomy.ts`, not alphabetical order (FR-006).

**Errors**: `403 FORBIDDEN` when `userId` names another user and the caller lacks
`dashboard:view_any` (FR-010).

---

## Due dates

### `PUT /api/tickets/:id/due-date`

**Permission**: `tickets:set_due_date`

```json
{ "dueAt": "2026-08-30T09:00:00.000Z", "version": 4 }
```

`dueAt: null` clears it (FR-026). A past date is accepted (FR-024). Carries the Phase 3 optimistic
`version`, as every ticket write does.

Writes a `ticket_history` entry with previous and new value (FR-022). Setting a **new** date re-arms
the approaching-due warning; re-saving the same date does not (FR-045, see
[notifications.md](./notifications.md)).

**Errors**: `403 FORBIDDEN` without the permission — viewing a ticket never implies authority to
change what is late (FR-075); `422 TICKET_MERGED` on a merged ticket; `409` on a stale `version`.

---

## Internal notes

### `GET /api/tickets/:id/notes`

**Permission**: `tickets:view` — anyone who may read the ticket may read its notes.

Oldest first, paged (FR-085).

```json
{
  "items": [
    {
      "id": 9,
      "body": "Checked the logs — @[user:12] can you confirm the tenant?",
      "author": { "id": 4, "name": "Omar", "isActive": true },
      "mentions": [{ "id": 12, "name": "Sara", "isActive": false }],
      "editedAt": null,
      "createdAt": "2026-08-29T08:20:00.000Z"
    }
  ],
  "page": 1, "pageSize": 20, "total": 3
}
```

The body carries `@[user:12]` tokens; the client renders each from the `mentions` array (research
D5). A mentioned user who has since been deactivated still resolves — `isActive: false` lets the
interface mark them without losing the attribution (FR-035).

### `POST /api/tickets/:id/notes`

**Permission**: `ticket_notes:create`

```json
{ "body": "Checked the logs — @[user:12] can you confirm the tenant?" }
```

Mentions are parsed from the body, resolved against active users, and stored as rows. Each distinct
mentioned user gets one notification (FR-043); duplicates in one body produce one (FR-039); a
self-mention produces none (FR-040).

**Errors**:

- `400 MENTION_NOT_VISIBLE` — a mentioned user cannot view this ticket. Refused at composition
  rather than silently notifying someone toward a ticket they cannot open (FR-037). Sibling key
  `mentions` lists the offending users; `{field, message}` does not fit a user summary, the same
  reasoning Phase 2 applied to `duplicates`.
- `400 MENTION_LIMIT` — more mentions than the per-note limit, with the limit in the message
  (FR-038).
- `400 VALIDATION_ERROR` — empty body.

### `PATCH /api/tickets/:ticketId/notes/:noteId`

**Permission**: `ticket_notes:create` for one's own note; `ticket_notes:manage` for another user's
(FR-034).

Sets `editedAt` (FR-033). There is no delete endpoint — notes are part of the record, like
everything else in this project.

### `GET /api/tickets/:id/mentionable-users`

**Permission**: `tickets:view`

**Query**: `q` (search term), bounded result set.

Returns active users who **can view this ticket**, so the picker cannot offer someone the note would
then be refused for (FR-036, FR-037).

---

## Customer context panel

### `GET /api/tickets/:id/context`

**Permission**: `tickets:view` **and** `customers:view`. Without `customers:view` this returns `403`
and the interface omits the panel — the ticket stays fully workable (FR-018).

One request rather than three, because the panel is one region of one screen and three round-trips
would make "without navigating away" feel like navigating away.

```json
{
  "customer": { "id": 7, "displayName": "شركة النور", "isActive": true, "contacts": [ … ] },
  "otherTickets": [ { "id": 51, "reference": "TKT-000051", "subject": "…", "status": "pending" } ],
  "recentNotes": [ { "id": 3, "body": "…", "author": { … }, "createdAt": "…" } ]
}
```

`otherTickets` and `recentNotes` are bounded and most-recent-first (FR-014, FR-015). A deactivated
customer returns normally with `isActive: false` — the panel reports it, the ticket stays workable
(FR-016).

---

## Tasks

All task routes are **ownership-scoped**. `owner_user_id` comes from the session and is never read
from the body (Clarifications Q3, data-model).

### `GET /api/tasks`

**Permission**: `dashboard:view`

**Query**: `status` (`open` \| `completed`), `ticketId`, `customerId`, `page`, `pageSize`.

Returns the caller's tasks only.

```json
{
  "items": [
    {
      "id": 5,
      "title": "Call back about the invoice",
      "dueAt": "2026-09-03T13:00:00.000Z",
      "remindAt": "2026-09-03T12:00:00.000Z",
      "isOverdue": false,
      "completedAt": null,
      "ticket": { "id": 42, "reference": "TKT-000042" },
      "customer": null
    }
  ],
  "page": 1, "pageSize": 25, "total": 4
}
```

### `POST /api/tasks`

**Permission**: `tasks:manage`

```json
{ "title": "Call back about the invoice", "dueAt": "…", "remindAt": "…", "ticketId": 42 }
```

At most one of `ticketId` / `customerId` (FR-056). No owner field exists — a request that sends one
is rejected by the schema rather than silently ignored, so an attempt to give someone a task fails
loudly.

**Errors**: `400 VALIDATION_ERROR` — empty title, both links supplied, or an unknown owner field.

### `PATCH /api/tasks/:id`

**Permission**: `tasks:manage`, owner only.

Changing `remindAt` clears `reminded_at`, re-arming the reminder; clearing it cancels the pending
reminder (FR-062).

### `POST /api/tasks/:id/complete` · `POST /api/tasks/:id/reopen`

**Permission**: `tasks:manage`, owner only.

Complete sets `completedAt` and removes the task from the outstanding list without deleting it
(FR-059); reopen clears it (FR-060).

**Errors**: `404` when the task belongs to another user — never `403`.

---

## Templates

### `GET /api/templates`

**Permission**: `templates:use`

**Query**: `q` (matches title and body in either language), `page`, `pageSize`. Retired templates are
never returned here (FR-071).

```json
{
  "items": [
    { "id": 2, "titleEn": "Password reset", "titleAr": "إعادة تعيين كلمة المرور",
      "bodyEn": "…", "bodyAr": "…", "availableLanguages": ["en", "ar"] }
  ],
  "page": 1, "pageSize": 20, "total": 6
}
```

`availableLanguages` is what makes FR-070 implementable: the picker offers the version matching the
active language, and when only one exists it offers that one **with its language identified** rather
than silently substituting.

### `POST /api/templates` · `PATCH /api/templates/:id` · `POST /api/templates/:id/retire`

**Permission**: `templates:manage` (FR-069)

At least one complete language pair (title + body) is required; `zod` enforces it at the controller
boundary. Retiring removes the template from the picker and changes nothing already written from it
(FR-071).

All three write to the Phase 1 audit log (FR-077). Note, task, and notification activity does not —
flooding the log an investigator reads would make it useless.

---

## Error codes introduced by this phase

| Code | Status | Meaning |
| --- | --- | --- |
| `MENTION_NOT_VISIBLE` | 400 | A mentioned user cannot view this ticket (FR-037). Sibling key `mentions`. |
| `MENTION_LIMIT` | 400 | More mentions than the per-note limit (FR-038). |
| `TEMPLATE_LANGUAGE_REQUIRED` | 400 | Neither a complete English nor a complete Arabic pair was supplied (FR-070). |
| `TEMPLATE_RETIRED` | 409 | Insert attempted against a retired template. |

Status codes follow the codebase as built in Phases 1–3, which the contract originally
misstated: `VALIDATION_ERROR` is **400**, and `TICKET_MERGED` is **422**, not 409. 409 is
reserved for optimistic-lock conflicts.

Existing codes are reused unchanged: `FORBIDDEN`, `VERSION_CONFLICT`, `TICKET_MERGED`,
`VALIDATION_ERROR`, `NOT_FOUND`.
