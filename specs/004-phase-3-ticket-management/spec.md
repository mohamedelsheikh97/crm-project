# Feature Specification: Phase 3 — Ticket Management (Core)

**Feature Branch**: `004-phase-3-ticket-management`

**Created**: 2026-08-28

**Status**: Draft

**Input**: User description: "Phase 3 — Ticket Management (Core)"

**PLAN.md Reference**: Phase 3 — Ticket Management (Core)

**Depends on**: Phase 1 — Security & Administration Foundations (agents and roles),
Phase 2 — Customer Management (tickets belong to customers)

## Overview

Phases 0–2 built who may act and who they act on. Phase 3 is the work itself: the ticket that
carries a customer's problem from the moment it arrives to the moment it is resolved.

Two things make this phase different from the ones before it.

**A ticket has a lifecycle, and a lifecycle is a set of rules about what may follow what.** Statuses
that anyone can set to anything are not a lifecycle — they are a text field with extra steps. The
value of New → Open → Pending → Escalated → Resolved → Closed is precisely what it *forbids*: a
ticket cannot be resolved before anyone opened it, and a closed ticket does not quietly become open
again without someone deciding to reopen it.

**The history is the deliverable, not a side effect.** PLAN.md's Definition of done says a ticket's
history must be "fully auditable" — and unlike Phase 1's audit log, which records administrative
events for an investigator, this history is read routinely by the agent picking up someone else's
ticket. It answers "what has already been tried?" It has to be complete enough to trust and legible
enough to skim.

Phase 3 is also the phase that finally makes `record.deleted` relevant: merging duplicate tickets is
the first operation in this project that genuinely removes something a user created.

## Clarifications

### Session 2026-08-28

Three questions were raised during `/speckit-specify`, all where PLAN.md admits materially different
readings. All three are resolved; no `[NEEDS CLARIFICATION]` markers remain.

- **Q1 — Are categories fixed or Administrator-managed?** **Decision: a fixed list defined in this
  phase**, seeded and permanent in the same way Phase 1's three roles are. PLAN.md's Phase 1 scope
  listed "categories" among its empty configuration screens, but its Phase 3 scope says only
  "category and priority fields" — the narrower reading wins. The settings shell stays empty until a
  phase genuinely needs it, and category management remains an additive change later. See FR-013.
- **Q2 — Who may close and reopen?** **Decision: an Agent may close their own resolved work; only a
  Supervisor may reopen.** An Agent finishes without waiting on anyone, while reopening — undoing a
  completed piece of work — is the act that needs more authority. No supervisor review queue is
  created. See FR-021.
- **Q3 — May an Agent self-assign?** **Decision: no. Only a Supervisor assigns**, including from the
  unassigned pool. Assignment is directed work rather than something claimed. See FR-026.

**Q3 has a consequence worth carrying forward.** Because an Agent cannot claim a ticket, an
unassigned ticket waits on a Supervisor, and Phase 4's agent dashboard is **read-only with respect to
assignment** — an Agent sees their queue but cannot add to it. That is a deliberate workflow choice,
not an oversight, and Phase 4 must be specified against it rather than assuming a claim action
exists.

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Agent Logs a Customer's Problem (Priority: P1)

A customer calls. The Agent finds them, creates a ticket describing what is wrong, sets a category
and a priority, and the ticket exists with a reference the customer can be given. Nothing else has to
happen for that call to end well.

**Why this priority**: Creation is the entry point to everything else in the phase, and it is the
first half of PLAN.md's Definition of done. Until a ticket can be created, none of the lifecycle,
assignment, or history has anything to act on.

**Independent Test**: Create tickets against a customer with each category and priority; confirm each
appears in the ticket list with a reference, its customer attached, and a status of New.

**Acceptance Scenarios**:

1. **Given** an Agent is viewing a customer, **When** they create a ticket with a subject,
   description, category, and priority, **Then** the ticket is created against that customer with a
   human-readable reference and a status of **New**.
