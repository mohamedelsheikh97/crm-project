# Feature Specification: Phase 4 — Agent Dashboard

**Feature Branch**: `005-phase-4-agent-dashboard`

**Created**: 2026-08-29

**Status**: Draft

**Input**: User description: "Phase 4 — Agent Dashboard"

**PLAN.md Reference**: Phase 4 — Agent Dashboard

**Depends on**: Phase 1 — Security & Administration Foundations (users, roles, permissions),
Phase 2 — Customer Management (the customer a ticket belongs to),
Phase 3 — Ticket Management (Core) (tickets must exist to work from)

## Overview

Phase 3 built the ticket. Phase 4 builds the place an agent stands while working tickets.

The distinction matters, because everything in this phase already has a screen somewhere. A ticket
list exists. A customer record exists. An agent can already reach both. PLAN.md's Definition of done
is therefore not "these things are visible" but something sharper: *"An agent can triage their whole
queue from one screen without navigating away, and gets real-time pings for anything urgent."*

Three consequences follow from reading that sentence literally.

**"Without navigating away" is the requirement, not a nicety.** An agent who must open a second
screen to see who the customer is, or a third to leave a note, has not been given a workspace — they
have been given a bookmark. The customer context panel, the note composer, and the transition
controls must live beside the ticket, not one click behind it.

**"Real-time pings" means the system speaks first.** Every screen built in Phases 0–3 answers a
question the user asked. A notification is the first thing in this project that reaches a user who
did not ask — when a ticket lands on them, when a colleague names them, when something is running
late. That inversion is the genuinely new capability of this phase, and it is what the phase should
be judged on.

**Internal means internal.** Notes written here are colleague-to-colleague. No customer sees them in
this phase because no customer can see anything until Phase 8 — but the boundary must be built now
and honoured then, because a note written under an assumption of privacy that later leaks is worse
than never having offered privacy at all.

Phase 4 also inherits a workflow constraint it must not quietly undo. Phase 3 decided that only a
Supervisor assigns work (Phase 3 Clarifications Q3), and stated explicitly that this dashboard is
**read-only with respect to assignment**: an agent sees their queue but cannot add to it. This spec
is written against that decision.

## Clarifications

### Session 2026-08-29

Three questions were raised during `/speckit-specify`, each one a place where PLAN.md's Phase 4 scope
depends on capability that PLAN.md itself places in a later phase. All three are resolved; no
`[NEEDS CLARIFICATION]` markers remain.

- **Q1 — Where does a "due date" come from, and what is an "SLA warning" before Phase 6 exists?**
  **Decision: Phase 4 introduces a manual, user-settable due date on a ticket**, and the warning
  notification fires against that date. PLAN.md names both the due-date sort/filter and the warning
  in this phase's scope, so deferring them leaves two scope bullets unmet; deriving targets from
  priority would pre-empt Phase 6 with SLA numbers the constitution still lists as unresolved. A
  manual date is the reading that satisfies PLAN.md without deciding anything Phase 6 owns. Phase 6
  later replaces the *source* of the date with computed SLA targets, leaving this phase's queue,
  filters, and notification type intact. See FR-019–FR-028 and FR-045.
- **Q2 — What does a quick reply reply *to*, given that no customer-facing correspondence exists
  until Phase 5?** **Decision: a template inserts into the internal note composer, and can be copied
  to the clipboard.** The library — its content, management, permissions, and bilingual bodies — is
  genuinely Phase 4 work and is useful immediately, because an agent can paste a template into
  whatever channel they are using today. Introducing a customer-facing reply surface here would pull
  Phase 5's core scope forward and build a send button with nowhere to send. Phase 5 adds channels
  as new insertion targets rather than rebuilding the library. See FR-066–FR-072.
- **Q3 — Are tasks personal, or may they be given to another user?** **Decision: tasks are personal
  to their owner.** A user creates tasks for themselves, against a ticket or a customer. Delegation
  already has a mechanism in this system — Phase 3 ticket assignment — and PLAN.md does not name a
  second one. Per the constitution's YAGNI rule, cross-user task assignment is not built
  speculatively; it remains an additive change if a later phase needs it. See FR-055.

**Q1 has a consequence worth carrying forward.** Because the due date is manual, it is a *promise a
human made*, not a policy the system computed. Phase 6 must decide whether a computed SLA target
overrides a manually set date, sits beside it, or migrates it — and must not assume this phase's
dates were machine-generated.

**Q3 has a consequence worth carrying forward.** Because tasks are personal, a supervisor cannot use
a task to direct work; directing work remains Phase 3 assignment. Phase 6's automation rules must
not assume a task can be created for someone else.

