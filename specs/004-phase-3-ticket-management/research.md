# Phase 3 Research: Ticket Management (Core)

**Feature**: `004-phase-3-ticket-management` | **Date**: 2026-08-28

Resolves every unknown in the plan's Technical Context, plus the four risks the spec's quality
checklist flagged for planning. Decisions here are binding for implementation.

## Observed starting state

| Observation | Implication |
|---|---|
| The permission catalog is a code constant; the matrix test is generated from it | A new module is catalog entries plus a seeder line, and SC-010 holds by construction (D4) |
| The matrix test models **conditional** permissions, added in Phase 2 for `notes:manage` | `tickets:close` fits that model exactly — it depends on assignment, not just role (D4) |
| `auditService.record(entry, transaction)` requires a transaction for state changes | Ticket history writes join the same transaction, so an unrecorded change is unrepresentable |
| `AuditLog` is readable only with `audit:view` | Conflicts with FR-037, which makes ticket history readable by anyone who can read the ticket — decisive for D2 |
| Optimistic locking via a `version` column is established on `users` and `customers` | Reused for tickets (FR-010) rather than reinvented |
| Customers are never deleted (Phase 2 Q1) | A ticket's customer reference is permanent — FR-002 relies on this, and it is why Phase 2 made that choice |
| `record.deleted` has been defined since Phase 1 with no caller | Merge is the candidate (D8) |
| Admin and customer UI components exist and are tested | Ticket screens inherit keyboard and RTL behaviour |
| No SLA, timer, scheduling, or background-job machinery exists anywhere | Confirms escalation is manual only; nothing here needs a scheduler |

---

## D1. The status lifecycle

**Decision**: a single declared constant in `backend/src/tickets/lifecycle.ts`:

```text
TRANSITIONS: for each status, the statuses reachable from it, and the permission each move requires
```

`ticket-lifecycle.service.ts` is the **only** place a transition is judged. It reads the constant,
answers "may this ticket move from A to B, by this user", and returns the reachable set when the
answer is no — so the refusal names what *is* possible rather than only what is not. The interface
reads the same constant through an endpoint, and a generated test walks all 36 ordered pairs.

**A pair nobody declared is forbidden.** The default is refusal, so adding a status without deciding
its transitions produces a ticket that cannot move rather than one that can move anywhere.

**Rationale**: SC-002 requires every pair to behave correctly and SC-003 requires a forbidden
transition invoked directly to be refused identically. One declaration read by enforcement and tests
alike means the test cannot disagree with the code — it is the same mechanism that made Phase 1's
permission matrix trustworthy, applied to a second kind of rule.

**Alternatives considered**:

- *Conditionals inside the ticket service*: the obvious approach. Rejected because the tests must
  then restate the rules, and a restatement drifts. The specific failure is nasty: someone adds a
  status, the hand-written tests still assert the old table, the suite stays green, and the lifecycle
  is broken in production with full test coverage.
- *A `ticket_transitions` table*: makes the rules data, editable at runtime. Nobody asked for
  runtime-editable transitions, and it would hide the rules from code review — the place they are
  most likely to be caught being wrong.
- *A state-machine library*: more than this needs. Six statuses and a permission per edge is a map,
  and a dependency would obscure rather than clarify it.

**Consequence to implement**: `GET /api/tickets/:id/transitions` returns the moves available to the
calling user, so the interface offers exactly what the server would accept — no duplicated rule on
the client.

---

## D2. Ticket history versus the audit log

**Decision**: a **separate `ticket_history` table**, written in the same transaction as the audit
entry for events that need both (FR-052).

| | Ticket history | Audit log |
|---|---|---|
| Read by | Anyone who can view the ticket (FR-037) | `audit:view` only |
| Read when | Routinely, before working a ticket | Occasionally, investigating |
| Contains | Changes to one ticket | Security-relevant events system-wide |
| Retention | Lives with the ticket | Compliance artifact |

**Rationale**: the access rules are the deciding factor. FR-037 deliberately makes ticket history
*less* restricted than the audit log. Serving both readers from `audit_logs` would mean every audit
query grows a visibility condition, and the failure direction is leaking administrative events —
password resets, permission changes — to an agent who only wanted to know why a ticket was
reassigned. Two stores keeps each rule simple enough to be obviously correct.

**Alternatives considered**:

- *A view over `audit_logs` filtered to `target_type = 'ticket'`*: no duplication, and the events
  genuinely overlap. Rejected on the access-rule conflict above, and because the two have different
  futures — an audit log is eventually archived or purged on a compliance schedule, while a ticket's
  history must survive as long as the ticket.
- *Ticket history only, no audit entries*: fewer writes, and it would violate FR-052. It would also
  mean a Supervisor reassigning tickets left no trace in the place an investigator looks.

**Accepted cost, recorded**: some events are written twice. Both writes share one transaction, so
they cannot diverge.

---

