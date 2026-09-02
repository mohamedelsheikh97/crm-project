# Contract: Report and Dashboard Endpoints

**Feature**: `011-phase-10-reports-management` | **Date**: 2026-09-02

All routes sit under `/api/reports`, mounted on a **path prefix** with `authenticate` applied once for
the group — never with a bare `router.use`. Phase 9 made that mistake and put Phase 7's public
knowledge base behind a token; the lesson is recorded in `routes/ai/index.ts` and this router follows
it.

Every response body is the figure envelope from
[figure-contract.md](./figure-contract.md). No endpoint returns a bare number.

---

## The one filter shape

Every report accepts the same query parameters, declared once in `reporting/filters.ts`:

| Parameter    | Notes                                                                          |
| ------------ | ------------------------------------------------------------------------------ |
| `from`, `to` | Required. Interpreted in the active business calendar's timezone (D5).          |
| `category`   | Optional. Validated against `tickets/taxonomy.ts` — not a free string.          |
| `channel`    | Optional. Validated against the Phase 5 channel list.                           |
| `priority`   | Optional. Validated against the taxonomy.                                       |
| `agentId`    | Optional. Requires `reports:view_agents` where it narrows to an individual.      |

**One shape, not per-report shapes.** FR-002 requires figures on a surface to agree, and the surest way
to break that is two reports interpreting `from` differently. Validation against the taxonomy rather
than accepting a string is the Phase 3 rule applied here: an unknown category is a refusal, not an empty
result that reads as "no tickets".

---

## Reports

### `GET /api/reports/volume`

**Authority**: `reports:view`.

```text
{
  received:    Figure<number>,
  openAtEnd:   Figure<number>,
  byStatus:    Figure<{ status, count }[]>,
  byCategory:  Figure<{ category, count }[]>,
  byChannel:   Figure<{ channel, count }[]>,
  overTime:    Figure<{ bucket, count }[]>
}
```

`received` and `openAtEnd` are separate figures because FR-016 says they answer different questions and
are commonly confused — "we had 400 tickets last month" means neither one on its own.

### `GET /api/reports/sla`

**Authority**: `reports:view`.

```text
{
  responseCompliance:   Figure<number>,   // rate, with counts
  resolutionCompliance: Figure<number>,
  byPolicy:             Figure<{ policyId, policyName, response, resolution }[]>,
  byPriority:           Figure<{ priority, response, resolution }[]>,
  overTime:             Figure<{ bucket, response, resolution }[]>
}
```

**Response and resolution never combine into one "SLA compliance" number** (FR-020). They are separate
promises with separate targets, and averaging them produces a figure that describes nothing.

Every rate is a count over `ticket_sla`'s recorded outcome columns (D3), so it reconciles to the ticket
screen by construction — the report and the screen read the same columns. Tickets with no policy appear
in `excluded`, never in the denominator (FR-023).

**No `averageElapsed` field.** It cannot be aggregated in SQL and the wall-clock approximation would be
plausibly wrong (D3, Open Question 2). Its absence is deliberate; a client asking for it gets nothing
rather than something misleading.

### `GET /api/reports/csat`

**Authority**: `reports:view`.

```text
{
  distribution: Figure<{ score: 1|2|3|4|5, count }[]>,
  average:      Figure<number>,          // suppressed below the floor (D12)
  responseRate: Figure<number>,
  comments:     Figure<{ ticketReference, score, comment, at }[]>
}
```

`responseRate`'s denominator is every ticket that could have been rated (FR-027) — unrated resolved
tickets are in it, which is what makes the figure mean anything.

`comments` carries `ticketReference`, not `ticketId`: a comment a supervisor wants to act on needs a
reference they can search (FR-028), and Phase 8 established that no surface exposes an internal id where
a reference serves.

### `GET /api/reports/agents`

**Authority**: `reports:view_agents` — supervisors and administrators only (Clarifications Q1).