## User Scenarios & Testing _(mandatory)_

### User Story 1 — An Agent Triages Their Queue From One Screen (Priority: P1)

An agent starts their shift and opens the dashboard. Everything assigned to them is there, in one
list, with enough on each row to decide what to touch first: the customer, the subject, the status,
the priority, how long it has been waiting, and whether it is late. They sort by what matters this
morning, filter down to what is actionable now, and start working — without leaving the screen to
find out what any of it means.

**Why this priority**: This is the phase's Definition of done in a single story. Without it there is
no dashboard, only a filtered ticket list that already existed in Phase 3.

**Independent Test**: Seed tickets across several agents, statuses, and priorities; sign in as one
agent; confirm the queue shows that agent's tickets only, and that every sort and filter changes
what is shown without a page change.

**Acceptance Scenarios**:

1. **Given** tickets assigned to several agents, **When** an agent opens their dashboard, **Then**
   they see the tickets assigned to them and no tickets assigned to anyone else.
2. **Given** a populated queue, **When** the agent sorts by priority, **Then** the most urgent
   tickets appear first, ordered by the priority ranking rather than alphabetically.
3. **Given** a populated queue, **When** the agent filters by status, **Then** only tickets in the
   selected statuses remain, and the filter is visible as active.
4. **Given** a queue with tickets due at different times, **When** the agent sorts by due date,
   **Then** the soonest-due tickets appear first and tickets with no due date group predictably.
5. **Given** a queue with no matching tickets after filtering, **Then** the agent is told the filter
   matched nothing and is offered a way to clear it — an empty area is not left unexplained.
6. **Given** an agent with an empty queue, **When** they open the dashboard, **Then** they are told
   their queue is empty rather than shown a blank screen.
7. **Given** a queue larger than one page, **When** the agent scrolls or pages, **Then** the queue
   loads in bounded pages rather than all at once.
8. **Given** an agent viewing their queue, **When** a supervisor assigns them a new ticket, **Then**
   the new ticket appears in the queue without the agent reloading the screen.

---

### User Story 2 — The Customer Is Visible Beside the Ticket (Priority: P1)

An agent opens a ticket from their queue. Beside it, without a second screen, is who this customer
is: their name, how to reach them, their standing, and what else is open for them. The agent answers
the customer's question without ever losing the ticket they are answering it from.

**Why this priority**: "Without navigating away" is half of PLAN.md's Definition of done, and it is
the half that cannot be satisfied by the Phase 3 screens.

**Independent Test**: Open a ticket for a customer with several other tickets and confirm the panel
shows the customer's identity, contact details, and other tickets, and that the ticket remains fully
workable with the panel open.

**Acceptance Scenarios**:

1. **Given** an agent viewing a ticket, **When** the screen loads, **Then** the customer's name,
   primary contact details, and status are visible without further action.
2. **Given** a customer with other tickets, **When** the agent views one of them, **Then** the panel
   lists the customer's other tickets with their statuses, and selecting one opens it.
3. **Given** a customer with recent notes, **When** the agent views a ticket for them, **Then** the
   panel surfaces the most recent customer notes, bounded to a readable number.
4. **Given** an agent viewing a ticket with the panel open, **When** they change the ticket's status
   or add a note, **Then** the ticket stays open and the panel stays visible.
5. **Given** a deactivated customer, **When** the agent opens one of their tickets, **Then** the panel
   shows the customer as deactivated and the ticket remains workable.
6. **Given** an agent without permission to view customers, **When** they open a ticket, **Then** the
   panel is withheld and the ticket remains workable — the panel is an enhancement, not a gate.

---

### User Story 3 — Colleagues Talk On the Ticket, Not Around It (Priority: P2)

An agent hits something they cannot resolve alone. Instead of a private chat message that vanishes
into someone's inbox, they write an internal note on the ticket and name the colleague who knows the
answer. That colleague is notified, opens the ticket, reads the whole thread in place, and answers
there. The next person to pick the ticket up sees the entire exchange.

**Why this priority**: Notes and mentions are the collaboration mechanism PLAN.md names for this
phase, and they are what makes a mention notification meaningful. They sit below the queue and the
context panel because an agent can still work without them.

**Independent Test**: Add an internal note mentioning another user, sign in as that user, confirm
they were notified and that the note is legible on the ticket to any permitted viewer.

**Acceptance Scenarios**:

1. **Given** an agent viewing a ticket, **When** they add an internal note, **Then** it appears on the
   ticket attributed to them with the time it was written.