2. **Given** a ticket is created, **When** it is saved, **Then** it records who created it and when.
3. **Given** an Agent omits the subject or the category, **When** they submit, **Then** the form
   explains what is missing rather than creating an incomplete ticket.
4. **Given** a ticket exists, **When** anyone views it, **Then** its reference is stable and unique
   and can be read aloud to a customer without ambiguity.
5. **Given** a deactivated customer, **When** an Agent attempts to create a ticket against them,
   **Then** the system prevents it, because a deactivated customer is not being supported.
6. **Given** a user whose role does not permit creating tickets, **When** they attempt it, **Then**
   the server refuses — not merely hiding the screen.

---

### User Story 2 — Ticket Moves Through Its Lifecycle (Priority: P1)

An Agent picks up a New ticket, works it, waits on the customer, and eventually resolves it. Each
move is a deliberate transition the system permits; a move that makes no sense is refused with a
reason.

**Why this priority**: This is the substance of PLAN.md's Definition of done — "moved through its
full lifecycle". A status field that accepts any value is not a lifecycle and delivers none of its
value.

**Independent Test**: Walk a ticket through every permitted transition and confirm each succeeds;
attempt several forbidden ones and confirm each is refused with an explanation.

**Acceptance Scenarios**:

1. **Given** a New ticket, **When** an Agent begins work, **Then** it becomes **Open**.
2. **Given** an Open ticket, **When** the Agent is waiting on the customer, **Then** it becomes
   **Pending**, and it can return to Open when the customer replies.
3. **Given** an Open or Pending ticket, **When** the Agent resolves it, **Then** it becomes
   **Resolved**.
4. **Given** a Resolved ticket, **When** it is closed, **Then** it becomes **Closed**.
5. **Given** a New ticket, **When** anyone attempts to move it directly to Resolved, **Then** the
   transition is refused and the reason names the statuses that *are* reachable.
6. **Given** a Closed ticket, **When** anyone attempts to edit its details, **Then** the system
   refuses — a closed ticket is a record, not a working document.
7. **Given** a Closed ticket, **When** a permitted user reopens it, **Then** it returns to a working
   status and the reopening is recorded as a deliberate act.
8. **Given** any status change, **When** it completes, **Then** the ticket's history records who
   changed it, from what, to what, and when.

---

### User Story 3 — Ticket Is Assigned to an Agent (Priority: P1)

A Supervisor assigns an unassigned ticket to an Agent; the Agent can see what is theirs. Assignment
can change hands, and the ticket remembers every hand it has passed through.

**Why this priority**: PLAN.md scopes manual assignment to this phase, and it is what makes a queue
of tickets into individual people's work. It is P1 alongside the lifecycle because Phase 4's agent
dashboard is built entirely on the answer to "which tickets are mine?".

**Independent Test**: Assign a ticket, reassign it, unassign it, and filter the list by assignee;
confirm each change is reflected immediately and recorded in the history.

**Acceptance Scenarios**:

1. **Given** an unassigned ticket, **When** a permitted user assigns it to an Agent, **Then** the
   ticket shows that Agent as its assignee.
2. **Given** an assigned ticket, **When** it is reassigned, **Then** the history records both the
   previous and the new assignee.
3. **Given** an assigned ticket, **When** it is unassigned, **Then** it returns to the unassigned
   pool and this is recorded.
4. **Given** tickets assigned to several people, **When** a user filters by assignee, **Then** only
   that person's tickets are listed.
5. **Given** a user attempts to assign a ticket to someone who is not an active user, **When** they
   submit, **Then** the assignment is refused.
6. **Given** an Agent whose role does not permit assigning, **When** they attempt to assign a ticket
   to someone else, **Then** the server refuses.

---

### User Story 4 — Ticket Is Escalated (Priority: P2)

An Agent hits something they cannot resolve — it needs a Supervisor, or a specialist, or simply more
authority. They escalate it, saying why. The ticket is visibly escalated, and the reason travels
with it.

**Why this priority**: PLAN.md scopes a manual escalation path to this phase. It is P2 because the
Definition of done is satisfied by creation, lifecycle, and history; escalation is a specific
lifecycle move that earns its own story because *why* it happened matters as much as *that* it
happened.

