# Feature Specification: Phase 6 — SLA & Automation

**Feature Branch**: `007-phase-6-sla-automation`

**Created**: 2026-08-31

**Status**: Draft

**Input**: User description: "Implement SLA policy management with configurable response/resolution targets, automatic ticket assignment rules, automatic SLA-breach escalation, multi-channel automated alerts, and a trigger-condition-action rule builder for custom automation."

**PLAN.md Reference**: Phase 6 — SLA & Automation

**Depends on**: Phase 1 — Security & Administration Foundations (users, roles, permissions, audit),
Phase 3 — Ticket Management (Core) (the lifecycle a clock runs against, the assignment authority a
policy inherits, and the history every automated act must appear in),
Phase 4 — Agent Dashboard (the due-date seam a computed target replaces, and the notification
delivery an alert reuses),
Phase 5 — Communication Channels (the inbound events a rule can trigger on, the outbound transports
an alert travels over, and the first-response clock's stop condition)

## Overview

Phases 0–5 built a system that does what it is told. Phase 6 gives it a mandate.

The distinction matters more than it sounds. This codebase already does two things on its own
initiative — the task-reminder sweep and the approaching-due warning, both added in Phase 4 — but
both are strictly _observers_: they read state, write a notification, and set a marker so they do not
write the same notification twice. Neither has ever changed a ticket. PLAN.md's Definition of done
for this phase ends that: _"A ticket that breaches its SLA escalates and notifies the right people
without manual intervention."_ Escalation is a status change. So from this phase on, the record can
be altered by something that is not a person.

Four consequences follow, and each one is a first for this codebase.

**Elapsed time becomes a correctness concern, not a display concern.** Every phase so far treated
time as a timestamp: something to record, sort by, and render in the viewer's locale. Phase 4 came
closest with a due date, but that date was a promise a human typed, and the system's only job was to
compare it to the clock. Phase 6 has to _derive_ the date, which means answering questions nobody has
had to answer yet: does the clock run overnight and at the weekend; does it keep running while the
organisation is waiting on the customer; what happens to a target when a ticket is reopened three
weeks after it was closed; and which of two policies applies when a ticket is both `urgent` and
`billing`. None of these are implementation details — each one changes whether a given ticket is
reported as breached, and therefore whether someone is woken up.

**Authority moves from a person to a policy, without being taken away from the person.** Phase 3
fixed ticket assignment as Supervisor-only and Phase 4 honoured it: an agent cannot claim their own
work, and the dashboard is deliberately read-only with respect to assignment. Automatic assignment
looks like a direct contradiction of that rule, and this spec treats it as the opposite — a
Supervisor still decides who works on what, but decides it _in advance and in general_ by configuring
a policy, rather than _afterwards and individually_ by touching each ticket. That reading is what
keeps Phase 3's constraint intact, and it has a hard consequence recorded in FR-051: no agent may
configure the assignment policy, because doing so would be self-assignment through a longer route.

**Untrusted input can now cause a state change.** Phase 5 opened the system to the public internet
but confined what arriving input could do: create a ticket, append a message, resolve to a customer.
A rule builder whose triggers include _"a message arrived"_ means a stranger's email can now flip a
status, reassign work, and send an alert. The rule engine is therefore a security surface, not a
convenience feature, and the ordinary protections do not cover it — the sender is not a user, so no
permission check applies at the moment the rule fires. What applies instead is bounded authority
(rules may only take actions the catalog names), loop prevention (an action must not be able to
re-trigger the rule that produced it), and attribution (every automated act is recorded as the work
of the rule that caused it, naming a configuring Supervisor).

**The system starts speaking without being asked.** Phase 5's outbound transports were built for an
agent pressing send on a reply they wrote. PLAN.md's alerts bullet points those same transports at
messages nobody composed, triggered by a clock. That changes the risk: a misconfigured rule with an
email or SMS action is a machine that can send thousands of messages to real phone numbers at real
cost, and Phase 5's per-conversation rate limits were never designed to stop it.

Phase 6 also inherits three decisions it must not quietly undo. Phase 4 built its due date, queue
sort, overdue indicator, and warning notification against a seam it stated explicitly (Phase 4
FR-028): _nothing consuming the due date may assume a human set it_, so Phase 6 supplies it from a
computed target without those consumers being rebuilt. Phase 4's tasks are personal (Phase 4
Clarifications Q3), so no automation action may create a task for someone else. And Phase 5's
automated-mail detection exists to stop two machines corresponding forever; a rule that sends an
automatic reply must respect it rather than route around it.

## Clarifications

### Session 2026-08-31

Three questions were raised during `/speckit-specify`. The first is not a gap in PLAN.md but an
explicit unresolved item in the project constitution — _"SLA response/resolution time targets (needed
before Phase 6)"_ — now due. The other two are points where PLAN.md's Phase 6 scope depends on a
decision an earlier phase deliberately deferred to this one. All three are resolved; no
`[NEEDS CLARIFICATION]` markers remain.

- **Q1 — What are the SLA targets, and does the clock respect business hours?** Durations mean
  nothing until it is settled whether four hours is four hours of wall clock or four working hours,
  and PLAN.md names neither the convention nor the numbers. **Decision: durations are working time
  against a configurable business calendar**, defaulting to Sunday–Thursday, 09:00–17:00, Africa/Cairo,
  with an administrable list of non-working days. The wall-clock reading is cheaper to build and
  wrong in a way that discredits the whole feature: a ticket arriving at 18:00 breaches before anyone
  is at work, and an organisation whose first live week produces breaches nobody mishandled stops
  believing the numbers. The default targets are stated in FR-009 and are editable like any other
  policy. See FR-025 and FR-025a–FR-025c.
- **Q2 — How does a computed SLA target relate to Phase 4's manually set due date?** Phase 4 recorded
  this as a decision Phase 6 must make and must not get wrong: _"Phase 6 must decide whether a
  computed SLA target overrides a manually set date, sits beside it, or migrates it — and must not
  assume this phase's dates were machine-generated."_ **Decision: the resolution target computes the
  due date, and a human override outranks it permanently.** A policy fills the date nobody typed; a
  person who types one is making a commitment the policy does not know about — usually one agreed with
  the customer — and a policy must never quietly overwrite it. The two alternatives each break
  something: retiring manual setting leaves `tickets:set_due_date` enforcing nothing and makes
  negotiated deadlines unrepresentable, and a separate SLA date beside an untouched due date puts two
  competing meanings of "late" on one queue row. See FR-024 and FR-024a–FR-024d.
