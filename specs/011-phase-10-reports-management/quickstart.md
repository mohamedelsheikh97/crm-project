# Quickstart: Phase 10 — Reports & Management

**Feature**: `011-phase-10-reports-management` | **Date**: 2026-09-02

How to run Phase 10 and prove the figures are right. Scenario 1 is the one that matters: **a wrong
number looks exactly like a right one**, so the only check that establishes correctness is comparing
against answers worked out by hand.

---

## Prerequisites

- Phases 0–9 running (`npm run dev`), MySQL 8.4, **migrations current** — this phase adds one table and
  seven indexes, and the reports will be slow without them rather than wrong
- A user holding `reports:view`; a second holding `reports:view_agents`; a third holding neither
- An **agent** account, for Scenario 5
- An active business calendar with a known timezone (Phase 6) — every period boundary depends on it
- The fixture data set from `backend/tests/reporting/` loaded, or its equivalent by hand

### The fixture is the point

```bash
npx vitest run --project backend backend/tests/reporting
```

This suite holds a data set whose answers were computed **by hand** and written into the test as
literals. It is deliberately not a comparison between two queries: two queries that agree can both be
wrong, and they will share exactly the assumptions where the bug is — null handling, boundary
inclusiveness, whether a merged ticket counts.

If you are adding a report, the fixture is where you decide what the right answer is for the awkward
cases before you write the query, not after.

---

## Scenario 1 — The figures are right (SC-001, and the reason for the phase)

1. Load the fixture data set. It contains, by construction: tickets spanning three months, some merged,
   some with no assignee, some with no SLA policy, some opened in one month and closed in the next, and
   satisfaction scores on a subset.
2. Open the volume report for the middle month.

**Expected** — compare every figure against the fixture's hand-computed literals:

- `received` counts tickets **created** in the month, in the calendar's timezone
- `openAtEnd` counts tickets still open at the last instant of the month — a **different number**, and
  if they are equal in your data the fixture is not exercising FR-016
- The status breakdown sums to `received` **plus** the exclusions the figure reports
- A merged ticket appears **once**, on the surviving side (FR-017)

3. **Then the check that catches the classic bug**: add the breakdown buckets up by hand and compare to
   the total.

```text
sum(bucket counts) + sum(excluded counts) == total
```

A total that counts nulls beside a breakdown with no null bucket is the commonest reporting error there
is, and nobody notices because nobody adds up a chart.

4. Change the period to one before the system held data.

**Expected**: it says so (FR-014). **Not zero** — zero reads as "a quiet month", which is a different
claim.

---

## Scenario 2 — SLA figures reconcile to the tickets themselves (SC-005)

1. Open the SLA report for a period containing known breaches.
2. Note the response and resolution compliance figures. **They are separate numbers** (FR-020) — if the
   screen shows one combined "SLA compliance", that is a defect.
3. Drill through to the tickets behind the breach count.
4. Open several of those tickets and read the SLA state on the ticket screen.

**Expected**: they agree, every time, with zero reconciliation differences.

**Why this is expected rather than hoped for**: the report counts
`ticket_sla.response_breached_at` and `resolution_breached_at`, which is what the ticket screen displays.
Phase 6 annotated those columns _"The recorded outcome Phase 10 reporting must read, not recompute"_
(research D3). The report and the screen are **the same number**, not two calculations that have to
match. If they ever disagree, something has started recomputing — and that is the bug to look for
rather than an off-by-one in the report.

5. Include a ticket whose SLA clock was paused.

**Expected**: the paused period is excluded, because it was excluded when the outcome was recorded. The
report does no pause arithmetic at all.

6. Include tickets with no SLA policy.

**Expected**: reported in `excluded` with a count, and **absent from the denominator** (FR-023). A
compliance rate that silently counts unpoliced tickets as compliant is the phase's hazard exactly.

7. Look for an "average response time" figure.

**Expected**: **there is none** (research D3). Working-hour elapsed time cannot be aggregated in SQL,
and a wall-clock approximation would disagree with every SLA target in the system while looking
entirely plausible. Its absence is deliberate — see Open Question 2.

---

## Scenario 3 — Exports, and the Arabic one is the hard one

1. Apply filters to any report and export **CSV**.

**Expected**: figures match the screen; the filters, period and timezone are stated in the file; Arabic
text is legible in Excel (the UTF-8 BOM, inherited from Phase 2).

2. Put a CSAT comment beginning with `=` into the fixture and export again.

**Expected**: the cell shows the literal text. If Excel evaluates it, FR-049's guard is not running —
and note this is customer-authored text, so it is not hypothetical.

3. Export **Excel**.

**Expected**: numbers sort as numbers and dates as dates without re-typing a column — that is the entire
reason this format exists rather than a renamed CSV. On an Arabic export, column A is on the right.

4. Export **PDF** — which is your browser printing, not the server (contracts/export-contract.md).

**Expected**: charts print as vectors, not bitmaps (they are inline SVG); collapsed table views are
expanded; the provenance block is visible; no figure splits across a page break.

5. **The check that needs a person**: have somebody who reads Arabic open all three files.

**Expected**: legible Arabic. Glyph shaping failures produce output that looks like Arabic to somebody
who does not read it, which is why SC-021 is a human task and cannot be closed by a passing suite.

6. Export a year-long period.

**Expected**: it completes, or refuses with a plain statement (FR-052). **A truncated file that looks
complete is the worst outcome** and the one to look for.

7. As a user without `reports:export`, call the endpoint directly.

**Expected**: 403. And as a user holding `reports:export` but **not** `reports:view_agents`, try to
export the agent report — also refused, because export requires both (contracts/reports-api.md).

---

## Scenario 4 — The dashboard refreshes without becoming a problem