2. **Given** an agent writing a note, **When** they type the mention trigger, **Then** they are
   offered matching active users and can select one.
3. **Given** a note mentioning another user, **When** it is saved, **Then** the mentioned user
   receives a notification identifying the ticket and the author.
4. **Given** a note mentioning a user, **When** any permitted user views the ticket, **Then** the
   mention is visibly distinguished from surrounding text and identifies a real user.
5. **Given** an agent editing their own note, **When** they save it, **Then** the note shows that it
   was edited and when.
6. **Given** an agent viewing a note written by someone else, **When** they attempt to edit it,
   **Then** it is refused unless they hold the permission to manage others' notes.
7. **Given** a note mentioning a user who is later deactivated, **When** the ticket is viewed,
   **Then** the note remains readable and the mention remains attributed.
8. **Given** an agent mentioning themselves, **When** the note is saved, **Then** no notification is
   generated — a user is not pinged by their own writing.

---

### User Story 4 — The System Speaks First (Priority: P2)

An agent is working. Something happens that they need to know about now: a ticket is assigned to
them, a colleague names them, or a ticket of theirs is running late. A notification appears while
they work. They open it, land on the thing it is about, and it stops being unread.

**Why this priority**: This is the second half of PLAN.md's Definition of done — "gets real-time
pings for anything urgent" — and the only genuinely new capability in the phase. It is P2 rather than
P1 only because the queue must exist before there is anything to be notified about.

**Independent Test**: With two sessions open, act as a supervisor in one and confirm the agent's
session receives the notification without a reload, and that opening it marks it read.

**Acceptance Scenarios**:

1. **Given** an agent with the dashboard open, **When** a supervisor assigns them a ticket, **Then** a
   notification appears without the agent reloading.
2. **Given** an agent with the dashboard open, **When** a colleague mentions them in a note, **Then** a
   notification appears identifying the ticket and the author.
3. **Given** a ticket assigned to an agent approaching its due date, **When** the warning threshold is
   reached, **Then** the assignee is notified once.
4. **Given** an agent who was signed out when a notification was generated, **When** they sign in,
   **Then** the notification is waiting and unread.
5. **Given** unread notifications, **When** the agent uses the application, **Then** the unread count
   is visible from anywhere in it.
6. **Given** a notification, **When** the agent opens it, **Then** they land on the ticket it concerns
   and the notification becomes read.
7. **Given** several unread notifications, **When** the agent chooses to mark all read, **Then** all
   are marked read and the count clears.
8. **Given** a notification addressed to one user, **When** any other user requests it directly,
   **Then** it is refused — notifications are private to their recipient.
9. **Given** a lost or unavailable live connection, **When** the agent continues working, **Then** the
   dashboard still functions and notifications are not silently lost.

---

### User Story 5 — Follow-Ups Do Not Live In Someone's Head (Priority: P3)

An agent promises a customer a callback on Thursday. They attach a task to the ticket with a due
date. On Thursday it is waiting on their dashboard, and it was not forgotten because the only place
it was recorded was their memory.

**Why this priority**: Genuine PLAN.md scope, but the queue, the context panel, and notifications all
deliver value without it.

**Independent Test**: Create a task against a ticket with a due date, confirm it appears on the
dashboard, is reminded at the right time, and can be completed.

**Acceptance Scenarios**:

1. **Given** an agent viewing a ticket, **When** they create a task with a title and due date,
   **Then** the task is linked to that ticket, owned by them, and appears on their dashboard.
2. **Given** an agent viewing a customer, **When** they create a task, **Then** it is linked to that
   customer.
3. **Given** a task with a reminder time, **When** that time arrives, **Then** the owner is notified.
4. **Given** an open task, **When** the agent completes it, **Then** it is recorded as complete with
   who completed it and when, and it leaves the outstanding list.
5. **Given** a task whose due date has passed, **When** the dashboard is viewed, **Then** it is
   visibly distinguished as overdue.
6. **Given** a task on a ticket, **When** the ticket is closed, **Then** any outstanding task is
   surfaced rather than silently abandoned.
7. **Given** a task on a ticket that is merged into another, **When** the merge completes, **Then**
   the task follows the surviving ticket.
8. **Given** a task owned by one user, **When** another user requests it directly, **Then** it is
   refused — tasks are personal (Clarifications Q3).

---

### User Story 6 — The Same Answer Is Not Retyped Fifty Times (Priority: P3)

Some replies are written over and over. An agent picks the right one from a shared library, drops it
into their note, adjusts the details, and moves on — in whichever language they are working in.