- **Q3 — Does "skill-based" automatic assignment require a skills model on users?** PLAN.md lists
  round-robin, load-based, and skill-based strategies, but users currently carry no skill, team, or
  department attribute, and departments are Phase 12 work. **Decision: a minimal competency model —
  the set of ticket categories a user is competent in — and skill-based routing means "an agent
  competent in this ticket's category", falling back to load-based when none is available.** Phase 3's
  category taxonomy is already the axis along which this organisation classifies work, so reusing it
  satisfies PLAN.md's bullet without inventing a second classification, and without teams, which do not
  exist until Phase 12. A full skills model with named skills and proficiency levels is the
  speculative abstraction the constitution's YAGNI rule prohibits. See FR-044 and FR-044a–FR-044d.

**Q1 has a consequence worth carrying forward.** Because targets are working-time, every SLA number
in the system depends on a calendar an administrator can change. FR-029 is what stops that becoming a
retroactive rewrite of commitments already made: a target's absolute time is stored when it is
computed, so editing the calendar changes future targets only.

**Q2 has a consequence worth carrying forward.** A ticket's due date now has two possible authors, so
every surface that shows it must be able to say which — and Phase 4's tests, written when the answer
was always "a person", remain correct precisely because FR-028 forbade them to depend on it.

**Q3 has a consequence worth carrying forward.** Competency is per-category and per-user, with no
levels and no teams. Phase 12 introduces departments, and the routing question will be reopened
there; this phase must not build a structure that presumes the answer.

## User Scenarios & Testing _(mandatory)_

### User Story 1 — A Ticket Knows When It Is Due Without Anyone Typing a Date (Priority: P1)

An administrator configures the organisation's service commitments once: how quickly a first reply is
owed, and how quickly the matter should be resolved, for each combination of priority and category
that needs its own promise. From then on every new ticket carries both targets from the moment it
exists — visible on the ticket, sortable in the agent's queue, and identical for a supervisor in
Cairo and a manager in London.

**Why this priority**: Nothing else in this phase can be built or tested without it. Escalation,
alerts, and every SLA-related rule condition are statements about a target; with no target there is
nothing to breach. It is also the phase's only _replacement_ of existing behaviour rather than an
addition, so it must land first and be proven not to have broken Phase 4's queue.

**Independent Test**: Configure one policy, raise a ticket matching it, and confirm both targets
appear on the ticket and drive Phase 4's existing due-date column, overdue indicator, and approaching
warning with no change to those surfaces. Delivers value alone: agents stop guessing what "soon"
means.

**Acceptance Scenarios**:

1. **Given** a policy setting a 4-hour first-response and 2-day resolution target for `urgent`
   priority, **When** an urgent ticket is raised, **Then** the ticket shows both targets computed
   from its creation time, and the resolution target drives the queue's due-date sort.
2. **Given** two policies, one matching `urgent` priority and one matching `billing` category,
   **When** an urgent billing ticket is raised, **Then** exactly one policy applies, chosen by a
   documented and deterministic precedence rule, and the ticket records which one.
3. **Given** a ticket whose priority is raised from `normal` to `urgent` after creation, **When** the
   change is saved, **Then** the targets are recomputed under the newly matching policy, the change
   is recorded in the ticket's history with previous and new value, and time already elapsed is not
   forgotten.
4. **Given** a ticket matching no configured policy, **When** it is raised, **Then** it is accepted
   with no SLA target rather than refused, and is never reported as breached.
5. **Given** an administrator edits a policy's targets, **When** the change is saved, **Then**
   tickets already open under that policy behave according to the rule stated in FR-018, and the edit
   appears in the audit log.

---

### User Story 2 — A Breach Escalates and Reaches the Right People With Nobody Watching (Priority: P1)

A ticket's resolution target passes with the matter unresolved. Without anyone opening a screen, the
ticket escalates, its assignee and their supervisor are told, and the record says plainly what
happened, when, and that a policy — not a colleague — did it.

**Why this priority**: This _is_ PLAN.md's Definition of done for the phase, stated almost verbatim.
Every other story is either upstream of it or an elaboration on it.

**Independent Test**: With a controlled clock, advance past a ticket's resolution target and confirm
the escalation, the notifications, the history entry, and the audit record all appear exactly once —
and that advancing the clock further produces no second escalation.

**Acceptance Scenarios**:

1. **Given** an open ticket whose resolution target has passed, **When** the breach is detected,
   **Then** the ticket's status becomes Escalated, the ticket records why, and the assignee and the
   supervisory recipients are notified.
2. **Given** a ticket that has already been escalated for a breach, **When** detection runs again,
   **Then** nothing further happens — no second status change, no repeated notification.
3. **Given** a ticket approaching but not past its target, **When** the near-breach threshold is
   crossed, **Then** a warning reaches its assignee, and the ticket is **not** escalated.
4. **Given** a breached ticket with no assignee, **When** the breach is detected, **Then** the
   escalation still happens and the notification goes to the supervisory recipients rather than being
   silently dropped for want of an assignee.
5. **Given** the application was stopped for two hours and a target passed during that time, **When**
   it starts again, **Then** the breach is detected on the next detection pass; nothing depends on
   the system having been running at the moment the target passed.
6. **Given** a ticket that is merged or closed, **When** detection runs, **Then** it is never
   escalated and never reported as breached.

---

### User Story 3 — An Arriving Ticket Finds an Owner by Itself (Priority: P1)

Overnight, a customer emails. The ticket that arrives does not sit unassigned until morning: the
configured assignment policy picks an eligible agent, the ticket lands in that agent's queue, and the
agent is notified — the same notification a Supervisor's manual assignment would have produced.

**Why this priority**: PLAN.md names automatic assignment as a scope bullet, and it is the half of
"without manual intervention" that concerns _work_, not _warnings_. It is also what makes Phase 5's
unattended intake actually unattended: a channel that produces tickets nobody owns has moved the
bottleneck rather than removed it.