**Independent Test**: Escalate a ticket with a reason, confirm it is visibly escalated and the reason
is recorded, then de-escalate it back to a working status.

**Acceptance Scenarios**:

1. **Given** an Open or Pending ticket, **When** an Agent escalates it with a reason, **Then** the
   ticket becomes **Escalated** and the reason is recorded in its history.
2. **Given** an escalation, **When** the reason is omitted, **Then** the escalation is refused — an
   escalation without a reason tells the next person nothing.
3. **Given** an Escalated ticket, **When** a permitted user returns it to a working status, **Then**
   the de-escalation is recorded with who did it.
4. **Given** an Escalated ticket, **When** anyone views the ticket list, **Then** escalated tickets
   are distinguishable at a glance.
5. **Given** an Escalated ticket, **When** it is resolved, **Then** the transition is permitted —
   escalation is not a dead end.

---

### User Story 5 — Ticket History Answers "What Has Already Been Tried?" (Priority: P1)

An Agent picks up a ticket someone else has been working. Before doing anything they read its
history: what it was, what changed, who did what, and in what order. Nothing that happened to the
ticket is missing from it.

**Why this priority**: PLAN.md's Definition of done ends with "its history is fully auditable", and
this is the half most easily under-built. Unlike the Phase 1 audit log — read occasionally by an
investigator — this is read routinely by whoever picks the ticket up next.

**Independent Test**: Perform every kind of change to a ticket, then open its history and confirm
each appears in order with actor, time, and what changed.

**Acceptance Scenarios**:

1. **Given** a ticket that has been created, assigned, changed status, and edited, **When** its
   history is opened, **Then** every one of those events appears with who did it and when.
2. **Given** a field changed, **When** the history entry is read, **Then** it shows the previous and
   the new value.
3. **Given** a ticket history, **When** it is displayed, **Then** entries are ordered oldest first,
   so the ticket reads as a story rather than a stack.
4. **Given** any history entry, **When** anyone attempts to edit or delete it, **Then** no such
   capability exists.
5. **Given** a ticket with a long history, **When** it is opened, **Then** the history is paged
   rather than loaded whole.
6. **Given** a user permitted to view the ticket, **When** they open it, **Then** they can read its
   full history — the history is not more restricted than the ticket itself.

---

### User Story 6 — Duplicate Tickets Are Merged and Related Ones Linked (Priority: P2)

The same customer reports the same problem twice, or a second Agent logs a ticket for something
already in progress. Rather than two half-worked tickets, one is merged into the other and its
history comes with it. Separately, two genuinely different tickets that bear on each other can be
linked without either losing its identity.

**Why this priority**: PLAN.md scopes both to this phase. P2 because the Definition of done does not
name them, but they matter: duplicate tickets split a conversation the same way duplicate customers
split a history, which is the problem Phase 2 spent its whole budget preventing.

**Independent Test**: Create two tickets for the same issue, merge one into the other, and confirm
the survivor carries both histories and the merged one is no longer separately workable. Separately,
link two tickets and confirm each shows the other.

**Acceptance Scenarios**:

1. **Given** two tickets, **When** a permitted user merges one into the other, **Then** the surviving
   ticket carries the merged ticket's history, and the merge itself is recorded on both.
2. **Given** a merged ticket, **When** anyone opens it, **Then** it is clearly shown as merged and
   points at the surviving ticket.
3. **Given** a merged ticket, **When** anyone attempts to work it — change its status, assign it,
   edit it — **Then** the system refuses and directs them to the survivor.
4. **Given** two tickets for different customers, **When** a merge is attempted, **Then** the system
   warns, because merging across customers loses whose problem it was.
5. **Given** two related but distinct tickets, **When** a user links them, **Then** each shows the
   other, and neither loses its own status, assignee, or history.
6. **Given** a link, **When** a permitted user removes it, **Then** both tickets return to being
   unlinked, and the change is recorded.
