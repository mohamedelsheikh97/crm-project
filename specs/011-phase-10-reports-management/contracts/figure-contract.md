# Contract: What a Reported Figure Must Carry

**Feature**: `011-phase-10-reports-management` | **Date**: 2026-09-02

The most important contract in this phase, because it is the one that makes a number trustworthy. A
figure that arrives without these fields is not a smaller figure — it is one a reader cannot evaluate,
and this phase's whole hazard is that they will evaluate it anyway.

---

## The envelope

Declared in `backend/src/reporting/figure.ts`. Every report service returns figures in it; no service
returns a bare number.

```text
Figure<T> {
  value:      T                          // the headline
  count:      number                     // records behind it
  total:      number                     // records considered
  excluded:   { reason: string, count: number }[]
  suppressed: boolean
  period:     { from: ISO, to: ISO }     // RESOLVED instants, not date strings
  timeZone:   string
  filters:    Record<string, string | number | null>
  computedAt: ISO
  reflectsCurrentState: true
}
```

**Every field is required.** That is the mechanism, not a style preference: TypeScript will not let a
service return a figure it has not thought about, so `excluded` cannot be forgotten in the way a
convention would let it be.

---

## Field by field, and the requirement each one discharges

| Field                  | Requirement | What goes wrong without it                                                                   |
| ---------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| `count`, `total`       | FR-005      | "94% compliance" reads identically at 2-of-3 and 6,700-of-10,000. One is a statistic, the other is nothing. |
| `excluded[]`           | FR-004      | Tickets with no SLA policy are dropped from a compliance rate and the rate looks complete. FR-023's exclusion becomes a silent lie. |
| `suppressed`           | FR-006, FR-036, FR-061 | An agent characterised by four tickets; an average over two responses shown to two decimals; a group small enough to identify one record. |
| `period`, `timeZone`   | FR-003, D5  | Two figures resolved against independently-computed boundaries differ by a day and both look right — the exact FR-002 failure. |
| `filters`              | FR-003, FR-047 | An export lands in a mailbox with no record of what produced it, and is quoted as the whole picture. |
| `computedAt`           | FR-043      | A stale number beside a current-looking clock. Worse than no clock.                          |
| `reflectsCurrentState` | FR-011a     | A manager who quoted last month's figure finds it has moved and has no explanation. This field IS the mitigation Clarifications Q3 chose. |

---

## Rules on the envelope

**`period` holds resolved instants, never a date string.** `reporting/period.ts` converts the request's
date range using the active business calendar's timezone once, and every query for that request
receives the same bounds (D5). A figure that resolved its own boundary is how a total stops matching its
breakdown.

**`total` is records CONSIDERED, and `count` is records behind the value.** `total - count` should be
explainable by `excluded`. A test asserts that identity holds, which catches the commonest arithmetic
error in reporting: dropping rows in a `JOIN` and reporting the survivors as the population.

**`suppressed: true` means the value MUST NOT be rendered as a rate.** The surface shows `count` and
says the sample is too small. The floor is declared once in `reporting/suppression.ts` (D12) and is the
same number for CSAT averages, agent rates and any aggregation small enough to identify a record —
because they are one rule with three motivations.

**`excluded` reasons are keys, not sentences.** They are translated on the surface, so an Arabic reader
gets an Arabic explanation of why 40 tickets were left out (FR-063).

**`reflectsCurrentState` is a literal `true`.** Not computed, not configurable. It documents
Clarifications Q3 in the payload where a reader will see it, and it is the field a later
period-snapshot phase would set to `false` — rather than that phase having to redefine what every
existing figure means.

---

## The consistency obligation (FR-002, SC-002)

Two figures on one surface that must logically agree MUST agree. The mechanism is not care; it is that
they are computed from the same resolved period and the same filter object, and that a test asserts the
identity for every breakdown:

```text
for each breakdown B of total T:
  sum(B.count for all buckets) + sum(T.excluded.count) == T.total
```

This is the check that catches the classic reporting bug: a total that counts nulls and a breakdown
that has no null bucket, so the parts sum to less than the whole and nobody notices because nobody adds
them up.

---

## What a figure must NOT carry

| Never                                   | Why                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| A record the requester could not see directly | FR-054, FR-061. A report is not a route around scoping.                                 |
| An agent performance figure, on any surface an agent can reach | FR-030b. Not the ticket screen, not a notification, not a dashboard component. |
| A prompt or completion from Phase 9     | None is retained (FR-057). The report says so rather than appearing to have lost it.          |
| A precision the sample does not support | FR-006. `suppressed` exists so the surface never has to decide this itself.                    |
| A percentage without its counts         | FR-005. Structurally impossible here — `count` and `total` are required fields.               |

---

## Rendering contract (`FigureFrame.vue`)

One component renders the envelope, so provenance appears on every surface without each surface
remembering to show it:

- The value, with its counts beside it — never a bare percentage.
- The period, timezone and filters that produced it.
- When it was last **successfully** computed (FR-043, D8).
- Exclusions, translated, with counts.
- The current-state disclosure (FR-011a).
- A **table view toggle** for any figure with a chart — which is simultaneously the screen-reader
  answer, the relief the palette's contrast WARN requires (D7), and what a greyscale print shows (D8).
- Where suppressed: the count and an explanation, never the rate.

A surface that renders a figure without `FigureFrame` is the way this contract gets bypassed, and the
review question for any new report screen is whether it does.