**Independent Test**: Configure round-robin, raise several tickets with no assignee, and confirm they
distribute across eligible agents, each producing the ordinary assignment notification and history
entry attributed to the policy.

**Acceptance Scenarios**:

1. **Given** an active round-robin policy and three eligible agents, **When** six tickets are raised
   unassigned, **Then** each agent receives two, and each assignment appears in the ticket's history
   attributed to the automation rather than to a person.
2. **Given** an active load-based policy, **When** a ticket is raised, **Then** it goes to the
   eligible agent with the fewest open tickets, and a documented tie-break decides between equals.
3. **Given** no eligible agent exists — none active, none permitted, or all at their configured
   ceiling — **When** a ticket is raised, **Then** it remains unassigned, the attempt and its reason
   are recorded, and the supervisory recipients are alerted rather than the ticket vanishing into an
   unwatched state.
4. **Given** a ticket a Supervisor has already assigned by hand, **When** automatic assignment runs,
   **Then** it does not reassign it; a human decision outranks a policy.
5. **Given** an agent who does not hold the permission to work tickets, or whose account is
   deactivated or locked, **When** assignment runs, **Then** that agent is never selected.
6. **Given** an agent attempts to configure the assignment policy, **When** the request is made,
   **Then** it is refused server-side, because configuring it would be self-assignment by a longer
   route (Phase 3 Clarifications Q3).

---

### User Story 4 — A Supervisor Automates a Routine Without Writing Code (Priority: P2)

A supervisor is tired of doing the same thing every morning: every complaint that arrives by WhatsApp
needs raising to high priority and flagging to the complaints lead. They build the rule from a screen
— choose when it runs, add the conditions that narrow it, pick the actions it takes — check against
recent tickets what it _would_ have done, then switch it on.

**Why this priority**: PLAN.md names the trigger-condition-action builder as a scope bullet, and it
is the phase's general-purpose half: SLA escalation is one hard-wired rule, and the builder is how
the organisation adds the rest without a release. It is P2 rather than P1 because the Definition of
done does not depend on it.

**Independent Test**: Build one rule with a trigger, a condition, and an action; confirm it fires on
a matching ticket, does not fire on a non-matching one, can be disabled, and reports what it did.

**Acceptance Scenarios**:

1. **Given** a rule triggered by ticket creation, conditioned on category `complaint` and source
   `whatsapp`, with a set-priority action, **When** a matching ticket arrives, **Then** the priority
   changes, the history shows the rule as the actor, and the run is recorded.
2. **Given** the same rule, **When** a ticket arrives by email instead, **Then** the rule does not
   fire, and the non-match is not reported as an error.
3. **Given** a rule with several conditions, **When** it is evaluated, **Then** every condition must
   hold for the rule to fire, and the interface states this unambiguously in both languages.
4. **Given** two enabled rules that both match one event, **When** the event occurs, **Then** they
   run in a defined, user-visible order, and the outcome does not depend on chance.
5. **Given** a rule whose action would re-trigger itself, or a pair of rules that would trigger each
   other, **When** the event occurs, **Then** execution stops at a stated bound and the suppression
   is recorded rather than the system looping.
6. **Given** a rule under construction, **When** the supervisor asks what it would do, **Then** they
   are shown the tickets it would have matched without any change being made.
7. **Given** a rule that is disabled, **When** a matching event occurs, **Then** nothing happens, and
   re-enabling it does not retroactively act on events that passed while it was off.

---

### User Story 5 — The Alert Reaches Someone Who Is Not Looking at the Screen (Priority: P2)

A breach happens at 02:00. The in-application notification is waiting when the agent signs in, but
the escalation also reaches the duty supervisor by email, and — for the cases configured as severe
enough to justify it — by SMS.

**Why this priority**: PLAN.md names in-app, email, and SMS alerts explicitly. It is separated from
User Story 2 because escalation is correct and useful with in-application delivery alone; the extra
transports are additive, and depend on Phase 5 credentials that may not be present in every
environment.

**Independent Test**: Trigger one alerting event and confirm the in-application notification always
arrives, the email and SMS attempts are made only where enabled and addressable, and a transport
failure never prevents the underlying escalation.

**Acceptance Scenarios**:

1. **Given** an alerting event, **When** it fires, **Then** the in-application notification is
   created for every recipient regardless of any other transport's availability.
2. **Given** email alerting is unconfigured or failing, **When** an alert fires, **Then** the
   escalation and the in-application notification still happen, and the failed attempt is recorded.
3. **Given** a recipient with no reachable address for a configured transport, **When** an alert
   fires, **Then** that transport is skipped for that recipient without failing the alert.
4. **Given** a burst of alerting events for one recipient, **When** they fire, **Then** outbound
   volume per recipient stays within a configured ceiling, and suppressed alerts are recorded rather
   than discarded silently.
5. **Given** an alert whose recipient is a customer rather than a user, **When** it fires, **Then**
   Phase 5's opt-out and automated-mail rules are honoured exactly as they are for an agent's reply.
6. **Given** an alert body, **When** it is delivered, **Then** it is rendered in the recipient's
   language from locale content, never from a hardcoded sentence.

---

### User Story 6 — The Clock Stops While We Are Waiting on the Customer (Priority: P2)

An agent asks the customer for a missing invoice number and moves the ticket to Pending. Three days
pass. When the customer answers, the ticket is not reported as having blown its target — the time
spent waiting on someone outside the organisation is not counted against the organisation.

**Why this priority**: Without it, the first week of live use produces breaches for tickets nobody
mishandled, and the fastest way for an organisation to fix that is to stop trusting the SLA numbers
altogether. It is P2 because targets, escalation, and alerts are all demonstrable without pausing.

**Independent Test**: With a controlled clock, move a ticket to Pending, advance well past its
target, return it to Open, and confirm it is not breached and its target has moved by the paused
duration.

**Acceptance Scenarios**:

1. **Given** an open ticket with a resolution target, **When** it is moved to Pending, **Then** its
   clock stops and the ticket is not reported as breached during that period.