7. **Given** a ticket, **When** anyone attempts to merge it into itself, **Then** the system refuses.

---

### Edge Cases

- **A forbidden transition attempted directly.** The lifecycle must be enforced on the server, not
  only by which buttons the interface offers.
- **Two Agents changing the same ticket at once.** The second must be told the ticket changed rather
  than silently overwriting the first.
- **A closed ticket that must be corrected.** Closed tickets are not editable, so the only route is
  reopening — which is itself recorded.
- **Assigning to someone who is later deactivated.** The ticket keeps a valid reference and the
  history stays readable; the ticket must not become unopenable.
- **Merging a ticket that is itself the target of a previous merge.** Chains must resolve to a single
  survivor rather than a trail of redirects.
- **Merging tickets in different statuses.** What the survivor's status becomes must be defined
  rather than incidental.
- **Linking a ticket to itself, or linking the same pair twice.** Both must be refused or made
  harmless.
- **A ticket whose customer is later deactivated.** Existing tickets stay workable — deactivating a
  customer must not strand open work.
- **A very large ticket list.** Listing, filtering, and history must stay usable as volume grows;
  none may load everything at once.
- **Escalation of an already-escalated ticket.** Must be harmless rather than producing a confusing
  double entry.
- **A history entry whose actor no longer exists as an active user.** The entry must remain readable
  and attributed.
- **Arabic subjects and descriptions.** Must store and redisplay exactly, and be searchable.

## Requirements _(mandatory)_

### Functional Requirements

#### Tickets

- **FR-001**: System MUST hold a ticket with, at minimum, a unique human-readable reference, a
  subject, a description, a category, a priority, a status, an owning customer, an optional assignee,
  and creation and update timestamps.
- **FR-002**: Every ticket MUST belong to exactly one customer, and that customer MUST exist.
- **FR-003**: Users with the appropriate permission MUST be able to create, view, list, and edit
  tickets.
- **FR-004**: Each ticket MUST carry a reference that is unique, stable, and readable aloud without
  ambiguity.
- **FR-005**: A ticket MUST record who created it.
- **FR-006**: Subject, category, and priority MUST be required at creation; a description MAY be
  optional but is expected.
- **FR-007**: System MUST prevent creating a ticket against a deactivated customer.
- **FR-008**: Deactivating a customer MUST NOT prevent their existing tickets from being worked or
  viewed.
- **FR-009**: Editing a ticket's details MUST be refused once it is Closed; correction requires
  reopening.
- **FR-010**: Concurrent edits MUST NOT silently lose a change; the later writer MUST be told the
  ticket changed.

#### Categories and priorities

- **FR-011**: System MUST provide a set of ticket categories.
- **FR-012**: System MUST provide a set of priorities ordered by urgency.
- **FR-013**: The category set MUST be **fixed** in this phase — seeded and permanent, with no
  interface or endpoint to create, rename, or retire one (Clarifications Q1). Phase 1's configuration
  shell remains empty; category management, if ever needed, is an additive change in a later phase.

#### Status lifecycle

- **FR-014**: System MUST implement the statuses **New**, **Open**, **Pending**, **Escalated**,
  **Resolved**, and **Closed**.
- **FR-015**: A newly created ticket MUST start at **New**.
- **FR-016**: System MUST permit only defined transitions between statuses and MUST refuse any
  other, naming the statuses that are reachable from the current one.
- **FR-017**: Transition rules MUST be enforced **server-side**. Restricting which controls the
  interface offers MUST NOT be the only barrier.
- **FR-018**: **Resolved** MUST be reachable from Open, Pending, and Escalated, and MUST NOT be
  reachable directly from New.
- **FR-019**: **Closed** MUST be reachable only from Resolved.
- **FR-020**: A Closed ticket MUST be reopenable by a permitted user, and the reopening MUST be
  recorded as a deliberate act.
- **FR-021**: An Agent MUST be able to close a Resolved ticket they are assigned to; a user MUST
  NOT be able to close a ticket assigned to someone else unless their role permits managing others'
  tickets. **Reopening a Closed ticket MUST require a Supervisor-level permission** — closing
  finishes work, while reopening undoes a completed piece of it and needs more authority
  (Clarifications Q2).