**Why this priority**: Real PLAN.md scope and a real time saving, but it accelerates work the agent
can already do by typing.

**Independent Test**: Create a template, insert it into a note from a ticket, and confirm the
inserted text is editable before it is saved.

**Acceptance Scenarios**:

1. **Given** a library of templates, **When** an agent opens the picker from a ticket, **Then** they
   can search templates by title or body and preview one before inserting it.
2. **Given** a selected template, **When** the agent inserts it, **Then** its text is placed in the
   note composer and remains fully editable.
3. **Given** a selected template, **When** the agent chooses to copy it, **Then** its text is placed
   on the clipboard for use outside the application.
4. **Given** a user with permission to manage templates, **When** they create, edit, or retire one,
   **Then** the change is reflected for every agent.
5. **Given** a user without that permission, **When** they open the library, **Then** they can use
   templates but not change them.
6. **Given** a template with both Arabic and English text, **When** an agent inserts it, **Then** the
   version matching their active language is used.
7. **Given** a retired template, **When** an agent opens the picker, **Then** it is not offered,
   while notes that already used it remain unchanged.

---

### Edge Cases

- What happens when an agent's queue is empty, or when every ticket in it is filtered out? Both are
  explained states, not blank regions.
- What happens when an agent is deactivated while holding assigned tickets? Their queue is
  unreachable; the tickets remain visible to supervisors as assigned to a deactivated user.
- What happens when a supervisor opens the dashboard? Whose queue do they see, and can they see
  another agent's? Covered by FR-010 and FR-011.
- What happens when a ticket is reassigned away from an agent who has it open? The agent must be
  told rather than allowed to keep working a ticket that is no longer theirs.
- What happens when a ticket has no due date? Covered by FR-023 — it sorts predictably and is never
  overdue.
- What happens when a due date is set to a time already past? Covered by FR-024 — accepted, and
  immediately overdue.
- What happens when a ticket is closed after its due date passed? Covered by FR-027 — a closed ticket
  is not reported as overdue.
- What happens when a due date is changed after its warning already fired? The warning must not
  re-fire for a date already warned unless the new date reopens the window.
- What happens when a mentioned user cannot view the ticket at all? Covered by FR-037.
- What happens when a note mentions twenty users? Covered by FR-038.
- What happens when a note mentions the same user twice? One notification, not two.
- What happens to notifications for a ticket that is later merged away? They must lead to the
  surviving ticket rather than a dead end.
- What happens when notifications accumulate for months? Covered by FR-050.
- What happens when the live connection drops, or the browser blocks it entirely? The dashboard
  degrades to a working, if less immediate, screen — never to a broken one.
- What happens when the same user is signed in twice? Both sessions reflect the same read state.
- What happens when a reminder's time passes while the system is down? Covered by FR-063 — delivered
  late, not skipped.
- What happens when a template contains text in only one language? Covered by FR-070.
- What happens when a very long note or an Arabic note is displayed? It must wrap and render in the
  correct direction without breaking the layout.

## Requirements _(mandatory)_

### Functional Requirements

#### The agent queue

- **FR-001**: System MUST provide a dashboard screen that shows the signed-in user the tickets
  currently assigned to them.
- **FR-002**: The queue MUST show, for each ticket without opening it: reference, subject, customer,
  status, priority, how long it has been waiting, and its due date if it has one.
- **FR-003**: The queue MUST exclude tickets in an end state (Closed) by default, while allowing them
  to be shown deliberately.
- **FR-004**: The queue MUST exclude tickets that have been merged away.
- **FR-005**: Users MUST be able to sort the queue by priority, by status, by age, and by due date,
  in both directions.
- **FR-006**: Priority sorting MUST follow the urgency ranking defined in Phase 3, not alphabetical
  order.
- **FR-007**: Users MUST be able to filter the queue by status, by priority, and by overdue state,
  combining filters.
- **FR-008**: Sorting and filtering MUST be applied server-side over the whole queue, not only over
  the page currently loaded.
- **FR-009**: The queue MUST be paged or otherwise bounded; it MUST NOT load an unbounded set.
- **FR-010**: A user MUST NOT see another user's queue unless they hold the permission to view
  others' work.
- **FR-011**: A user who holds that permission MUST be able to select whose queue they are viewing,
  and the selection MUST be visible on screen.
- **FR-012**: The dashboard MUST NOT offer any control that assigns or reassigns a ticket to a user
  who lacks the assignment permission established in Phase 3 — this dashboard does not introduce
  self-service claiming.

#### Customer context

- **FR-013**: When a ticket is open, System MUST present the owning customer's identity and primary
  contact details alongside it, without a navigation away from the ticket.