2. **Given** a paused ticket, **When** it returns to an active status, **Then** the clock resumes and
   the remaining time is what remained when it paused.
3. **Given** a ticket paused and resumed several times, **When** its target is read, **Then** the
   total paused duration is excluded once, not compounded or double-counted.
4. **Given** a resolved ticket that is reopened, **When** the reopening is saved, **Then** the rule
   stated in FR-030 applies, the ticket is not instantly reported as breached by an expired original
   target, and the history records what happened to the target.
5. **Given** a ticket whose first reply has been sent, **When** the first-response target is read,
   **Then** it is satisfied and stays satisfied; it is not re-armed by later correspondence.

---

### User Story 7 — A Supervisor Can See What Automation Did, and Why (Priority: P3)

Something changed a ticket overnight and no colleague admits to it. A supervisor opens the automation
record and finds the rule, the trigger, the ticket, the action taken, the time, and — where nothing
happened — the reason it was skipped.

**Why this priority**: It is the difference between automation the organisation trusts and automation
it switches off. It is P3 because every automated act is already attributed in the ticket's history
and the audit log, so this story is a dedicated _view_ over facts the earlier stories must record
anyway.

**Independent Test**: Fire several rules — some acting, some not matching, some suppressed by the
loop bound, some failing — and confirm each outcome is retrievable with its reason.

**Acceptance Scenarios**:

1. **Given** a rule that acted, **When** the automation record is read, **Then** it names the rule,
   the triggering event, the ticket, the action, and the time.
2. **Given** a rule whose action failed, **When** the record is read, **Then** the failure is visible
   and distinguishable from a rule that simply did not match.
3. **Given** a user without the automation permission, **When** they request the record, **Then** the
   request is refused server-side, not merely hidden in the interface.
4. **Given** an automated act on a ticket, **When** the ticket's own history is read, **Then** the
   act appears there too, attributed to the automation rather than to a person.

---

### Edge Cases

- **A policy is edited while tickets are open under it.** Do live tickets keep the promise made when
  they were raised, or acquire the new one? FR-018 fixes this.
- **A policy is deleted while tickets reference it.** The ticket must not lose the record of what it
  was measured against (FR-019).
- **Two policies match equally.** Precedence must be total and deterministic, not "whichever the
  database returned first" (FR-013).
- **A ticket's category or priority changes mid-life.** Targets recompute, but elapsed time must not
  be silently forgiven or double-charged (FR-017).
- **A ticket already carries a due date a human set** through the Phase 4 surface at the moment a
  policy would compute one. FR-024 decides which wins.
- **The application is down when a target passes.** Detection must be a state comparison, not a
  "since last run" ledger — the pattern Phase 4's sweeps already established (FR-035).
- **Two application processes run detection at once.** A duplicate escalation is the failure mode to
  bound; the marker and the act must commit together (FR-034).
- **A rule's action changes a field its own condition tests**, or two rules trigger each other.
  Bounded execution and cycle suppression (FR-062–FR-064).
- **A rule tries to do something no user could do** — assign to a deactivated agent, transition a
  status the lifecycle forbids, act on a merged ticket. The rule engine gets no privilege the
  lifecycle does not grant (FR-058).
- **A rule with an outbound action fires on a bulk import or a mail loop**, producing thousands of
  messages. Ceilings and Phase 5's automated-mail detection apply (FR-074, FR-078).
- **Every agent is at capacity, or none is eligible.** Assignment must fail visibly rather than
  quietly leaving a ticket nobody owns (FR-048).
- **An agent is deactivated holding a full queue.** Automatic assignment must stop selecting them;
  their existing tickets are a supervisory matter, not an automation one (FR-045).
- **A breach is detected for a ticket whose assignee is also a supervisory recipient.** One
  notification, not two (FR-041).
- **The near-breach and the breach fall in the same detection pass** (a very short target). The
  ticket must not be warned and escalated in a way that reads as duplicate noise (FR-037).
- **Business-hours boundaries**: a target computed at 17:55 on the last working day of the week, with
  a public holiday immediately after (FR-025–FR-029).
- **A competency-based policy is active and no competent agent is eligible.** The ticket must still
  reach an owner through the fallback rather than waiting for a competency nobody has (FR-044b).
- **An administrator edits the business calendar after targets are computed.** Commitments already
  made must not move (FR-029); only future targets use the new calendar.
- **Daylight-saving transitions and multiple time zones.** A target expressed in hours must not
  change length twice a year, and "overdue" must mean one thing for all viewers (FR-011, FR-028).

## Requirements _(mandatory)_

### Functional Requirements

#### SLA policy configuration

- **FR-001**: Administrators MUST be able to create, view, edit, and deactivate SLA policies.
- **FR-002**: A policy MUST carry a first-response target and a resolution target, each expressed as
  a duration.
- **FR-003**: A policy MUST be scopeable by ticket priority, by ticket category, or by both, and MUST
  support a catch-all scope that matches any ticket.
- **FR-004**: A policy's name MUST be presented to users in the active language from stored content
  rather than a hardcoded label, so an Arabic interface never shows an untranslated English name.
- **FR-005**: A policy MUST be deactivatable without being deleted, and a deactivated policy MUST NOT
  match any new ticket.
- **FR-006**: Creating, editing, activating, and deactivating a policy MUST be recorded in the audit
  log with previous and new values.
- **FR-007**: Policy configuration MUST require a permission distinct from viewing tickets, and MUST
  be refused server-side to users without it.
- **FR-008**: Target durations MUST be validated: each MUST be a positive duration, and a resolution
  target MUST NOT be shorter than its policy's first-response target.
- **FR-009**: The system MUST ship with a default set of policies so that a fresh installation
  measures something rather than nothing, and those defaults MUST be editable like any other policy.
  The defaults, expressed in working time per Q1, are one policy per priority:

  | Priority | First response | Resolution |
  | -------- | -------------- | ---------- |
  | `urgent` | 1 hour         | 4 hours    |
  | `high`   | 4 hours        | 1 day      |
  | `normal` | 8 hours        | 3 days     |
  | `low`    | 1 day          | 5 days     |

  A "day" here means one working day as the business calendar defines it (FR-025a).

#### Targets and the SLA clock