## D3. Merge semantics

**Decision**: a `merged_into_ticket_id` self-reference on `tickets`. The merged ticket is **retained**
— visible as a redirect — and:

1. **History spans rather than moves.** The survivor's history query returns entries for itself and
   for every ticket merged into it, transitively, each labelled with the ticket it belongs to.
   Provenance is preserved, which is what a reader needs.
2. **Chains resolve to one survivor.** `resolveSurvivor(ticketId)` follows `merged_into_ticket_id`
   with a depth limit and a cycle guard, so merging B into A and then A into C leaves B pointing at C
   through resolution rather than a two-hop redirect (FR-045).
3. **A merged ticket is unworkable in the SERVICE**, not the route. Every mutating ticket operation
   asserts the ticket is not merged before doing anything, so a route added in a later phase inherits
   the guard rather than having to remember it (FR-043).
4. **Self-merge and cycles are refused** before any write (FR-044).
5. **Cross-customer merge warns.** It is refused unless the caller acknowledges, using the same
   pattern Phase 2 used for duplicate customers — the interface shows what is about to be lost and
   asks (FR-046).

**Rationale**: merge is the hardest operation in the phase because FR-041, FR-043, and FR-045
interact. A partial implementation passes its first test and fails on the second merge. Putting the
guard in the service rather than the routes is what makes FR-043's "by any route" literally true.

**Alternatives considered**:

- *Reassign `ticket_id` on the merged entries*: one simple query for the survivor's history, and it
  destroys provenance — a reader could not tell what happened to *this* ticket from what happened to
  one merged in. That distinction is the reason the history exists.
- *Delete the merged ticket*: matches "duplicate removal" literally, and breaks every reference to
  it, including any link or history entry pointing at it. Retention as a redirect costs a row and
  keeps every reference valid.
- *Flatten the chain on each merge* (repoint all predecessors at the new survivor): avoids resolution
  at read time, at the cost of a write that grows with the chain and a window where the two disagree.
  Resolution is cheap and always correct.

---

## D4. Permission model additions

**Decision**: nine catalog entries in the existing `module:action` shape.

| Key | Meaning |
|---|---|
| `tickets:view` | See tickets and their history |
| `tickets:create` | Log a new ticket |
| `tickets:update` | Edit subject, description, category, priority |
| `tickets:transition` | Move a ticket through the lifecycle |
| `tickets:assign` | Assign, reassign, unassign — **Supervisor-only** (Q3) |
| `tickets:close` | Close a ticket **assigned to you** (Q2) — conditional |
| `tickets:reopen` | Reopen a Closed ticket — **Supervisor-only** (Q2) |
| `tickets:merge` | Merge one ticket into another |
| `tickets:link` | Link and unlink related tickets |
| `tickets:manage_any` | Act on a ticket assigned to someone else |

**Default grants**:

| Role | Gains |
|---|---|
| `agent` | `tickets:view`, `tickets:create`, `tickets:update`, `tickets:transition`, `tickets:close`, `tickets:link` |
| `supervisor` | the above plus `tickets:assign`, `tickets:reopen`, `tickets:merge`, `tickets:manage_any` |
| `admin` | all |

**`tickets:close` is conditional**, exactly as `notes:manage` was in Phase 2: the route requires
`tickets:close`, and the service additionally requires `tickets:manage_any` when the ticket is
assigned to someone else. It is declared in the matrix test's `CONDITIONAL_PERMISSIONS` and names the
test that covers it — the mechanism Phase 2 added for precisely this shape of rule.

**Rationale**: FR-051 requires viewing, creating, editing, assigning, and merging to be
distinguishable. Transition is separate from update because moving a ticket through its lifecycle is
a different act from correcting its subject. Reopen is separate from transition because Q2 gave it a
different authority level.

**Alternatives considered**:

- *One `tickets:manage`*: an Agent who may fix a typo could also reassign the team's workload, which
  is exactly the distinction Q3 drew.
- *Folding transition into update*: then an Agent with edit rights could close tickets, which Q2
  ruled out.

---

## D5. Ticket references

**Decision**: derived from the ticket's own primary key, formatted `TKT-000123` with at least six
digits and no upper bound. Stored as a generated column so it is queryable and indexable, rather than
computed on read.

**Rationale**: FR-004 wants unique, stable, and readable aloud. Derivation from the primary key is
unique by construction with nothing to contend over, and stable because a primary key never changes.
`TKT-000123` reads unambiguously over a phone.

**Alternatives considered**:

- *A separate counter table*: needed if the reference must not correlate with insertion order, at the
  cost of a row lock per creation — serialising every ticket creation for a property nobody asked
  for.
- *A random or opaque reference (UUID, base32)*: unique and unguessable, and unreadable aloud. FR-004
  asks for exactly the property this destroys.
- *A per-year sequence (`TKT-2026-0042`)*: friendlier for a human filing by year, and it needs a
  counter per year with the same contention problem.