#### Assignment

- **FR-022**: Users with the appropriate permission MUST be able to assign a ticket to an active
  user, reassign it, and unassign it.
- **FR-023**: Assignment MUST be refused when the target is not an active user.
- **FR-024**: A ticket MUST be listable and filterable by assignee, including "unassigned".
- **FR-025**: A ticket whose assignee is later deactivated MUST remain viewable and workable, and its
  history MUST remain readable.
- **FR-026**: Assignment MUST be a Supervisor-level capability. An Agent MUST NOT be able to assign
  a ticket to themselves or to anyone else — including claiming one from the unassigned pool
  (Clarifications Q3). Assignment is directed work, not claimed work.

#### Escalation

- **FR-027**: Users MUST be able to escalate an Open or Pending ticket, and a reason MUST be
  required — an escalation without a reason tells the next person nothing.
- **FR-028**: An escalated ticket MUST be distinguishable at a glance in any listing.
- **FR-029**: A permitted user MUST be able to return an escalated ticket to a working status, and
  that MUST be recorded.
- **FR-030**: An escalated ticket MUST be resolvable — escalation is not a dead end.

#### History

- **FR-031**: System MUST record an entry in a ticket's history for every change to it, at minimum:
  creation, status change, assignment change, escalation and de-escalation, field edits, merge, link,
  and unlink.
- **FR-032**: Each history entry MUST record who acted, what changed, and when.
- **FR-033**: For a changed field, the entry MUST record both the previous and the new value.
- **FR-034**: A ticket's history MUST be append-only. No screen or interface may offer editing or
  deleting an entry.
- **FR-035**: History MUST be ordered oldest first, so a ticket reads as a story rather than a stack.
- **FR-036**: History MUST be paged rather than loaded whole.
- **FR-037**: Anyone permitted to view a ticket MUST be able to read its full history — the history
  MUST NOT be more restricted than the ticket.
- **FR-038**: A history entry MUST remain readable and attributed when its actor is no longer an
  active user.
- **FR-039**: Ticket history MUST NOT contain any password, token, or other credential.

#### Merging and linking

- **FR-040**: Users with the appropriate permission MUST be able to merge one ticket into another.
- **FR-041**: A merge MUST carry the merged ticket's history onto the surviving ticket, and MUST
  record the merge on both.
- **FR-042**: A merged ticket MUST be clearly identified as merged and MUST point at its survivor.
- **FR-043**: A merged ticket MUST NOT be separately workable — status changes, assignment, and edits
  MUST be refused and the user directed to the survivor.
- **FR-044**: Merging a ticket into itself MUST be refused.
- **FR-045**: Merge chains MUST resolve to a single surviving ticket rather than a trail of
  redirects.
- **FR-046**: Merging tickets belonging to different customers MUST warn the user before proceeding,
  because it loses whose problem it was.
- **FR-047**: Users MUST be able to link two related tickets, with each showing the other and neither
  losing its own status, assignee, or history.
- **FR-048**: Linking a ticket to itself MUST be refused, and linking the same pair twice MUST NOT
  create a duplicate link.
- **FR-049**: A permitted user MUST be able to remove a link, and the removal MUST be recorded.

#### Permissions, audit, and cross-cutting

- **FR-050**: Every ticket action MUST be governed by a permission enforced **server-side**, using the
  model Phase 1 established. Hiding an interface control MUST NOT be the only barrier.
- **FR-051**: The permission model MUST distinguish viewing tickets from creating them, from editing
  them, from assigning them, and from merging them.
- **FR-052**: Ticket creation, status change, assignment, escalation, merge, link, and unlink MUST
  each produce an audit entry in addition to the ticket's own history.
- **FR-053**: A merge, which permanently removes a ticket a user created, MUST use the
  `record.deleted` audit action the earlier phases defined for exactly this, rather than a new key.