- **FR-014**: The context panel MUST list the customer's other tickets with their statuses, bounded
  to a readable number and ordered most recent first.
- **FR-015**: The context panel MUST surface the customer's most recent notes, bounded to a readable
  number.
- **FR-016**: The context panel MUST indicate when a customer is deactivated, and MUST NOT prevent
  the ticket from being worked.
- **FR-017**: Every item in the context panel MUST lead to the underlying record.
- **FR-018**: The context panel MUST be withheld from users who may not view customers, and its
  absence MUST NOT block any ticket action.

#### Due dates and lateness

- **FR-019**: A ticket MUST carry an optional due date, set manually by a permitted user
  (Clarifications Q1). No due date is computed, inferred from priority, or assigned automatically in
  this phase.
- **FR-020**: The due date MUST be recorded as a date and time, and MUST be evaluated against a
  single authoritative clock rather than the viewer's device, so "overdue" means the same thing for
  every user.
- **FR-021**: A ticket past its due date MUST be visibly distinguished in the queue without opening
  it, by more than colour alone.
- **FR-022**: Setting, changing, or clearing a due date MUST be recorded in the ticket's Phase 3
  history like any other field change, with previous and new value.
- **FR-023**: Tickets with no due date MUST sort predictably — grouped together at one end rather
  than interleaved — and MUST NOT be treated as overdue.
- **FR-024**: A due date MUST be settable to a time already past; backdating a commitment already
  missed is legitimate and MUST NOT be refused.
- **FR-025**: Setting a due date MUST require a permission distinct from viewing a ticket, and MUST
  be refused server-side to users without it.
- **FR-026**: A due date MUST be clearable, returning the ticket to having none.
- **FR-027**: A Closed ticket MUST NOT be reported as overdue, whatever its due date.
- **FR-028**: Nothing that consumes the due date — the queue's sort and filter, the overdue
  indicator, the warning notification — MUST assume the date was set by a human, so Phase 6 can
  supply it from a computed SLA target without those consumers being rebuilt.

#### Internal notes and mentions

- **FR-029**: Users with the appropriate permission MUST be able to add an internal note to a ticket.
- **FR-030**: Every note MUST record its author and the time it was written.
- **FR-031**: Notes MUST be internal: they MUST NOT be exposed to any customer-facing surface in this
  or any later phase without a deliberate decision recorded in that phase's spec.
- **FR-032**: Note bodies MUST accept and correctly store non-Latin characters, including Arabic.
- **FR-033**: An author MUST be able to edit their own note; the note MUST then show that it was
  edited and when.
- **FR-034**: Editing another user's note MUST require a distinct permission.
- **FR-035**: A note MUST remain readable and attributed after its author is deactivated.
- **FR-036**: Users MUST be able to mention another active user in a note by a recognisable trigger,
  choosing from a list of matching active users.
- **FR-037**: A mention MUST resolve to a real, active user; a mention of a user who cannot view the
  ticket MUST be refused at composition time with an explanation, rather than silently generating a
  notification to a ticket they cannot open.
- **FR-038**: Mentions per note MUST be bounded, and the limit MUST be stated to the user when
  reached.
- **FR-039**: Mentioning the same user more than once in one note MUST produce at most one
  notification.
- **FR-040**: Mentioning oneself MUST NOT produce a notification.
- **FR-041**: A rendered mention MUST be visually distinguishable from surrounding text and MUST
  identify the mentioned user.

#### Notifications

- **FR-042**: System MUST deliver a notification to a user when a ticket is assigned to them.
- **FR-043**: System MUST deliver a notification to a user when they are mentioned in a note.
- **FR-044**: System MUST deliver a notification to the owner of a task when its reminder time
  arrives.
- **FR-045**: System MUST deliver a notification to a ticket's assignee when the ticket approaches
  its due date (Clarifications Q1). The warning MUST fire at most once per due date, and changing the
  due date MUST NOT re-fire a warning already delivered for the same date.
- **FR-046**: Notifications MUST reach a user who has the application open without them reloading or
  taking any action.
- **FR-047**: Notifications generated while a user is signed out MUST be waiting, unread, when they
  next sign in — real-time delivery is an accelerant, not the only delivery path.
- **FR-048**: An unread count MUST be visible from every screen in the application.
- **FR-049**: Opening a notification MUST take the user to the record it concerns and MUST mark it
  read; users MUST also be able to mark all notifications read at once.
- **FR-050**: The notification list MUST be bounded and paged, and MUST NOT grow without limit.
- **FR-051**: A notification MUST be readable only by its recipient; a request for another user's
  notification MUST be refused server-side.
