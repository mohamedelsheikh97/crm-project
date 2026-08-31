# Quickstart: Phase 6 — SLA & Automation

**Feature**: `007-phase-6-sla-automation` | **Date**: 2026-08-31

How to run this phase's work and confirm it does what PLAN.md's Definition of done says: _"A ticket
that breaches its SLA escalates and notifies the right people without manual intervention."_

Everything here is runnable with no commercial account — alerts travel over Phase 5's simulator
transports by default. Six scenarios, then the manual passes the automated suite cannot cover.

---

## Prerequisites

The Phase 0–5 setup, unchanged:

```powershell
npm install
Copy-Item .env.example .env      # if you have not already
npm run db:migrate --workspace backend
npm run db:seed --workspace backend
```

Three new environment knobs, all optional and all defaulted (research D15):

```
SLA_WARNING_LEAD_MINUTES=60          # how far ahead of a target the at-risk warning fires
AUTOMATION_MAX_DEPTH=3               # rule cascade bound
ALERT_MAX_PER_RECIPIENT_PER_HOUR=20  # the FR-078 ceiling
```

Seeding adds one active business calendar (Sun–Thu, 09:00–17:00, `Africa/Cairo`), four SLA policies
(one per priority), default alert subscriptions, and the four new permission grants. **Assignment is
seeded off**, deliberately: a fresh installation must not start redistributing tickets before an
administrator chooses to.

---

## Run the automated suite

```powershell
npm test                                   # both workspaces
npm test --workspace backend               # serial, against crm_support_test
npx vitest run backend/tests/sla           # working-time arithmetic and targets
npx vitest run backend/tests/escalation    # the Definition of done
npx vitest run backend/tests/automation    # the rule engine
```

The single highest-risk piece of new logic is `lib/business-hours.ts`, and it has a table-driven test
crossing a daylight-saving boundary in both directions. If that table is green, the rest of the SLA
arithmetic is arithmetic. If you change the helper, run it first.

---

## Scenario 1 — A ticket acquires its targets (FR-010, User Story 1)

1. Sign in as the seeded administrator and open `/admin/sla/policies`. Four policies, listed **in
   matching order**: the list order is the precedence order.
2. Raise a ticket with priority `urgent`.
3. Open it. The header shows both targets: first response in 1 working hour, resolution in 4.
4. Change its priority to `low` and save. Both targets recompute under the newly matching policy, and
   the ticket's history records the change with previous and new values (FR-017).

**What to look for**: the resolution target is also the ticket's **due date**, and the badge beside it
reads "set by policy". That is the Phase 4 seam being used rather than replaced (research D6) — the
queue's due-date column, its sort, and its overdue indicator are Phase 4 code, untouched.

Then set the due date by hand. The badge changes to "set manually", and no later policy evaluation
touches it again (FR-024a). Clear the override and it returns to the computed target.

---

## Scenario 2 — A breach escalates with nobody watching (the Definition of done)

The sweep runs every 60 seconds in a live process, but do not wait on a timer. Call it directly with
a controlled clock, the way the tests do:

```powershell
npx vitest run backend/tests/escalation/breach.test.ts
```

To watch it end to end by hand:

1. Raise an urgent ticket and assign it to an agent.
2. In the database, move `ticket_sla.resolution_target_at` into the past.
3. Wait one tick (or call `runScheduledSweeps(new Date())` from a REPL).

**What to look for**:

- The ticket's status is now `escalated`, and its escalation reason is set.
- Its history shows the escalation attributed to **the system**, not to a user (FR-039).
- The assignee has an in-app notification; so does every user holding the supervisory role.
- The audit log has one `ticket.escalated` entry with a null actor.

Run the sweep again, several times. **Nothing further happens** — no second status change, no repeated
notification (FR-034). That is the value-comparison marker doing its job (research D4); a boolean flag
would have been indistinguishable from a bug here.

Now de-escalate the ticket by hand and sweep again. Still nothing (FR-042). Resolve it, reopen it, and
sweep: a *fresh* target was armed by the reopen, so the marker no longer matches and the ticket is
protected from an instant re-breach (FR-030).

---

## Scenario 3 — The clock stops while waiting on the customer (User Story 6)

1. Take an open ticket with a resolution target an hour away.
2. Move it to `pending`. The countdown stops and shows a paused indicator; the remainder is captured.
3. Advance the clock past the original target (or edit `started_at` back) and run the sweep. **The
   ticket is not breached** — paused rows are excluded (FR-021).
4. Move it back to `open`. The target is rewritten as "now plus what was left".

Repeat the pause/resume cycle three times and confirm the remaining time is not compounded (FR-022).
That is the property research D3 chose the design for: there is no accumulated offset to double-count.

---

## Scenario 4 — An arriving ticket finds an owner (User Story 3)

1. Open `/admin/assignment`, choose **round-robin**, and note the eligible-agent count.
2. Raise six unassigned tickets — through the API, or by sending six emails through the Phase 5 email
   simulator, which is the case that actually matters.
3. Each lands with an assignee; the distribution differs by no more than one across eligible agents.
4. Each assignee receives the ordinary assignment notification, and each ticket's history shows the
   assignment attributed to the automation (FR-050).

Then confirm the refusals:

- Deactivate an agent; they are never selected again (FR-045).
- Set the ceiling to 1 and raise more tickets than there are eligible agents. The excess stays
  unassigned, the reason is recorded, and the supervisory recipients are alerted (FR-048) — the ticket
  does not vanish into an unwatched state.
- Assign a ticket by hand, then let the strategy run. It is **not** reassigned (FR-049).
- Sign in as an agent and try to open `/admin/assignment`. Refused server-side, not merely hidden
  (FR-051) — configuring assignment is self-assignment by a longer route.

Switch the strategy to **competency**, give one agent the `billing` category, and raise a billing
ticket: it goes to them. Remove every competency and raise another: it still reaches an owner, through
the load-based fallback (FR-044b). A missing competency record must never park a ticket.

---

## Scenario 5 — A supervisor builds a rule (User Story 4)

1. Open `/admin/automation` and create a rule:
   - **When** a ticket is created
   - **If** category is `complaint` **and** source is `whatsapp`
   - **Then** set priority to `high`
2. **Dry-run it before enabling.** The panel lists which of the 50 most recent tickets it would have
   matched and what it would have done. Nothing is written (FR-066).
3. Enable it. Send a WhatsApp complaint through the simulator: the priority changes, the ticket's
   history names the rule, and `/admin/automation/runs` records the run.
4. Send the same complaint by email instead. The rule does not fire, and the record shows `no_match` —
   visibly not an error.
5. Disable the rule, send another matching message, re-enable it. Nothing was acted on while it was
   off, and re-enabling does not act retroactively (FR-061).

**The cycle test is worth doing by hand once.** Build two rules that trigger each other — A raises
priority on status change, B changes status on priority change — enable both, and poke one ticket.
Execution stops at depth 3, two `suppressed` runs are recorded with their reason, and the application
stays responsive (SC-011).

---

## Scenario 6 — The alert reaches someone not looking at the screen (User Story 5)

1. Open `/admin/alerts/subscriptions`. Note that the in-app column is shown and **disabled** — it
   cannot be turned off (FR-073).
2. Enable email for the supervisory row on `sla.resolution_breached`.
3. Trigger a breach as in Scenario 2.
4. Read the simulator's outbox (the Phase 5 mechanism) — the alert is there, rendered in the
   recipient's language from locale content, not a hardcoded sentence (FR-080).
5. Break the email transport deliberately (a bad host in `.env`) and breach another ticket. **The
   escalation and the in-app notification still happen**, and the failed attempt is recorded in
   `alert_deliveries` with outcome `failed` (FR-075, FR-076).
6. Enable SMS for a user with no `alert_phone`. The delivery is recorded as `skipped`, not `failed` —
   "nobody was told" and "we tried and the gateway refused" are different facts, and FR-076 requires
   them to stay different.
7. Trigger 25 alerts for one recipient within an hour. The excess is recorded as `suppressed`, not
   silently discarded (FR-078).

---

## Manual passes the automated suite does not cover

Recorded so they are not mistaken for done. Phases 4 and 5 carry equivalents forward unfinished; these
are this phase's, and they belong in `tasks.md` as explicit tasks.

- **Real email and SMS gateways carrying an alert.** Every automated test runs against Phase 5's
  simulators by construction. The first real send is a configuration exercise, and it is the one thing
  here that cannot be proved in CI.
- **The default calendar against the organisation's actual working week.** Sun–Thu 09:00–17:00
  Africa/Cairo is a stated assumption from Clarifications Q1, not a discovered fact. It is the first
  thing an administrator should change, and it should be confirmed with whoever owns the SLA
  commitments before this phase is called done.
- **Greyscale.** Screenshot the queue and the ticket header with colour stripped; all four SLA states
  must remain identifiable by icon and text (FR-085).
- **Arabic RTL, by eye.** Countdowns and overdue phrases with a number embedded in translated prose
  are this phase's new i18n hazard. "left 3 hours working" is the failure to look for.
- **The rule builder by keyboard alone**, with a screen reader. Add, edit, remove, and reorder rules
  and rows with no pointer; confirm focus lands sensibly after every add and remove, and that changing
  a condition's field announces the reset of its operator and value. The reorder controls must work
  without dragging — happy-dom reaches the attributes and no further.
- **Two backend processes.** Still out of scope, and the failure mode is now worse than it was: a
  double-fired sweep escalates a ticket twice rather than duplicating a notification. Do not run two
  processes against one database until Phase 11 adds a lock.

---

## Troubleshooting

**Nothing escalates.** Check `ticket_sla.paused_at` is null, `resolution_satisfied_at` is null, and
that `resolution_escalated_for` does not already equal `resolution_target_at`. If the marker matches
the target, the ticket has already been escalated for this target and is behaving correctly.

**Targets look an hour out for part of the year.** That is the daylight-saving case
`lib/business-hours.ts` exists for. Run the DST test table before suspecting the calendar.

**A rule saves but never fires.** Check it is enabled — rules are created disabled on purpose
(FR-061) — and check `automation_runs` for `no_match` rows, which tell you the trigger fired and the
conditions did not hold.

**A rule fires but its action does nothing.** Read the run's `actions_applied`. An action executing
through a service that refuses it — an undeclared status transition, a deactivated assignee, an
opted-out customer — is recorded as failed with the reason. That is the design (research D8), not a
bug: automation gets no authority a person would not have.
