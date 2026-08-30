# Contract: Notifications, the Stream, and the Scheduler

**Feature**: `005-phase-4-agent-dashboard` | **Date**: 2026-08-29

The one capability in this phase that has no precedent anywhere in Phases 0–3: the system reaching a
user who did not ask.

**The governing rule**: a notification is a **row first, an event second**. Every producer writes to
`notifications` inside its transaction, then hands the saved row to the hub. Nothing emits without
persisting. This is what makes FR-047 and SC-009 true, and it is why losing the stream costs latency
and never a notification.

---

## Notification resource

```json
{
  "id": 88,
  "type": "note.mentioned",
  "actor": { "id": 4, "name": "Omar" },
  "ticket": { "id": 42, "reference": "TKT-000042", "subject": "لا يمكنني تسجيل الدخول" },
  "task": null,
  "noteId": 9,
  "readAt": null,
  "createdAt": "2026-08-29T08:20:03.000Z"
}
```

**There is no message field, and none is to be added.** The client composes the text from
`notification.type.*` keys in `ar.json` / `en.json` with `actor.name` and `ticket.reference` as
parameters. The same row is read by an Arabic agent and an English one, so the language cannot be
decided at write time; and Principle I forbids a hardcoded string regardless (research D2).

`ticket` is resolved **through Phase 3's merge chain at read time**, so a notification about a ticket
that was later merged leads to the survivor rather than a dead end (FR-052). Resolving at write time
would be wrong — the merge may not have happened yet.

### Types

| `type` | Produced when | Actor | Subject |
| --- | --- | --- | --- |
| `ticket.assigned` | A supervisor assigns a ticket (FR-042) | the assigner | ticket |
| `note.mentioned` | A note names a user (FR-043) | the note's author | ticket + note |
| `task.reminder` | A task's `remind_at` passes (FR-044) | none (system) | task |
| `ticket.due_soon` | A ticket nears its `due_at` (FR-045) | none (system) | ticket |

A user is never notified of their own action (FR-053), including a self-mention (FR-040). This is
checked in the notification service, so no producer can forget it.

---

## Endpoints

### `GET /api/notifications`

**Permission**: `dashboard:view`. Returns the **caller's** notifications only — ownership is enforced
in the service (FR-051).

**Query**: `unreadOnly` (`true`), `since` (notification id), `page`, `pageSize`.

Newest first, bounded and paged (FR-050). `since` is what the client calls after a reconnect to
collect anything the stream missed, which is how a dropped connection self-heals (FR-054, SC-010).

```json
{ "items": [ … ], "page": 1, "pageSize": 20, "total": 12, "unreadCount": 3 }
```

`unreadCount` rides along on every page so the badge (FR-048) never needs a second request.

### `POST /api/notifications/:id/read` · `POST /api/notifications/read-all`

**Permission**: `dashboard:view`, recipient only.

Opening a notification marks it read as it navigates (FR-049); `read-all` clears the count in one
action.

**Errors**: `404` for another user's notification — never `403`, which would confirm it exists
(FR-051, SC-012).

### `GET /api/notifications/stream`

**Permission**: `dashboard:view`

```http
GET /api/notifications/stream
Authorization: Bearer <access token>

200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

The connection is held open and each notification for this user is written as it is created:

```text
: connected

data: {"id":88,"type":"note.mentioned","actor":{…},"ticket":{…},"readAt":null,…}

: keep-alive
```

**Authentication**: the ordinary `authenticate` middleware, unchanged. The client consumes this with
`fetch()` + `ReadableStream` rather than `EventSource`, because `EventSource` cannot set an
`Authorization` header and this project's access token is a Bearer header held in memory. Putting it
in a query string would write a credential into `pino-http`'s URL log — see research D1, where the
alternatives are recorded.

**Keep-alive**: a comment line every 30 seconds, so idle proxies do not close the connection and the
client can tell "quiet" from "dead".

**Lifecycle**: the response registers a listener on the hub and removes it on `close`. A connection
per signed-in agent, held in one process — the recorded single-process limit (plan.md Complexity
Tracking).

**Client behaviour** (`useNotificationStream`):

1. Connect on sign-in; reconnect with exponential backoff, 1s → 30s, jittered.
2. On `401`, use the single-flight refresh `http.ts` already owns, then reconnect.
3. On every connect, call `GET /api/notifications?since=<last id>` to collect the gap.
4. If the stream never connects at all, the dashboard works and notifications still arrive on load
   and on the next navigation (FR-054, SC-010).

**Testing note**: the hub and this route's authentication and headers are tested directly; a held
streaming connection is not driven through supertest. The guarantee the tests assert is the one the
spec depends on — the row exists and is retrievable (research D10.5).

---

## The scheduler

`backend/src/lib/scheduler.ts`, started by **`server.ts`, never `app.ts`** — tests import `app`, and
timers started there would leak into every test run (research D4).

Runs every 60 seconds. Two sweeps, both written so that a missed tick is harmless.

### Task reminders (FR-044, FR-063)

```sql
WHERE remind_at <= :now AND reminded_at IS NULL AND completed_at IS NULL
```

**No lower bound on `remind_at`** — that is the whole design. A reminder whose time passed while the
process was down is still matched on the next tick after restart, because the only thing that stops
it matching is `reminded_at` being set. FR-063 holds by construction, with no catch-up code path that
could be forgotten.

Each match: write the notification and set `reminded_at` **in one transaction**, then emit.

### Approaching due dates (FR-045)

```sql
WHERE due_at IS NOT NULL
  AND due_at <= :now + :leadMinutes
  AND status NOT IN ('closed')
  AND merged_into_ticket_id IS NULL
  AND assignee_user_id IS NOT NULL
  AND (due_warning_sent_for IS NULL OR due_warning_sent_for <> due_at)
```

The last clause is FR-045 exactly: fire once per due date, do not re-fire when the same date is
re-saved, arm again when the date genuinely changes. Each match writes the notification and sets
`due_warning_sent_for = due_at` in one transaction.

`leadMinutes` is `DUE_WARNING_LEAD_MINUTES` — one system-wide value, default 60, validated in
`config/env.ts` at startup like every other setting. Per-priority and per-customer thresholds are
Phase 6 policy, deliberately not anticipated here.

Closed tickets are excluded, which is also what keeps FR-027 true.

### Testability

`runScheduledSweeps(now)` is exported and called directly by tests with a controlled clock. The
interval is a thin wrapper around it, so no test waits on a timer. Covered cases: a reminder whose
time passed while "down"; a warning firing exactly once; a re-saved identical date not re-firing; a
changed date re-arming; a Closed ticket never warned.

---

## The hub

`backend/src/lib/notification-hub.ts` — an in-process `EventEmitter`, keyed by recipient id.

It has one method to publish and one to subscribe. **It decides nothing**: no filtering, no
permission check, no formatting. Producers decide what to write; the service decides who receives it;
the hub only carries an already-persisted row to whichever connections are listening (Principle III).

Everything that emits does so **after** its transaction commits. A notification that exists in the
database but was never emitted is a latency bug the catch-up query fixes; a notification emitted for
a transaction that then rolls back would be a lie no query can fix.
