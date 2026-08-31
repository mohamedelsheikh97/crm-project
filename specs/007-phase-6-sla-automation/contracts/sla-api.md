# Contract: SLA, Assignment, and Alert API

**Feature**: `007-phase-6-sla-automation` | **Date**: 2026-08-31

Every endpoint follows the conventions Phases 1–5 fixed and does not restate them: JWT verified by
middleware on every route below, permission checked server-side by the route's guard, validation
errors as `{ errors: [{ field, message }] }` with `message` an i18n key, optimistic locking via
`version` on every mutation of a versioned row, `409` on a stale version, `404` where a permission
would otherwise disclose existence, and audit written inside the same transaction as the change.

Durations cross the wire as **integer working minutes**, never as formatted strings. Instants cross as
ISO 8601 UTC. The interface formats both (see `sla-automation-ui.md`); FR-084 makes that the
interface's job, and a server-formatted duration cannot be correct in two languages at once.

---

## SLA policies — `/api/admin/sla/policies`

Guard: `sla:manage`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | List all policies, ordered as they are matched: `specificity DESC, updated_at DESC`. **The list order is the precedence order** (FR-013) — the screen explains precedence by showing it rather than by prose. |
| `POST` | `/` | Create. |
| `GET` | `/:id` | One policy. |
| `PATCH` | `/:id` | Edit. Requires `version`. |
| `POST` | `/:id/activate` | |
| `POST` | `/:id/deactivate` | FR-005. There is **no `DELETE`** (FR-019). |

**Policy shape**

```json
{
  "id": 3,
  "name": "Urgent",
  "nameAr": "عاجل",
  "priority": "urgent",
  "category": null,
  "responseMinutes": 60,
  "resolutionMinutes": 240,
  "isActive": true,
  "specificity": 2,
  "matchesLabel": "priority: urgent",
  "version": 0
}
```

**Validation**

- `responseMinutes` and `resolutionMinutes`: integers `>= 1`; `resolutionMinutes >= responseMinutes`
  (FR-008) → `sla.error.resolutionShorterThanResponse`.
- `priority` / `category`: null or a member of the existing taxonomy → `sla.error.priorityInvalid`,
  `sla.error.categoryInvalid`.
- `specificity` is **derived, never accepted** from the client.

**Deactivating the last active catch-all policy is allowed** and returns a warning field,
`{ "warning": "sla.warning.noCatchAllPolicy" }`. It is not refused: FR-014 makes "no policy" a valid
state, and refusing it would prevent an administrator from switching the feature off.

---

## Business calendar — `/api/admin/sla/calendar`

Guard: `sla:manage`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | The active calendar with its exceptions. |
| `PATCH` | `/` | Edit week, hours, zone. Requires `version`. |
| `POST` | `/exceptions` | Add a non-working date. |
| `DELETE` | `/exceptions/:id` | Remove one. |

```json
{
  "id": 1,
  "name": "Default",
  "timeZone": "Africa/Cairo",
  "workingDays": [0, 1, 2, 3, 4],
  "dayStartMinute": 540,
  "dayEndMinute": 1020,
  "exceptions": [{ "id": 7, "date": "2026-09-21", "label": "Public holiday" }],
  "version": 2
}
```

`workingDays` is an **array of weekday numbers** on the wire (Sunday = 0) and a bitmask in storage.
The array is what a checkbox group binds to; the mask is what the arithmetic wants. Converting at the
boundary keeps neither side compromised.

**Validation**

- `timeZone`: must round-trip through `Intl.DateTimeFormat` → `sla.error.timeZoneUnknown`. Refused
  here so an unknown zone can never throw inside a sweep.
- `workingDays`: non-empty → `sla.error.noWorkingDays`. A calendar with no working days makes every
  target unreachable and would spin the day-walk to its bound (research D2).
- `dayEndMinute > dayStartMinute`, both `0..1440` → `sla.error.dayHoursInvalid`.

**Editing the calendar does not recompute existing targets** (FR-029). The response says so
explicitly, `{ "affectedOpenTickets": 0 }`, so an administrator is not left guessing whether they just
moved 400 commitments.

---

## A ticket's SLA state — returned with the ticket, not fetched separately

Guard: `tickets:view`, i.e. no new permission (see data-model.md).

`GET /api/tickets/:id` and every row of `GET /api/tickets` gain one field:

```json
{
  "sla": {
    "policyId": 3,
    "policyName": "Urgent",
    "response": {
      "targetAt": "2026-08-31T13:00:00Z",
      "state": "met",
      "remainingMinutes": null,
      "satisfiedAt": "2026-08-31T10:12:00Z"
    },
    "resolution": {
      "targetAt": "2026-09-01T11:00:00Z",
      "state": "at_risk",
      "remainingMinutes": 45,
      "satisfiedAt": null
    },
    "isPaused": false,
    "dueSource": "policy"
  }
}
```

`sla` is `null` for a ticket that matched no policy (FR-014) — not an object of nulls, so a consumer
cannot accidentally render "0 minutes remaining" for a ticket with no commitment.

**`state` is one of `met | on_track | at_risk | breached`**, computed server-side against the one
authoritative clock (FR-011). The client never derives it from `targetAt` and its own clock, which is
what makes SC-002 true.

`remainingMinutes` is **working** minutes and is null once a target is met or breached. While paused
it is the captured remainder, so a paused ticket reads "45 working minutes left, paused" rather than
counting down.

---

## Assignment — `/api/admin/assignment`

Guard: `assignment:manage`, **additionally conditioned on `tickets:assign` in the service** (FR-051).
An agent holding `assignment:manage` by misconfiguration is still refused, with
`assignment.error.requiresAssignAuthority`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Current strategy, ceiling, and eligible-agent count. |
| `PATCH` | `/` | Set strategy and ceiling. Requires `version`. |
| `GET` | `/competencies` | Every user with their category set. |
| `PUT` | `/competencies/:userId` | Replace one user's set. |

```json
{
  "strategy": "competency",
  "maxOpenPerAgent": 15,
  "eligibleAgentCount": 6,
  "version": 1
}
```

`eligibleAgentCount` is returned because a strategy configured against zero eligible agents is the
failure of User Story 3 scenario 3, and an administrator should see it while choosing rather than
discover it at 02:00.

**`PUT` on competencies replaces the whole set** rather than patching members: the resource is a set,
and a diff API for a four-member enumeration is more failure surface than it is worth.

---

## Alert subscriptions — `/api/admin/alerts/subscriptions`

Guard: `sla:manage`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Every event key with its subscriptions. |
| `PUT` | `/` | Replace the whole set, in one transaction. |

```json
{
  "events": [
    {
      "eventKey": "sla.resolution_breached",
      "subscriptions": [
        { "recipientKind": "assignee", "inApp": true, "byEmail": false, "bySms": false },
        { "recipientKind": "role", "roleId": 2, "inApp": true, "byEmail": true, "bySms": false }
      ]
    }
  ]
}
```

`inApp` is returned as `true` and **rejected if sent as `false`** →
`alerts.error.inAppNotOptional`. FR-073 makes the in-app notification unconditional, and a control
that appears adjustable but is not is worse than one shown disabled.

`bySms` on a role subscription is accepted even where no member has an `alertPhone`; those recipients
are recorded as `skipped` at delivery (FR-077). The `GET` response includes
`unreachableForSms: 3` per subscription so the screen can say so up front.

---

## The automation record — `/api/automation/runs`

Guard: `automation:view`. Rules themselves are in `automation-engine.md`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Paged, newest first. Filters: `ruleId`, `ticketId`, `outcome`, `from`, `to`. |

```json
{
  "items": [
    {
      "id": 4821,
      "ruleName": "WhatsApp complaints to high",
      "ruleId": 6,
      "triggerKey": "ticket.created",
      "ticket": { "id": 1042, "reference": "TKT-1042" },
      "outcome": "acted",
      "depth": 0,
      "actionsApplied": [{ "action": "set_priority", "result": "ok", "from": "normal", "to": "high" }],
      "detail": null,
      "createdAt": "2026-08-31T02:14:00Z"
    }
  ],
  "page": 1,
  "pageSize": 25,
  "total": 913
}
```

`ruleId` may be null while `ruleName` is always present — FR-070: the record outlives the rule.

`detail` carries an **i18n key and parameters**, not a sentence:
`{ "key": "automation.suppressed.depthExceeded", "params": { "max": 3 } }`. Same rule the notification
table has followed since Phase 4: the row may be read by an Arabic user and an English one, so the
language cannot be decided at write time.

---

## What has no endpoint, deliberately

- **No "recompute all targets" endpoint.** FR-018 forbids retroactive recomputation, and an endpoint
  that did it would be used.
- **No "escalate now" endpoint.** Manual escalation already exists as a Phase 3 status transition.
- **No "run the sweep" endpoint.** The sweep is called directly by tests with a controlled clock
  (research D5); exposing it over HTTP would create a way to fire escalations by request.
- **No per-user alert preference endpoints.** Alert configuration is by event and role (spec
  Assumptions); preferences, digests, and quiet hours are explicitly out of scope.