- **FR-010**: Every ticket MUST, at creation, acquire the first-response and resolution targets of
  the single policy that matches it, or no target at all if none matches.
- **FR-011**: Targets MUST be computed and evaluated against one authoritative server-side clock, so
  that "due" and "breached" mean the same thing for every viewer in every time zone.
- **FR-012**: A ticket MUST record which policy produced its targets.
- **FR-013**: Policy matching MUST be deterministic and total: where several active policies match a
  ticket, exactly one MUST be selected by a documented precedence, and that precedence MUST be
  visible to the administrator configuring the policies.
- **FR-014**: A ticket matching no policy MUST be accepted, MUST carry no target, and MUST NEVER be
  reported as approaching or breaching one.
- **FR-015**: The first-response target MUST be satisfied by the first outbound customer-visible
  message on the ticket, and MUST NOT be satisfiable by an internal note.
- **FR-016**: Once satisfied, the first-response target MUST stay satisfied for the life of the
  ticket; later correspondence MUST NOT re-arm it.
- **FR-017**: Changing a ticket's priority or category MUST re-evaluate which policy applies and
  recompute its targets from the ticket's original start time and accumulated paused time, so that
  elapsed time is neither forgiven nor charged twice. The recomputation MUST appear in the ticket's
  history with previous and new target values.
- **FR-018**: Editing a policy MUST NOT retroactively change the targets of tickets already open
  under it; live tickets keep the promise made when they were raised. Recomputation happens only when
  the ticket itself changes in a way FR-017 covers.
- **FR-019**: A policy that tickets reference MUST NOT be hard-deleted; deactivation is the only
  removal, so that a ticket's record of what it was measured against stays readable.
- **FR-020**: A ticket's target times, its remaining time, and whether each target is met, at risk,
  or breached MUST be readable from the ticket and from the agent's queue.
- **FR-021**: The SLA clock MUST pause while a ticket is in a status that represents waiting on
  someone outside the organisation, and MUST resume when it returns to an active status.
- **FR-022**: Total paused duration MUST be accumulated across any number of pause and resume cycles
  and excluded exactly once from elapsed time.
- **FR-023**: Pausing and resuming MUST be derived from Phase 3's declared lifecycle transitions, not
  from a second parallel state machine.
- **FR-024**: A computed target MUST integrate with Phase 4's due date through the seam Phase 4
  FR-028 established: everything already consuming the due date — the queue sort, the overdue
  indicator, the approaching-due warning — MUST continue to work unchanged, without assuming a human
  set the value. Specifically, the resolution target MUST populate the ticket's due date
  (Clarifications Q2).
- **FR-024a**: A due date a user sets by hand MUST override the computed one, MUST NOT be recomputed
  by any later policy evaluation, and MUST survive the priority and category changes FR-017 covers.
- **FR-024b**: A ticket MUST record whether its due date came from a policy or from a person, and
  every surface that shows the date MUST be able to distinguish the two.
- **FR-024c**: Due dates set by hand before this phase existed MUST be treated as human-set
  overrides, not as machine-generated values to be replaced.
- **FR-024d**: Clearing a human override MUST return the ticket to the computed target rather than
  leaving it with no due date, unless its policy produces none.
- **FR-025**: SLA durations MUST be interpreted as working time against a configurable business
  calendar (Clarifications Q1), and that interpretation MUST be identical for target computation,
  breach detection, and any displayed countdown.
- **FR-025a**: The calendar MUST define the working week, the working hours within a day, and the
  time zone those hours are expressed in, and MUST default to Sunday–Thursday, 09:00–17:00,
  Africa/Cairo.
- **FR-025b**: A duration expressed in days MUST mean working days as the calendar defines them, and
  a duration expressed in hours MUST mean working hours; the two MUST agree — one working day of
  hours MUST equal one working day.
- **FR-025c**: A target computed outside working hours MUST begin accruing at the next working moment
  rather than consuming time nobody was working.
- **FR-026**: The working week, working hours, and time zone MUST be configurable by an administrator
  rather than assumed, and changes MUST be recorded in the audit log.
- **FR-027**: Non-working days MUST be administrable as a list of dated exceptions, so that a public
  holiday does not consume a target.
- **FR-028**: Working-time arithmetic MUST be correct across daylight-saving transitions: a target
  expressed in hours MUST NOT change length because a clock moved.
- **FR-029**: A target's computed absolute time MUST be stored rather than recomputed on each read,
  so that a later change to the calendar cannot silently move a commitment already made.
- **FR-030**: Reopening a resolved or closed ticket MUST NOT report it as instantly breached by an
  expired original target. The reopened ticket MUST acquire a fresh resolution target under the
  currently matching policy, and the history MUST record both the original outcome and the new
  target.
- **FR-031**: A merged ticket MUST NOT carry a live target, be reported as breached, or be escalated;
  it is a redirect, per Phase 3.
- **FR-032**: A closed ticket MUST NOT be reported as approaching or breaching a target, consistent
  with Phase 4 FR-027.

#### Breach detection and automatic escalation

- **FR-033**: The system MUST detect, without human action, that a ticket has passed its
  first-response or resolution target.
- **FR-034**: Detection MUST be idempotent: each breach MUST produce its escalation, notifications,
  and records exactly once, with the marker that prevents repetition committing in the same
  transaction as the act it records.
- **FR-035**: Detection MUST NOT depend on the system having been running at the moment a target
  passed; a target that expired during downtime MUST be detected on the next pass after restart.
- **FR-036**: On a resolution-target breach the ticket MUST be escalated, and the reason MUST be
  recorded on the ticket in a form the interface can render in either language.
- **FR-037**: The system MUST detect an approaching target at a configurable lead time and warn
  without escalating. Where the warning and the breach would fire in the same pass, the ticket MUST
  NOT receive both.
- **FR-038**: Automatic escalation MUST honour Phase 3's lifecycle declaration. Where the ticket's
  current status cannot legally reach Escalated, the escalation MUST be recorded as attempted and
  refused, with its reason, rather than forcing an undeclared transition.
- **FR-039**: Every automatic escalation MUST appear in the ticket's history attributed to the system
  rather than to a user, using the existing system-actor convention.