- **FR-054**: Users MUST be able to find a ticket by its reference, and to filter the ticket list by
  status, priority, assignee, and customer.
- **FR-055**: All ticket lists and histories MUST be paged or otherwise bounded.
- **FR-056**: Every user-visible string introduced by this phase MUST come from the Arabic and
  English locale files, which MUST hold identical key sets.
- **FR-057**: Every screen introduced by this phase MUST render correctly in both text directions,
  using root-level direction rather than per-component flipping.
- **FR-058**: Every interactive control MUST be reachable and operable by keyboard alone, with a
  visible focus indicator meeting contrast requirements in both directions.
- **FR-059**: Validation errors MUST be announced to assistive technology, not conveyed by colour or
  position alone.
- **FR-060**: Ticket subjects, descriptions, and escalation reasons MUST accept and correctly store
  non-Latin characters, including Arabic.
- **FR-061**: The layered separation established in Phase 0 and carried through Phases 1–2 MUST be
  preserved: business decisions live in the service layer, and no interface component communicates
  with the backend except through the established service layer.

### PLAN.md Traceability

| PLAN.md Phase 3 Scope bullet | Covered by |
| --- | --- |
| Manual ticket creation | FR-001–FR-010 |
| Category and priority fields | FR-011–FR-013 |
| Manual assignment to an agent | FR-022–FR-026 |
| Status lifecycle (New → Open → Pending → Escalated → Resolved → Closed) | FR-014–FR-021 |
| Manual escalation path | FR-027–FR-030 |
| Full change-history audit trail per ticket | FR-031–FR-039 |
| Duplicate merge / related-ticket linking | FR-040–FR-049 |

Cross-cutting constitutional requirements are covered by FR-050–FR-053 (permissions and audit),
FR-056–FR-060 (bilingual, RTL, accessibility), and FR-061 (layering).

PLAN.md **Definition of done** for Phase 3 maps as follows:

| Definition of done clause | Verified by |
| --- | --- |
| "A ticket can be created" | User Story 1, SC-001 |
| "moved through its full lifecycle" | User Story 2, SC-002, SC-003 |
| "and its history is fully auditable" | User Story 5, SC-007, SC-008 |

**Carried forward from Phase 2.** Phase 2 chose deactivation over deletion for customers precisely so
this phase could treat a customer reference as permanent (FR-002 relies on it). Phase 2 also left
`record.deleted` without a caller, expecting a later phase to need it; FR-053 makes merging that
caller.

### Key Entities

- **Ticket**: One customer problem being worked. Carries a reference, subject, description, category,
  priority, status, owning customer, optional assignee, and — when merged — a pointer to its
  survivor.
- **Ticket Status**: One of six defined states. Meaningful because of what it forbids, not merely
  what it labels.
- **Ticket Category**: What kind of problem this is. Whether the set is fixed or Administrator-managed
  is FR-013.
- **Ticket Priority**: How urgent, ordered so "more urgent" is a comparison rather than a label.
- **Ticket History Entry**: An append-only record of one change to one ticket — actor, what changed,
  previous and new value, and when. Read routinely by the next person to pick the ticket up.
- **Ticket Link**: A symmetric relationship between two distinct tickets that bear on each other
  without either losing its identity.
- **Escalation**: A ticket entering the Escalated status together with the reason it was escalated —
  the reason being the part that matters to whoever handles it next.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: An Agent can create a ticket against a known customer in under two minutes, and can
  read its reference back to the customer immediately.
- **SC-002**: Every transition the lifecycle permits succeeds, and every transition it forbids is
  refused with a message naming what is reachable instead — verified across all defined status
  pairs, with zero exceptions.
- **SC-003**: A forbidden transition invoked directly — bypassing the interface entirely — is refused
  identically to one attempted through the interface.
- **SC-004**: An Agent can determine which tickets are assigned to them in under 10 seconds.
- **SC-005**: An escalated ticket is identifiable in a list without opening it.
- **SC-006**: Escalation without a reason is impossible.
- **SC-007**: Every kind of change listed in FR-031 produces a retrievable history entry — 100%
  coverage, verified change by change.