```text
{
  rows: Figure<{
    userId, fullName, isActive,
    handled, resolved,
    responseCompliance, resolutionCompliance,
    csatAverage,                          // suppressed below the floor
    activeFrom, activeTo                  // FR-032 — the period they were working
  }[]>,
  attributionRule: string                 // FR-031 — stated in the payload
}
```

`attributionRule` is a **field in the response**, not documentation. FR-031 requires the rule to be
stated, and putting it in the payload means every client shows it and none can render the figures
without it. Its value describes D4: outcomes follow the current assignee.

**Absent, not refused** (FR-030b, D11). A caller without `reports:view_agents` gets 404, and the report
does not appear in navigation — a visible-but-refused report tells an agent that figures about them
exist and are being withheld, which is worse than either alternative.

### `GET /api/reports/ai`

**Authority**: `reports:view`.

```text
{
  byFeature:      Figure<{ feature, invocations, failures, tokens }[]>,
  proposalAcceptance: Figure<number>,
  deflectionRate: Figure<number>,
  contentRetained: false                  // FR-057
}
```

`contentRetained: false` is stated in the payload for the reason Phase 9's activity endpoint states it:
an administrator looking for what a bad answer actually said needs to learn that it was never kept,
rather than conclude the log is broken.

---

## The management dashboard

### `GET /api/reports/dashboard`

**Authority**: `reports:view`. Returns only the figures the caller is entitled to (FR-042), so a
component the viewer has lost authority for is simply absent rather than erroring.

```text
{
  figures: Record<string, Figure<unknown>>,   // keyed by figure key
  computedAt: ISO
}
```

**One request, not one per tile.** FR-002 requires the figures to agree, and twelve independent
requests resolve twelve period boundaries — arriving at a dashboard whose total does not match its own
breakdown. One request, one resolved period (D5).

This is also the endpoint FR-045's interval refresh calls, so it is the one whose cost matters most:
SC-018 is measured against it with the maximum supported number of dashboards refreshing.

### `GET /api/reports/dashboard/arrangement` · `PUT /api/reports/dashboard/arrangement`

**Authority**: `reports:view`. A user's own arrangement only — there is no path to another user's, and
no id parameter that could become one.

`PUT` validates every key against the declared figure catalog. An unknown key is a **refusal**, not a
stored value silently ignored later — otherwise a layout accumulates keys that render nothing and looks
broken to its owner.

No audit entry (FR-065): a user rearranging their own dashboard affects nobody, which is only true
because arrangements cannot be shared (see data-model.md).

---

## Export

### `POST /api/reports/{report}/export`

**Authority**: `reports:export`, **and** the authority for the report being exported. Both, not either
— otherwise `reports:export` becomes a way to read the agent report without `reports:view_agents`.

```text
{ format: 'csv' | 'xlsx' }
```

PDF is absent from this endpoint deliberately: it is produced by the browser (D6), so there is nothing
for the server to do. See [export-contract.md](./export-contract.md).

| Response | Meaning                                                                 |
| -------- | ----------------------------------------------------------------------- |
| 200      | The file, with the filters recorded inside it (FR-047)                   |
| 403      | Lacks `reports:export`, or the report's own authority                    |
| 413      | Period too large to produce — stated plainly, never truncated (FR-052)   |

Every export writes `data.exported` to the audit log, attributable, with the report and filters
(FR-051) — the action Phase 2 established as the one that takes data out of the system.

---

## Rules that hold across every endpoint

| Rule                                                        | Requirement       |
| ----------------------------------------------------------- | ----------------- |
| Read-only. No endpoint writes an operational record.         | FR-064, SC-028    |
| Scoping applied in the query, never by filtering results     | FR-060            |
| No figure the caller could not obtain directly               | FR-054, FR-061    |
| Aggregations below the suppression floor return counts, not rates | FR-036, D12  |
| Every response carries its period, timezone and filters      | FR-003            |
| SLA state, working hours and taxonomy read from their owners  | FR-007, D2        |

**The one write in the phase** is a user's own dashboard arrangement. `PUT .../arrangement` is the only
non-`GET` route here besides export, and export writes only an audit entry — which is a record of
reading, not a change to anything read.