- **FR-040**: Every automatic escalation MUST be recorded in the audit log.
- **FR-041**: An escalation MUST notify the ticket's assignee where it has one, and MUST always
  notify the configured supervisory recipients; an unassigned breached ticket MUST NOT go unreported,
  and a recipient who is both assignee and supervisor MUST receive one notification, not two.
- **FR-042**: A ticket already escalated for a given breach MUST NOT be re-escalated for the same
  breach, including after a manual de-escalation, unless a fresh target has since been armed.

#### Automatic assignment

- **FR-043**: Administrators MUST be able to configure an automatic assignment strategy, and to turn
  automatic assignment off entirely.
- **FR-044**: The available strategies MUST be three: round-robin among eligible agents,
  least-loaded-first by count of open assigned tickets, and competency-based routing on the ticket's
  category (Clarifications Q3).
- **FR-044a**: A user MUST be able to be recorded as competent in zero or more ticket categories, and
  that record MUST be maintainable by an administrator from a screen.
- **FR-044b**: Competency-based routing MUST select among eligible agents competent in the ticket's
  category, breaking ties by current load, and MUST fall back to least-loaded-first across all
  eligible agents when no competent agent is available — a ticket MUST NOT go unassigned merely for
  want of a recorded competency.
- **FR-044c**: Competency MUST be a set of categories with no proficiency levels, weightings, or
  team membership; those are Phase 12's concern and MUST NOT be anticipated here.
- **FR-044d**: Changing a user's competencies MUST be recorded in the audit log, because it changes
  where future work is routed.
- **FR-045**: An eligible agent MUST be active, not locked out, and hold the permission required to
  work a ticket. Deactivated, locked, and unpermitted users MUST NEVER be selected.
- **FR-046**: Each strategy MUST have a documented, deterministic tie-break so that two runs on
  identical state produce identical results.
- **FR-047**: A per-agent ceiling on concurrently assigned open tickets MUST be configurable, and an
  agent at their ceiling MUST NOT be selected.
- **FR-048**: Where no eligible agent exists, the ticket MUST remain unassigned, the attempt and its
  reason MUST be recorded, and the supervisory recipients MUST be alerted.
- **FR-049**: Automatic assignment MUST NOT overwrite an assignment a user made; a human decision
  outranks a policy.
- **FR-050**: An automatic assignment MUST produce the same downstream effects as a manual one — the
  assignee's notification, the ticket's history entry, the audit record — attributed to the
  automation rather than to a person.
- **FR-051**: Configuring automatic assignment MUST require the supervisory assignment authority
  Phase 3 established, and MUST be refused server-side to agents, because configuring it is
  self-assignment by a longer route.
- **FR-052**: Automatic assignment MUST NOT act on merged or closed tickets.
- **FR-053**: Concurrent assignment attempts on one ticket MUST NOT produce two assignees; the ticket
  ends with exactly one.

#### The automation rule builder

- **FR-054**: Users with the automation permission MUST be able to create, view, edit, enable,
  disable, and delete automation rules from a screen, without writing code or expressions.
- **FR-055**: A rule MUST consist of a trigger, zero or more conditions, and one or more actions.
- **FR-056**: The available triggers MUST be drawn from a fixed catalog covering at least: a ticket
  was created, a ticket's status changed, a ticket's priority changed, a ticket was assigned or
  unassigned, an inbound customer message arrived, and an SLA target was approached or breached.
- **FR-057**: The available conditions MUST be drawn from a fixed catalog over ticket, customer, and
  channel attributes, and MUST include at least priority, category, status, source channel, whether
  the ticket has an assignee, and SLA state.
- **FR-058**: The available actions MUST be drawn from a fixed catalog, and MUST include at least:
  set priority, set category, change status, assign to a named user, apply the assignment strategy,
  notify named users or a role, and send a customer-visible message on the ticket's channel. No
  action MUST be able to do something the ordinary lifecycle, permission, and channel rules forbid.
- **FR-059**: A rule MUST fire only when every one of its conditions holds, and the interface MUST
  state this explicitly in both languages rather than leaving the semantics to be inferred.
- **FR-060**: Where several enabled rules match one event, they MUST run in a defined order that the
  user can see and change, and the result MUST NOT depend on chance.
- **FR-061**: A disabled rule MUST have no effect, and enabling it MUST NOT retroactively act on
  events that occurred while it was disabled.
- **FR-062**: Rule execution MUST be bounded: an action that triggers further rules MUST NOT recurse
  beyond a stated depth.
- **FR-063**: A cycle — a rule whose action re-triggers itself, or a pair of rules that trigger each
  other — MUST be suppressed at the bound, and the suppression MUST be recorded, not silently
  swallowed.
- **FR-064**: A rule action MUST NOT re-trigger the same rule on the same ticket within one event's
  processing.
- **FR-065**: An action that fails MUST NOT abort the other, independent actions of the same rule,
  and every failure MUST be recorded with its reason.
- **FR-066**: A rule MUST be testable before it is switched on: the user MUST be able to see which
  recent tickets it would have matched, and what it would have done, without any change being made.
- **FR-067**: Every rule run MUST be recorded with the rule, the trigger, the subject ticket, the
  outcome, and the time — including runs that matched nothing, were suppressed, or failed.
- **FR-068**: Every act a rule performs on a ticket MUST also appear in that ticket's own history,
  attributed to the rule rather than to a person.
- **FR-069**: Creating, editing, enabling, disabling, and deleting a rule MUST be recorded in the
  audit log; a rule is configuration that changes what the system does to every future ticket.
- **FR-070**: Deleting a rule MUST NOT remove the record of what it already did.
- **FR-071**: Rule evaluation MUST NOT block the interaction that triggered it: a customer's message
  or an agent's save MUST NOT fail because a rule failed.

#### Automated alerts

- **FR-072**: Alerts MUST be deliverable in-application, by email, and by SMS.
- **FR-073**: The in-application notification MUST always be created, independently of every other
  transport, and MUST reuse Phase 4's notification store and live delivery rather than introducing a
  second mechanism.
- **FR-074**: Email and SMS delivery MUST go through Phase 5's channel transports, and MUST inherit
  their configuration, simulator default, opt-out handling, and automated-mail detection.
