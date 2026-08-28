# Contract: Ticket Lifecycle

**Feature**: `004-phase-3-ticket-management` | **Date**: 2026-08-28

This is the phase's central declaration. Every later phase inherits it: Phase 4's dashboard groups by
these statuses, Phase 5's SLA clock starts and stops on these transitions, Phase 8's reports count
them. Changing this table changes those phases, which is why it is one declared structure rather than
a scatter of conditionals.

**Location**: `backend/src/tickets/lifecycle.ts` — a `const` the enforcement service, the transitions
endpoint, and the generated test all read.

---

## Statuses

| Key | Meaning | i18n key |
|---|---|---|
| `new` | Recorded, nobody has picked it up | `ticket.status.new` |
| `open` | Actively being worked | `ticket.status.open` |
| `pending` | Waiting on the customer or a third party | `ticket.status.pending` |
| `escalated` | Raised for attention beyond the current handler | `ticket.status.escalated` |
| `resolved` | Work finished, awaiting closure | `ticket.status.resolved` |
| `closed` | Finished and settled | `ticket.status.closed` |

A status is stored as its key and **rendered from its i18n key**. The database never holds a display
label, so a status is never an untranslated English word inside an Arabic interface.

---

## The transition table

```text
TRANSITIONS: Record<Status, { to: Status; permission: Permission }[]>
```

| From | To | Permission | Requirement |
|---|---|---|---|
| `new` | `open` | `tickets:transition` | FR-016 |
| `open` | `pending` | `tickets:transition` | FR-016 |
| `open` | `escalated` | `tickets:transition` | FR-029 |
| `open` | `resolved` | `tickets:transition` | FR-016 |
| `pending` | `open` | `tickets:transition` | FR-016 |
| `pending` | `escalated` | `tickets:transition` | FR-029 |
| `pending` | `resolved` | `tickets:transition` | FR-016 |
| `escalated` | `open` | `tickets:transition` | FR-031 |
| `escalated` | `pending` | `tickets:transition` | FR-031 |
| `escalated` | `resolved` | `tickets:transition` | FR-030 |
| `resolved` | `open` | `tickets:transition` | FR-016 |
| `resolved` | `closed` | **`tickets:close`** | FR-019, FR-021 |
| `closed` | `open` | **`tickets:reopen`** | FR-020, Q2 |

**13 permitted pairs of 36.** Everything not listed is refused.

### What the table encodes

- **`new` reaches only `open`.** Nothing is resolved, escalated, or pended before someone opens it
  (FR-018). This is the requirement most likely to be violated by a naive "any status to any status"
  implementation.
- **`closed` is reachable only from `resolved`** (FR-019). There is no shortcut from `open` to
  `closed`; finishing work and settling it are two acts.
- **`escalated` is not a dead end** (FR-030) — it reaches `resolved` directly, and it can also come
  back down to `open` or `pending` (FR-031).
- **Two edges carry a different permission from the rest.** `resolved → closed` needs
  `tickets:close`; `closed → open` needs `tickets:reopen`, which only a Supervisor holds. Every other
  edge needs `tickets:transition`.

### Default is refusal

A pair absent from the table is not permitted. Adding a seventh status without declaring its edges
produces a ticket that cannot move — visibly broken — rather than one that can move anywhere —
invisibly broken.

---

## Enforcement

**One function**, `assertTransitionAllowed(from, to, actor, ticket)`, in
`backend/src/services/ticket-lifecycle.service.ts`. Every path that changes a status calls it: the
generic transition endpoint, the escalate endpoint, the close endpoint, the reopen endpoint. There is
no second place a status is written.

The function checks, in order:

1. **Is the ticket merged?** A merged ticket is unworkable by every route (FR-043). This is checked
   first because it applies regardless of which transition was asked for.
2. **Is `from → to` in the table?** If not, refuse with `TRANSITION_NOT_ALLOWED` and **name the
   reachable set** (FR-017) — a refusal that says only "no" leaves the user guessing.
3. **Does the actor hold the edge's permission?** If not, refuse with `FORBIDDEN`. The message
   distinguishes "this move is not possible" from "this move is not yours" — they are different
   problems with different remedies.
4. **Is `tickets:close` conditional here?** Closing a ticket assigned to someone else additionally
   requires `tickets:manage_any` (Q2, D4).

### Error shape

```json
{
  "error": {
    "code": "TRANSITION_NOT_ALLOWED",
    "message": "A ticket in status 'new' cannot move to 'resolved'.",
    "details": { "from": "new", "to": "resolved", "allowed": ["open"] }
  }
}
```

`details.allowed` is the reachable set **after** permission filtering — an Agent looking at a resolved
ticket sees `["open", "closed"]` only if they may actually close it. Offering a move the user cannot
make is the interface lying about authority, which Phase 1 rejected.

---

## Discovery

`GET /api/tickets/:id/transitions` returns the moves available **to the calling user on this
ticket**, computed by the same service from the same table.

```json
{ "data": { "status": "resolved", "transitions": [{ "to": "open", "permitted": true }, { "to": "closed", "permitted": true }] } }
```

The interface renders buttons from this response and never from a hardcoded list. This is how the
lifecycle stays in one place: the front end has no copy of the table to drift from.

---

## Side effects per transition

| Transition | Side effects |
|---|---|
| any | `ticket_history` entry `ticket.status.changed` with previous and new value; audit `ticket.status.changed`; `version` increments |
| `* → escalated` | Requires a reason (FR-029); stored on the ticket and in the history entry; audit `ticket.escalated` |
| `escalated → *` | Clears `escalation_reason`; audit `ticket.deescalated` |
| `resolved → closed` | Audit `ticket.closed` |
| `closed → open` | Audit `ticket.reopened`. **Retains all history** (FR-022) — reopening continues a ticket, it does not start one |

All of it shares the transition's transaction. A status that changed without its history entry, or a
history entry for a status that did not change, is not a state this system can reach.

---

## Merge and the lifecycle

Merge is **not** a transition. A merged ticket keeps whatever status it had; what changes is that
`merged_into_ticket_id` becomes non-null and every workable route now refuses it. Modelling merge as
a seventh status would have meant losing the status the ticket was actually in, and would have put a
row in the transition table for something that is not a lifecycle move.

---

## Test obligation

`backend/tests/ticket-lifecycle.matrix.test.ts` iterates **all six statuses × all six statuses = 36
ordered pairs** and asserts each one is permitted or refused according to the table, per role. The
test reads the same constant the service reads, so the two cannot disagree — the test proves the
service honours the declaration, not that someone transcribed it correctly twice.

It additionally asserts:

- Every status appears as a `from` key (no status is a silent dead end by omission).
- Every `to` value is a declared status (no typo produces an unreachable target).
- Every edge's permission is a key the catalog defines.