- **SC-008**: An Agent picking up an unfamiliar ticket can establish what has already been done from
  its history alone, without asking a colleague.
- **SC-009**: A merged ticket cannot be worked by any route, and always points at its survivor.
- **SC-010**: For every combination of role and ticket action, invoking the action directly produces
  the same allow-or-refuse outcome the interface presents. Zero combinations differ.
- **SC-011**: Ticket lists and histories return without perceptible delay at realistic volume, and no
  list operation loads everything at once.
- **SC-012**: Every screen introduced by this phase is fully operable by keyboard alone, in both
  Arabic and English, with a visible focus indicator throughout.
- **SC-013**: The Arabic and English locale files hold identical key sets, and no screen displays an
  untranslated key or hardcoded string in either language.
- **SC-014**: Arabic subjects, descriptions, and escalation reasons are stored and redisplayed exactly
  as entered.

## Assumptions

Reasonable defaults chosen where PLAN.md did not specify. Each is a candidate for `/speckit-clarify`.

- **Tickets are created by staff only.** PLAN.md places channel-based creation in Phase 5 and the
  customer portal in Phase 8, so nobody outside the organisation creates a ticket in this phase.
- **A ticket belongs to exactly one customer** and cannot be moved between customers. Merging across
  customers warns rather than silently reassigning (FR-046).
- **Reference format** is a short prefixed sequence such as `TKT-000123` — readable aloud, unique,
  and not exposing volume as precisely as a bare counter would.
- **Priorities** are Low, Normal, High, and Urgent. Four levels is the common arrangement; more
  becomes indistinguishable in practice.
- **Categories** are General, Technical, Billing, and Complaint — fixed and seeded
  (Clarifications Q1).
- **No SLA timers, due dates, or automatic escalation.** PLAN.md places SLA and automation in Phase 6.
  Escalation here is entirely manual.
- **No ticket comments or customer correspondence.** Communication channels arrive in Phase 5. The
  history in this phase records *changes to the ticket*, not conversation.
- **No attachments on tickets in this phase.** Phase 2 built attachments for customers; extending them
  to tickets is not named in PLAN.md's Phase 3 scope.
- **No department, team, or queue scoping.** PLAN.md places that in Phase 12; any user permitted to
  view tickets sees all of them.
- **Agents do not claim work.** Every assignment is made by a Supervisor (Clarifications Q3), so an
  unassigned ticket stays unassigned until someone directs it. Phase 4's dashboard must be specified
  against this rather than assuming a claim action.
- **A merged ticket is retained, not deleted from the database** — it remains visible as a redirect to
  its survivor. "Deleted" in FR-053's audit sense means removed from active work.
- **Test coverage follows the pattern Phases 1–2 established.** The permission matrix extends to the
  new module automatically, and the lifecycle's forbidden transitions are verified by a generated
  matrix rather than a hand-written list.

## Out of Scope

Recorded so later phases do not assume these were delivered here:

- **Channel-based ticket creation** — email, chat, or any inbound channel (Phase 5).
- **Customer-facing ticket visibility or self-service** (Phase 8).
- **SLA targets, due dates, timers, and automatic escalation or reassignment** (Phase 6).
- **Ticket comments, replies, or any customer correspondence** (Phase 5).
- **Attachments on tickets.** Phase 2 built them for customers; tickets are not in that scope.
- **Creating, renaming, or retiring ticket categories.** The set is fixed by decision
  (Clarifications Q1); Phase 1's configuration shell stays empty.
- **Agents claiming tickets from an unassigned pool.** Assignment is Supervisor-only
  (Clarifications Q3).
- **Automatic duplicate detection between tickets.** Merging is manual and user-initiated here;
  Phase 2's automatic detection applies to customers, not tickets.
- **Agent dashboards, workload views, and queue metrics** (Phase 4).
- **Knowledge-base suggestions or canned responses** (Phase 7).
- **Department, team, or queue scoping of ticket visibility** (Phase 12).
- **Reporting or analytics over tickets** (Phase 10).