- **FR-075**: A transport that is unconfigured, unreachable, or failing MUST NOT prevent the
  underlying escalation, assignment, or rule action, and MUST NOT prevent the in-application
  notification.
- **FR-076**: Every delivery attempt and its outcome MUST be recorded, so that "nobody was told" is
  distinguishable from "we tried and the gateway refused".
- **FR-077**: A recipient with no reachable address for a transport MUST be skipped for that
  transport without failing the alert for other recipients.
- **FR-078**: Outbound alert volume MUST be bounded by a configurable ceiling per recipient per
  period; alerts suppressed by that ceiling MUST be recorded rather than discarded silently.
- **FR-079**: Which events alert whom, over which transports, MUST be configurable rather than
  hardcoded, at least to the granularity of event type and recipient role.
- **FR-080**: Alert content MUST be composed from locale content in the recipient's language, and
  MUST NOT contain hardcoded sentences in either language.
- **FR-081**: An alert MUST NOT disclose to its recipient anything the recipient could not see by
  opening the record it concerns.

#### Permissions, audit, and interface

- **FR-082**: SLA policy configuration, the business calendar, assignment-policy configuration, agent
  competencies, automation-rule management, and the automation record MUST each be gated by
  permissions enforced server-side, and MUST appear in the roles screen through the existing
  permission catalog.
- **FR-083**: Every new configuration screen MUST render correctly in Arabic (RTL) and English (LTR),
  with all text from locale files, and MUST meet the project's accessibility standard for keyboard
  navigation, labelling, contrast, and announced validation errors.
- **FR-084**: Durations, countdowns, and target times MUST be presented in a form that is
  unambiguous in both languages and correct in RTL, with numerals rendered per the active locale
  convention.
- **FR-085**: An SLA state shown to an agent — met, at risk, breached — MUST be distinguishable
  without relying on colour alone.
- **FR-086**: Automation and SLA activity MUST be attributed in the audit log to the configuring user
  where one exists and to the system where none does, and MUST NEVER be attributed to whichever user
  happened to trigger it.
- **FR-087**: All automation and SLA behaviour MUST be observable through the existing history, audit,
  and notification surfaces rather than only through a parallel record.

### PLAN.md Traceability

PLAN.md **Scope** bullets for Phase 6 map as follows:

| PLAN.md scope bullet                                                        | Requirements    | Verified by                             |
| --------------------------------------------------------------------------- | --------------- | --------------------------------------- |
| SLA policy configuration (response/resolution targets per priority/category) | FR-001–FR-032   | User Story 1, User Story 6, SC-001–SC-002 |
| Automatic ticket assignment (round-robin / load-based / skill-based)         | FR-043–FR-053   | User Story 3, SC-006, SC-007            |
| Automatic escalation on SLA breach or near-breach                            | FR-033–FR-042   | User Story 2, SC-003, SC-004, SC-005    |
| Automated alerts (in-app, email, SMS)                                        | FR-072–FR-081   | User Story 5, SC-009, SC-010            |
| Trigger-condition-action custom automation rule builder                      | FR-054–FR-071   | User Story 4, User Story 7, SC-008, SC-011, SC-012 |

PLAN.md **Definition of done** — _"A ticket that breaches its SLA escalates and notifies the right
people without manual intervention"_ — maps as follows:

| Definition of done clause    | Verified by                                              |
| ---------------------------- | -------------------------------------------------------- |
| "breaches its SLA"           | FR-010–FR-032, User Story 1, User Story 6, SC-001, SC-013 |
| "escalates"                  | FR-033–FR-042, User Story 2, SC-003, SC-004               |
| "notifies the right people"  | FR-041, FR-072–FR-081, User Story 5, SC-005, SC-009       |
| "without manual intervention"| FR-033, FR-035, FR-043, FR-054, SC-003, SC-006            |

**Carried forward from earlier phases.** Phase 4 FR-028 reserved the due date as the seam this phase
fills, and FR-024 honours it rather than building a parallel date. Phase 3 Clarifications Q3 fixed
assignment as supervisory, and FR-051 keeps it that way by refusing agents the assignment-policy
screen. Phase 4 Clarifications Q3 made tasks personal, which is why no rule action creates a task for
another user (FR-058). Phase 5's opt-out and automated-mail rules govern every outbound alert
(FR-074), and Phase 5's simulator-by-default posture means this phase's alerts are demonstrable with
no commercial account.

### Key Entities

- **SLA Policy**: A named service commitment — a first-response duration and a resolution duration —
  scoped to the tickets it governs by priority, category, both, or nothing. Active or inactive;
  edited but never deleted while referenced.
- **SLA Target**: The concrete pair of absolute times a policy produced for one ticket, together with
  the accumulated paused duration, which target has been satisfied, which has been breached, and
  whether the ticket's due date has since been overridden by a person. The ticket's own record of the
  promise made about it.
- **Business Calendar**: The organisation's working week, working hours, time zone, and dated
  non-working exceptions — the convention that turns a duration into an absolute time.
- **Assignment Policy**: The single active choice of how unassigned work is distributed, its
  eligibility rules, and its per-agent ceiling. Configuration, not a per-ticket record.
- **Agent Competency**: The set of ticket categories one user is recorded as competent in — the axis
  competency-based routing selects on, with no levels and no team membership.
- **Automation Rule**: A named, enableable trigger-condition-action definition with an explicit
  position in the run order, owned by the user who configured it.
- **Rule Run**: One evaluation of one rule against one event — what fired, on what, what it did or why
  it did not, and when. The record that makes automation answerable.
- **Alert Subscription**: The configured mapping from an event type to its recipients and the
  transports each should receive it on.
- **Alert Delivery**: One attempt to reach one recipient over one transport, and its outcome —
  including skipped and suppressed.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Every newly raised ticket that matches an active policy carries both computed targets
  from the moment it is created — 100% of the time, with no user action.
- **SC-002**: For any ticket, two viewers in different time zones and different languages read the
  same SLA state and the same target times.
- **SC-003**: A ticket whose resolution target passes is escalated and its recipients notified without
  any human action, within one detection interval of the target passing.