- **FR-052**: A notification whose ticket has since been merged away MUST lead to the surviving
  ticket.
- **FR-053**: A user MUST NOT be notified of their own action.
- **FR-054**: Loss of the live connection MUST NOT break the dashboard, MUST NOT lose notifications,
  and MUST be recoverable without a full reload.

#### Tasks and reminders

- **FR-055**: Users MUST be able to create a task with a title, an optional due date, and an optional
  reminder time. A task is owned by the user who created it and MUST NOT be assignable to another
  user (Clarifications Q3).
- **FR-056**: A task MUST be linkable to a ticket or to a customer, and MUST be reachable from that
  record.
- **FR-057**: A user's outstanding tasks MUST appear on their dashboard alongside their queue.
- **FR-058**: An overdue task MUST be visibly distinguished, by more than colour alone.
- **FR-059**: Completing a task MUST record when it was completed, and MUST remove it from the
  outstanding list without deleting it.
- **FR-060**: A completed task MUST be reopenable by its owner.
- **FR-061**: A reminder MUST fire once, at the time set, to the task's owner.
- **FR-062**: Changing or clearing a reminder time MUST change or cancel the pending reminder.
- **FR-063**: A task whose reminder time has passed while the system was unavailable MUST still be
  delivered rather than skipped.
- **FR-064**: Closing a ticket that has outstanding tasks MUST surface them to the user rather than
  abandoning them silently.
- **FR-065**: A task linked to a ticket that is merged away MUST follow the surviving ticket.

#### Quick-reply templates

- **FR-066**: System MUST provide a shared library of reusable reply templates, each with a title and
  a body. A template MUST be insertable into the internal note composer and copyable to the
  clipboard; no template is sent to a customer in this phase (Clarifications Q2).
- **FR-067**: Users MUST be able to search templates by title and body, and preview a template before
  using it.
- **FR-068**: Inserted template text MUST be fully editable before it is saved — a template is a
  starting point, never a locked message.
- **FR-069**: Creating, editing, and retiring templates MUST require a permission distinct from using
  them.
- **FR-070**: Templates MUST carry Arabic and English bodies, and the version matching the user's
  active language MUST be offered; when only one language is present, that version MUST be offered
  with its language identified.
- **FR-071**: Retiring a template MUST remove it from the picker without altering any text already
  written from it.
- **FR-072**: The template picker MUST be bounded and searchable rather than rendering the entire
  library at once.

#### Permissions, audit, and cross-cutting

- **FR-073**: Every action introduced by this phase MUST be governed by a permission enforced
  **server-side**, using the catalog and middleware established in Phase 1. Hiding a control MUST NOT
  be the only restriction.
- **FR-074**: The permission model MUST distinguish using a template from managing the library,
  writing one's own note from editing another user's, and viewing one's own queue from viewing
  another user's.
- **FR-075**: Setting a ticket's due date MUST be permissioned separately from viewing the ticket
  (FR-025), so that reading a queue never implies the authority to change what is late.
- **FR-076**: A user MUST NOT be able to read another user's notifications or tasks by requesting
  them directly, regardless of what the interface offers.
- **FR-077**: Template management MUST be recorded in the Phase 1 audit log; ordinary note, task, and
  notification activity MUST NOT flood it.
- **FR-078**: Internal notes MUST be visible in the ticket's Phase 3 history as having occurred,
  without the history becoming a duplicate store of note bodies.
- **FR-079**: Notification and task records MUST NOT contain any password, token, or other
  credential.
- **FR-080**: Every user-visible string introduced by this phase MUST come from the Arabic and
  English locale files; hardcoded strings are prohibited.
- **FR-081**: Every screen and panel introduced by this phase MUST render correctly in both text
  directions, using root-level direction rather than per-component flipping — including the dashboard
  layout, the context panel's side, and the notification list.
- **FR-082**: Every interactive control introduced by this phase — including the mention picker, the
  template picker, the due-date control, and the notification list — MUST be reachable and operable
  by keyboard alone, with a visible focus indicator meeting contrast requirements in both directions.
- **FR-083**: A newly arrived notification MUST be announced to assistive technology without stealing
  focus from what the user is doing.
- **FR-084**: Overdue, escalated, and unread states MUST be conveyed by more than colour alone.
- **FR-085**: All lists introduced by this phase MUST be paged or otherwise bounded.
- **FR-086**: The layered separation established in Phase 0 and carried through Phases 1–3 MUST be
  preserved: business decisions live in the service layer, and no interface component communicates
  with the backend except through the established service layer.