1. Open the management dashboard. Note the "computed at" time.
2. Wait for the configured interval.

**Expected**: figures update; the timestamp advances.

3. Create a ticket in another window and wait for the next refresh.

**Expected**: the volume figure moves.

4. **Slow the report query deliberately** (a breakpoint, or a throttled connection) and watch the
   network panel across several intervals.

**Expected**: **never more than one refresh request in flight** (FR-045a). If they queue, a busy period
turns this feature into an outage — which is the moment somebody would have opened the dashboard to
watch.

5. Switch to another browser tab and leave it for several intervals.

**Expected**: refreshing **stops** (FR-045b). A dashboard left open overnight on an unattended screen
must not query until morning.

6. Break the endpoint and wait for a refresh.

**Expected**: the last good figures stay on screen with their own timestamp (FR-045d). Not blanked, and
not zeroes — and the timestamp must be of the last **successful** refresh, because a stale number beside
a current-looking clock is worse than no clock.

7. Rearrange the dashboard, sign out, sign back in.

**Expected**: the arrangement persisted. Sign in as a different manager: they see **their own**.

8. Revoke a permission for a figure the manager had added.

**Expected**: that figure disappears within one page load (FR-042, SC-019) — no error, no empty panel.

---

## Scenario 5 — An agent cannot reach figures about themselves

Clarifications Q1 made agent performance supervisory. This scenario is the check, and it must be done
from an **agent** account, not a supervisor's.

1. Sign in as an agent. Look for the agent performance report in navigation.

**Expected**: **absent**, not present-and-refusing (FR-030b). A visible-but-refused report tells an
agent that figures about them exist and are being withheld.

2. Call the endpoint directly:

```bash
curl -H "Authorization: Bearer $AGENT_TOKEN" localhost:3000/api/reports/agents
```

**Expected**: 404.

3. Try to reach only your own figures — `?agentId=<self>`.

**Expected**: still refused. Q1 chose supervisors-only, and that includes an agent's own numbers.

4. Try the export route, and try adding an agent figure to your dashboard arrangement.

**Expected**: refused in both cases.

5. Check the ticket screen, notifications, and every dashboard component available to an agent.

**Expected**: no agent performance figure anywhere (FR-030b). SC-014a asks for this enumerated rather
than spot-checked.

### Then the part that is not a test

6. As a supervisor, open the agent report and read the **attribution rule** shown on it.

**Expected**: it states that outcomes follow the **current assignee** (research D4).

7. Take a ticket an agent resolved, reassign it to somebody else, and re-run the report.

**Expected**: the resolution now counts for the **new** assignee, and the original resolver's count
drops.

**This is the phase's most uncomfortable behaviour and it is working as designed.** It follows from
Clarifications Q3's commitment to current state. It also means a figure can be wrong about a person who
cannot see it to object — which is why the rule is displayed, why FR-034 requires every figure to be
traceable to its tickets in one step, and why this is **Open Question 1** for operations rather than a
decision inherited from a schema convenience.

---

## Scenario 6 — Bilingual, and charts are the new hazard

1. Switch to Arabic. Open every report and the dashboard.

**Expected**: RTL layout with no per-component direction overrides (Principle I). Specifically check the
things charts get wrong:

- **Axis labels** — Arabic text, and numbers in the locale's digits, not `String(n)`
- **Legends** — positioned for RTL reading order
- **Bar direction** — horizontal bars growing from the right
- **Dates** — formatted through `vue-i18n`, not ISO strings

2. Toggle the **table view** on every chart.

**Expected**: the same figures as the chart. This one component is doing four jobs (research D8): the
screen-reader answer, the relief the palette's contrast WARN requires, the RTL fallback, and what a
greyscale print shows.

3. **Greyscale**: print preview, or a greyscale filter.

**Expected**: every series distinguishable without colour — direct labels, or the table view.

4. **Screen reader**: open the dashboard and leave it through two refresh intervals.

**Expected**: it does **not** read the numbers aloud unprompted. Figures are deliberately not in an
`aria-live` region (research D8) — a dashboard that announces every changed number every minute is
hostile. The reader gets a deliberate refresh control and an explicit statement of when the figures are
from.

---

## Automated suites

```bash
npm test                                          # everything
npx vitest run --project backend backend/tests/reporting   # hand-computed fixtures — the important one
npx vitest run --project backend backend/tests/reports     # per-report correctness and scoping
npx vitest run --project backend backend/tests/exports     # encoding, injection, audit, refusal
```

> **Run the backend suite alone.** It shares one `crm_support_test` schema with
> `fileParallelism: false`, and a second concurrent run leaves open transactions that produce 401/403
> failures across unrelated files — see the note in `backend/tests/helpers/database.ts`. A killed run
> leaves the same orphans.

---

## Manual passes that stay open

Cannot be automated, and closing them quietly would be worse than leaving them listed:

- **SC-021** — a reader of Arabic opens all three export formats. PDF glyph shaping is the risk.
- **SC-029** — WCAG 2.1 AA on every report and the dashboard, in both languages, **including the
  auto-refreshing region and every chart**. These are the two things this project has not had to make
  accessible before.
- **Greyscale pass** — every series distinguishable without colour.
- **Open Question 1** — attribution: current assignee, or assignee at resolution? An operations
  decision, and the one whose wrong answer affects somebody's appraisal.
- **Open Question 2** — should average elapsed working time be offered at all? Managers will ask.
- **Open Question 3** — the suppression floor. Too high looks like missing data; too low looks like
  insight. Needs real distributions.
- **Open Question 4** — the default refresh interval, per surface.
- **D1's performance claim** — measure a report at realistic volume against the new indexes. If it
  still cannot be served, that is the finding that would justify a replica and the constitution
  amendment that comes with it. Until measured, it is a claim.