- **SC-004**: Repeated detection over a breached ticket produces exactly one escalation, one history
  entry, and one notification per recipient — verified by advancing a controlled clock across many
  passes.
- **SC-005**: No breach goes unreported: for every breached ticket at least one recipient is notified,
  including when the ticket has no assignee.
- **SC-006**: With automatic assignment active and eligible agents available, unassigned tickets reach
  an owner without a supervisor acting, and the distribution across eligible agents differs by no more
  than one ticket under round-robin.
- **SC-007**: No deactivated, locked, or unpermitted user is ever selected by automatic assignment,
  and no automatic assignment ever replaces one a person made.
- **SC-008**: A supervisor can build, test, and enable a working rule from the interface in under 5
  minutes without documentation or developer help.
- **SC-009**: An alerting event always produces its in-application notification, including when both
  the email and SMS transports are unconfigured or failing.
- **SC-010**: No recipient receives more alerts than the configured ceiling for a period, and every
  suppressed alert is retrievable with its reason.
- **SC-011**: A cyclic rule configuration terminates at the stated bound, is recorded, and leaves the
  application responsive — verified by test rather than by inspection.
- **SC-012**: For every automated act on a ticket, a supervisor can identify from the record which
  rule or policy caused it, and when, without inspecting logs or the database.
- **SC-013**: Time spent waiting on the customer is excluded from SLA elapsed time: a ticket paused
  for longer than its target and then resolved promptly is not reported as breached.
- **SC-014**: Phase 4's queue, due-date sort, overdue indicator, and approaching-due warning continue
  to work once targets are computed, with those phases' existing tests passing.
- **SC-015**: Every new screen passes bilingual (Arabic RTL / English LTR) and accessibility checks
  before the phase is accepted.
- **SC-016**: A ticket raised outside working hours is given the same amount of working time as one
  raised at the start of a working day, and a target spanning a configured non-working day is extended
  by exactly that day.
- **SC-017**: A due date a person set is never changed by any policy evaluation, and every surface
  showing a due date reports correctly whether a person or a policy set it.
- **SC-018**: Competency-based routing sends a ticket to a competent agent where one is eligible, and
  where none is, the ticket still reaches an owner rather than staying unassigned.

## Assumptions

Reasonable defaults chosen where PLAN.md did not specify. Each is a candidate for `/speckit-clarify`.

- **SLA policies are global.** There are no per-customer contracts, service tiers, or per-department
  policies; departments arrive in Phase 12 and customer tiers are not in PLAN.md.
- **One policy applies per ticket at a time**, rather than a stack of overlapping policies whose
  effects combine.
- **There is one business calendar for the organisation**, not one per policy, per category, or per
  team. Per-department calendars are Phase 12's concern.
- **The default policy set is per priority, not per category** (FR-009). Category-scoped policies are
  supported by FR-003 and simply not shipped as defaults.
- **Only two targets exist**: first response and resolution. Intermediate targets such as "next
  response" or "update every N hours" are not in PLAN.md's scope bullet.
- **Pending is the only paused status.** Phase 3's lifecycle declaration is read as: Pending means
  waiting on someone outside the organisation; New, Open, and Escalated are active.
- **Escalation means the Escalated status Phase 3 already declares**, not a new severity dimension or
  a management hierarchy. There is no multi-level escalation ladder, because there are no teams or
  supervisory chains until Phase 12.
- **"The right people" means the ticket's assignee plus the users holding a supervisory permission.**
  With no teams or departments, there is no narrower correct audience.
- **Detection runs on the existing in-process scheduler**, extending the pattern Phase 4 established
  rather than introducing a job queue or an external cron dependency. Its single-process limitation is
  inherited and remains a stated known limit.
- **Alerts to agents travel in-application and by email**; SMS to an agent depends on a reachable
  number, which the user record does not currently carry, so SMS alerting is exercised against
  customer recipients and against users only where an address is configurable.
- **Automation rules act on tickets.** Rules over customers, users, or knowledge-base content are not
  in PLAN.md's scope bullet.
- **The rule catalogs are fixed sets, not user-extensible expressions.** No scripting language, no
  free-text formulas, no outbound webhooks — a fixed catalog is what makes FR-058's bounded authority
  enforceable.
- **Automation runs against events, not on a schedule.** A time-based rule trigger beyond the SLA
  clock itself is not built; the SLA sweep is the phase's only timer.
- **Rule ordering is a single global sequence**, not a per-trigger sequence, so that "what runs first"
  has one answer.
- **The automation record is bounded by paging and retained rather than pruned**, following the audit
  log's precedent.
- **Test coverage follows the pattern Phases 1–5 established**: the generated permission matrix
  extends to the new modules automatically, and clock-dependent behaviour is tested with a controlled
  clock rather than by waiting on timers.

## Out of Scope

Recorded so later phases do not assume these were delivered here:

- **Per-customer or per-contract SLAs, service tiers, and priority accounts.**
- **Per-department or per-team policies, routing, and escalation chains** (Phase 12).
- **Proficiency levels, skill weighting, and any competency axis other than ticket category**
  (Clarifications Q3). Competency is a flat set of categories per user.
- **Per-department, per-team, or per-policy business calendars** (Phase 12). One calendar governs the
  organisation.
- **SLA reporting, compliance dashboards, breach trend analysis, and agent performance measurement**
  (Phase 10).
- **Customer-facing visibility of SLA state or targets** (Phase 8).
- **AI-assisted routing, prioritisation, or suggested actions** (Phase 9).
- **Outbound webhooks, external system triggers, and ERP-driven automation** (Phase 11).
- **Knowledge-base article suggestion as a rule action** (Phase 7).
- **Agents claiming, releasing, or reassigning their own tickets.** Assignment remains supervisory
  (Phase 3 Clarifications Q3); this phase adds a policy, not a claim button.
- **Cross-user task creation as a rule action** (Phase 4 Clarifications Q3).
- **Rich alert content** — attachments, embedded media, or per-recipient templating beyond locale
  content.
- **Notification preferences, digests, quiet hours, and per-user muting.** Alert configuration in this
  phase is by event and role, not by individual preference.
- **A distributed scheduler, job queue, or multi-process locking.** The single-process limitation
  Phase 4 recorded is inherited unchanged.