### PLAN.md Traceability

| PLAN.md Phase 4 Scope bullet | Covered by |
| --- | --- |
| Assigned-ticket list, sortable/filterable by status, priority, due date | FR-001–FR-012, FR-019–FR-028 |
| Customer context panel alongside the active ticket | FR-013–FR-018 |
| Tasks and reminders linked to tickets/customers | FR-055–FR-065 |
| Quick-reply template library | FR-066–FR-072 |
| Internal notes + @mentions (hidden from customer) | FR-029–FR-041 |
| Real-time notifications (new assignment, mention, SLA warning) | FR-042–FR-054 |

Cross-cutting constitutional requirements are covered by FR-073–FR-079 (permissions and audit),
FR-080–FR-085 (bilingual, RTL, accessibility, bounded lists), and FR-086 (layering).

PLAN.md **Definition of done** for Phase 4 maps as follows:

| Definition of done clause | Verified by |
| --- | --- |
| "An agent can triage their whole queue from one screen" | User Story 1, SC-001, SC-002 |
| "without navigating away" | User Story 2, SC-004, SC-005 |
| "and gets real-time pings for anything urgent" | User Story 4, SC-008, SC-009, SC-010 |

**On "SLA warning".** PLAN.md's notification bullet names an SLA warning, but PLAN.md places SLA
definition itself in Phase 6 and the constitution lists SLA targets among its unresolved Open Items.
Clarifications Q1 resolves this as a warning against a manually set due date: the notification type,
its delivery, and its consumers are built now, and Phase 6 changes only where the date comes from
(FR-028).

**Carried forward from Phase 3.** Phase 3 Clarifications Q3 fixed assignment as Supervisor-only and
stated that this dashboard is read-only with respect to assignment; FR-012 honours that rather than
reopening it. Phase 3's ticket history is the record this phase writes into rather than duplicating
(FR-022, FR-078). Phase 3's merge semantics are why FR-004, FR-052, and FR-065 exist: a merged ticket
must not surface in a queue, a notification, or a task as if it were still workable.

### Key Entities

- **Queue**: Not a stored record — the set of tickets currently assigned to one user, expressed as a
  filtered, sorted, bounded view over Phase 3's tickets.
- **Due Date**: An optional point in time by which a ticket is expected to be finished, set by a
  person in this phase and by policy in Phase 6. The thing "overdue" and the warning notification are
  both measured against.
- **Ticket Note**: An internal, attributed, dated comment on a ticket, written for colleagues and
  never shown to a customer. Distinct from Phase 3's history: history records what changed, a note
  records what a person wants the next person to know.
- **Mention**: A reference from a note to a user, resolved at composition time to a real active user,
  and the reason a notification exists.
- **Notification**: A message the system delivers to one recipient without being asked — carrying
  what happened, what it concerns, when, and whether it has been read. Private to its recipient.
- **Task**: A personal commitment with an owner, a title, an optional due date, and an optional
  reminder, optionally attached to a ticket or a customer, that is either outstanding or completed.
- **Reminder**: A time at which a task's owner is notified. One task has at most one pending
  reminder.
- **Reply Template**: A reusable, titled body of text in Arabic and English, offered to agents for
  insertion into a note or copying to the clipboard, editable after insertion, and maintained by a
  user with the permission to manage the library.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: An agent can identify what to work on next within 10 seconds of opening the dashboard,
  without opening any ticket.
- **SC-002**: An agent can complete a full triage pass over their queue — reviewing, prioritising,
  and progressing tickets — without navigating to any screen outside the dashboard and the ticket it
  opens.
- **SC-003**: Every sort and filter combination returns results consistent with the whole queue, not
  merely the page in view — verified across every defined status and priority.
- **SC-004**: For any ticket, an agent can establish who the customer is and what else is open for
  them without leaving the ticket.
- **SC-005**: The number of screen changes required to answer a routine customer question drops to
  zero beyond opening the ticket itself.
- **SC-006**: An agent can ask a named colleague a question about a ticket and have it recorded on
  the ticket in under one minute.
- **SC-007**: Every mention resolves to a real user, and no mention generates a notification to a
  user who cannot open the ticket. Zero exceptions.
- **SC-008**: An assignment or mention reaches an agent with the application open within five seconds,
  without any action on their part.
- **SC-009**: No notification generated while a user is signed out is lost; 100% are present and
  unread at next sign-in.
- **SC-010**: With live delivery unavailable, the dashboard remains fully usable and every
  notification still arrives.