**Accepted cost**: the reference reveals roughly how many tickets exist. For an internal support
system this is not sensitive, and every alternative costs either contention or readability.

---

## D6. Categories and priorities

**Decision**: fixed enumerations in `backend/src/tickets/taxonomy.ts`, not tables (Clarifications Q1).

- Categories: `general`, `technical`, `billing`, `complaint`
- Priorities: `low`, `normal`, `high`, `urgent`, each with a numeric rank so "more urgent" is a
  comparison rather than a label

Both are stored on the ticket as their string key and rendered from an i18n key, so a status or
category name is never an untranslated database string on screen.

**Rationale**: Q1 chose a fixed set. Code enumerations make the values reviewable, typed, and
impossible to reference a value that does not exist. The numeric priority rank matters because
sorting by priority is a real requirement in Phase 4 and sorting alphabetically would put "urgent"
below "normal".

**Alternatives considered**:

- *Lookup tables*: needed only if the set becomes editable, which Q1 ruled out. Adding them later is
  an additive migration.
- *Storing the display label*: guarantees an untranslated English string appears in an Arabic
  interface, which Constitution Principle I prohibits.

---

## D7. Assignment and closure rules

**Decision**: implements Clarifications Q2 and Q3 directly.

- **Assignment** requires `tickets:assign`, held only by Supervisors. There is **no self-assign
  endpoint and no claim action** — an Agent cannot assign a ticket to anyone, themselves included.
- **Closing** requires `tickets:close`, plus `tickets:manage_any` when the ticket belongs to someone
  else.
- **Reopening** requires `tickets:reopen`, held only by Supervisors.
- Assignment targets must be **active** users (FR-023); a ticket whose assignee is later deactivated
  stays workable and readable (FR-025), because the assignment is a reference rather than a
  permission check.

**Rationale**: these are recorded decisions rather than research findings, but they are written here
because the implementation must not quietly reintroduce a claim action. **Phase 4's agent dashboard
is read-only with respect to assignment** as a direct result, and that consequence is carried in the
spec's Clarifications and the Phase 2 checklist's Phase-4 note.

**Alternatives considered**: none — Q3 settled it. Recorded so a later reader sees the constraint is
deliberate.

---

## D8. Is merge the right caller for `record.deleted`?

**Decision**: **yes.** Merging emits `record.deleted` for the merged ticket, alongside a
`ticket.merged` entry on both tickets' histories.

**Rationale**: the checklist asked the plan to confirm this rather than reach for an available key.
The test is whether merge matches what the key means: *a record a user created is permanently removed
from active use*. It does — a merged ticket can never again be worked, assigned, or transitioned, and
the operation is not reversible in this phase. That it is retained as a redirect is an implementation
choice about referential integrity, not a statement that the record still exists as a working ticket.

**Alternatives considered**:

- *A new `ticket.merged` audit action instead*: more precise about what happened, and it would leave
  `record.deleted` uncalled for a fourth phase while an operation that plainly deletes a record used
  a different key. Both are emitted: `record.deleted` for the security-relevant fact, `ticket.merged`
  on the histories for the domain detail.
- *Neither*: FR-052 requires an audit entry for merge regardless.

---

## D9. Concurrency and editing rules

**Decision**: optimistic locking via a `version` column on `tickets`, as `users` and `customers`
already use. A stale write is `409 CONFLICT`.

Editing is refused when the ticket is **Closed** (FR-009) or **merged** (FR-043). Both checks live in
the service, so every route inherits them.

**Rationale**: FR-010's edge case is two agents saving the same ticket — common in a support system
where several people touch one ticket in an afternoon. The pattern exists and is tested; reusing it
costs nothing.

**Alternatives considered**: *Last-write-wins* silently discards one agent's work, which is the
scenario the edge case names.

---

## D10. Testing approach

**Decision**: extend the established suite, with one new generated matrix.

- **The permission matrix extends automatically** to the nine new keys; each needs a probe.
  `tickets:close` is declared conditional and names its covering test (D4).
- **A new transition matrix** walks all **36 ordered status pairs** from the same constant the
  enforcement reads, asserting permitted moves succeed and forbidden ones are refused with the
  reachable set named. This is SC-002 made mechanical.
- **A merge suite** covering the three interacting requirements: history spans (FR-041), a merged
  ticket is unworkable by every mutating route (FR-043), and chains resolve to one survivor
  (FR-045) — the last needing at least a three-ticket chain, since a two-ticket merge passes even
  when resolution is broken.
- **A history coverage suite** enumerating the change kinds in FR-031 and exercising each, as Phase 1
  did for audit actions.
- **An Arabic round-trip test** for subject, description, and escalation reason.

**Rationale**: the two matrices are what make SC-002 and SC-010 hold *over time* rather than on the
day they were written. The merge suite exists because that operation's failure mode is passing until
the second merge.