- **SC-011**: For every combination of role and action introduced by this phase, invoking the action
  directly — bypassing the interface — produces the same allow-or-refuse outcome the interface
  presents. Zero combinations differ.
- **SC-012**: No user can retrieve another user's notifications or tasks by any route.
- **SC-013**: Every task with a reminder produces exactly one notification at the time set — none
  skipped, none duplicated — including reminders whose time passed while the system was unavailable.
- **SC-014**: An overdue ticket is identifiable in the queue without opening it, and every ticket with
  a due date produces exactly one approaching-due warning to its assignee — none duplicated by a
  later edit to the same date.
- **SC-015**: A template can be found and inserted in under 15 seconds, and the inserted text is
  editable in every case.
- **SC-016**: The dashboard, context panel, and notification list are fully operable by keyboard
  alone, in both Arabic and English, with a visible focus indicator throughout and no state conveyed
  by colour alone.
- **SC-017**: The Arabic and English locale files hold identical key sets, and no screen introduced by
  this phase displays an untranslated key or hardcoded string in either language.
- **SC-018**: Queue, note, task, and notification lists return without perceptible delay at realistic
  volume, and no list operation loads everything at once.

## Assumptions

Reasonable defaults chosen where PLAN.md did not specify. Each is a candidate for `/speckit-clarify`.

- **The dashboard is a new screen, not a replacement.** Phase 3's ticket list stays as the way to
  find any ticket; the dashboard answers "what is mine".
- **"Assigned to me" is the queue's definition.** Because Phase 3 forbids self-assignment, an agent's
  queue changes only when a supervisor changes it.
- **The due date is manual and optional** (Clarifications Q1). Most tickets will have none, so the
  queue must read well when the column is largely empty.
- **The approaching-due warning threshold is a single system-wide value**, not per-priority or
  per-customer. Per-policy thresholds are Phase 6's business.
- **Notifications are in-application only.** Email delivery depends on the SMTP capability PLAN.md
  places in Phase 5, so nothing in this phase leaves the application.
- **Notifications are per-user, with no preference or subscription screen.** Every user receives the
  defined events; muting and digesting are configuration this phase does not need.
- **Live delivery is an accelerant over a reliable store.** Every notification is persisted first, so
  correctness never depends on a connection staying up.
- **Internal notes are ticket-scoped.** Phase 2's customer notes already exist and are unchanged;
  this phase adds notes to tickets and does not merge the two.
- **Notes are plain text with mentions**, not rich text, attachments, or embedded media.
- **Mentions target individual users**, not roles, teams, or groups — there are no teams until
  Phase 12.
- **Tasks are lightweight and personal** (Clarifications Q3): a title, an optional due date, an
  optional reminder, an optional link to one ticket or one customer. No sub-tasks, checklists,
  dependencies, or recurrence.
- **Templates are plain text with no variable substitution** and insert into notes (Clarifications
  Q2). Personalisation tokens become meaningful when there is a channel to send on (Phase 5).
- **Supervisors and administrators can view another agent's queue**; ordinary agents cannot.
- **No workload metrics, capacity balancing, or team dashboards.** PLAN.md places reporting and
  analytics in Phase 10 and departments in Phase 12.
- **Test coverage follows the pattern Phases 1–3 established.** The generated permission matrix
  extends to the new modules automatically, and recipient isolation for notifications and tasks is
  verified by test rather than by inspection.

## Out of Scope

Recorded so later phases do not assume these were delivered here:

- **Customer-facing correspondence of any kind** — replies, email, chat, SMS (Phase 5). Templates in
  this phase insert into internal notes and have no outbound channel (Clarifications Q2).
- **Email, SMS, or push delivery of notifications** (Phase 5 provides the transports).
- **SLA definitions, policies, computed targets, business-hours calendars, automatic escalation, and
  rule-based automation** (Phase 6). This phase has a manually set due date and a warning against it,
  and nothing more (Clarifications Q1).
- **Cross-user task assignment or delegation** (Clarifications Q3). Tasks are personal; directing
  work remains Phase 3 assignment.
- **Agents claiming or reassigning their own tickets.** Assignment remains Supervisor-only
  (Phase 3 Clarifications Q3).
- **Team, department, or queue-based work distribution** (Phase 12).
- **Workload metrics, agent performance measures, and team dashboards** (Phase 10).
- **Knowledge-base article suggestion inside the ticket** (Phase 7); the template library is not a
  knowledge base.
- **Customer visibility of notes, tasks, or ticket activity** (Phase 8).
- **Notification preferences, digests, muting, or quiet hours.**
- **Rich-text notes, attachments on notes, and template variable substitution.**
