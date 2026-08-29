# Implementation Plan: Phase 3 — Ticket Management (Core)

**Branch**: `004-phase-3-ticket-management` | **Date**: 2026-08-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-phase-3-ticket-management/spec.md`

**PLAN.md Reference**: Phase 3 — Ticket Management (Core)

**Builds on**: Phase 2 — Customer Management, merged to `main` at `f7a86c6`

## Summary

The ticket that carries a customer's problem from arrival to resolution: creation, a six-state
lifecycle, Supervisor-directed assignment, manual escalation, a per-ticket history, and merge and
link.

Three decisions carry the phase.

**The lifecycle is a declared table, not a scatter of conditionals.** SC-002 requires every status
pair to behave correctly, and SC-003 requires a forbidden transition to be refused identically when
invoked directly. A transition rule expressed as `if` statements across a service is one that tests
must mirror by hand — and a mirror drifts. This plan puts the permitted transitions in a single
constant that the enforcement, the interface, and a generated test all read, exactly as the
permission catalog worked in Phase 1. A pair nobody declared is forbidden by default.

**Ticket history is its own table, not a view over the audit log.** FR-037 makes a ticket's history
readable by anyone who can read the ticket, while Phase 1's audit log is `audit:view` only. Those are
different access rules over what would be the same rows, and reconciling them inside one store means
every audit query grows a visibility condition that is easy to get wrong in the direction of leaking.
Two stores, dual-written in one transaction, keeps each one's rule simple.

**Merge preserves provenance rather than moving rows.** FR-041 says the survivor "carries" the merged
ticket's history. Physically relocating entries would lose which ticket each originally belonged to —
the very thing an agent reading the history needs to understand what happened. The survivor's history
query instead spans the tickets merged into it, transitively.

## Technical Context

**Language/Version**: TypeScript ~6.0.2 strict on Node.js 22.17.1 LTS, both workspaces — unchanged

**Primary Dependencies**: **No new dependencies.** Express 5, Sequelize 6 + `mysql2`, `zod`, `pino`
on the backend; Vue 3.5, Vite 8, Pinia 3, vue-router 4, vue-i18n 11, Tailwind v4 on the frontend;
Vitest 4, supertest 7, `@vue/test-utils`, `happy-dom` for tests. This phase is entirely domain logic
over machinery that already exists

**Storage**: MySQL 8.4, `utf8mb4_0900_ai_ci`. **Three new tables** — `tickets`, `ticket_history`,
`ticket_links` ([data-model.md](./data-model.md)). Categories and priorities are fixed enumerations
in code, not tables (Clarifications Q1, research.md D6)

**Testing**: Vitest across both workspaces. Two generated matrices this phase: the Phase 1 permission
matrix extends automatically to the nine new keys, and a **new transition matrix** covers all 36
ordered status pairs from the same constant the enforcement reads (research.md D1)

**Target Platform**: Linux/Windows server; evergreen browsers

**Performance Goals**: Ticket lists and histories return without perceptible delay at realistic
volume (SC-011). Every list is paged and every filter column indexed; the reference lookup is an
indexed exact match

**Constraints**:

- Lifecycle transitions enforced **server-side** (FR-017) — a status field guarded only by which
  buttons the interface renders is the same defect as a permission hidden only in the interface
- Assignment is **Supervisor-only**; an Agent cannot claim a ticket (Clarifications Q3)
- An Agent may **close** a ticket assigned to them; only a Supervisor may **reopen** (Q2)
- Categories are a **fixed set** with no management interface (Q1)
- A merged ticket must be unworkable **by every route**, not merely hidden (FR-043)
- Ticket history is append-only and readable by anyone who can read the ticket (FR-034, FR-037)
- No SLA timers, no comments, no attachments, no channel creation — those are Phases 5, 6, and 7

**Scale/Scope**: ~18 new backend endpoints, 3 new tables, 9 new permission catalog entries, ~6 new
frontend screens, ~150 new i18n keys per locale

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Evaluated against constitution **v1.1.0**.

### Initial evaluation (pre-research)

| Gate | Status | Evidence |
|---|---|---|
| **I. Bilingual-First & RTL** (NON-NEGOTIABLE) | PASS | FR-056, FR-057, FR-060; SC-012–SC-014. A ticket description is the longest free text this system has accepted, so Arabic handling is called out rather than assumed |
| **II. Security by Default** (NON-NEGOTIABLE) | PASS | FR-050 inherits Phase 1's enforcement; **FR-017 extends the same principle to the lifecycle**, which is this phase's novel surface. FR-052 requires audit alongside ticket history |
| **III. Layered Architecture** (NON-NEGOTIABLE) | PASS | FR-061 carries the layering forward |
| **IV. Accessibility** | PASS | FR-058, FR-059; SC-012 |
| **V. Phase-Gated Delivery** | PASS | specify → clarify (3 questions resolved inline) → plan, in order |
| **Technology Standards** (fixed stack) | PASS | No new dependency of any kind |
| **Traceability to PLAN.md** | PASS | Every Scope bullet and all three Definition-of-done parts mapped |

No gate fails and none is PARTIAL. Research proceeded.

### Post-design re-evaluation

Re-checked after [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/](./contracts/), and [quickstart.md](./quickstart.md).

| Gate | Status | What the design added |
|---|---|---|
| **I. Bilingual-First & RTL** | PASS | Status, category, and priority render from i18n keys rather than stored labels, so a status name is never an untranslated database string on screen (D6) |
| **II. Security by Default** | PASS — strengthened | D1 makes the lifecycle a declared table read by enforcement and tests alike, so a forbidden transition cannot be permitted by an oversight in one branch. D3 makes a merged ticket unworkable in the **service**, so every route inherits it. D2 keeps the audit log's access rule unchanged rather than loosening it to serve a second reader |
| **III. Layered Architecture** | PASS | Transition legality, merge resolution, and assignment rules all live in services; controllers translate. The lifecycle constant sits in `tickets/` beside the permission catalog's equivalent, because it is a declaration rather than logic |
| **IV. Accessibility** | PASS | Reuses the Phase 1/2 components whose keyboard and announcement behaviour is already tested |
| **V. Phase-Gated Delivery** | PASS | Artifacts complete; ready for `/speckit-tasks` |
| **Technology Standards** | PASS | Still no new dependency |
| **Traceability** | PASS | quickstart.md maps all three Definition-of-done parts |

**Outcome: gate passes with no violations.**

## Project Structure

### Documentation (this feature)

```text
specs/004-phase-3-ticket-management/
├── plan.md                    # This file
├── spec.md                    # Feature specification (+ Clarifications: categories, closure, assignment)
├── research.md                # Phase 0 output — 10 decisions
├── data-model.md              # Phase 1 output — 3 new tables, lifecycle table, permission additions
├── quickstart.md              # Phase 1 output — validation procedure
├── contracts/                 # Phase 1 output
│   ├── ticket-api.md          #   ticket, lifecycle, assignment, history, merge and link endpoints
│   ├── ticket-lifecycle.md    #   the transition table every later phase inherits
│   └── ticket-ui.md           #   list, detail, history timeline, merge and link patterns
├── checklists/
│   └── requirements.md        # Spec quality checklist (16/16)
└── tasks.md                   # Phase 2 — created by /speckit-tasks, NOT by this command
```

### Source Code (repository root)

Additions to the existing tree. Unchanged files omitted.

```text
crm-project/
├── backend/
│   ├── src/
│   │   ├── auth/permissions.ts               # + 9 ticket-module entries
│   │   ├── tickets/
│   │   │   ├── lifecycle.ts                  # NEW — THE transition table; a declaration, not logic
│   │   │   └── taxonomy.ts                   # NEW — fixed categories and priorities (Q1)
│   │   ├── routes/tickets/
│   │   │   ├── index.ts                      # NEW
│   │   │   ├── tickets.routes.ts             # NEW
│   │   │   ├── history.routes.ts             # NEW
│   │   │   └── links.routes.ts               # NEW
│   │   ├── controllers/tickets/              # NEW — HTTP only
│   │   ├── services/
│   │   │   ├── ticket.service.ts             # NEW — creation, edit, listing
│   │   │   ├── ticket-lifecycle.service.ts   # NEW — the ONLY place a transition is judged
│   │   │   ├── ticket-assignment.service.ts  # NEW
│   │   │   ├── ticket-history.service.ts     # NEW — append-only writer and reader
│   │   │   └── ticket-merge.service.ts       # NEW — merge, link, survivor resolution
│   │   ├── models/
│   │   │   ├── ticket.model.ts               # NEW
│   │   │   ├── ticket-history.model.ts       # NEW
│   │   │   └── ticket-link.model.ts          # NEW
│   │   └── db/migrations/                    # NEW — three tables
│   └── tests/tickets/                        # NEW — incl. the generated transition matrix
│
└── frontend/
    ├── src/
    │   ├── router/index.ts                   # + /tickets routes
    │   ├── services/tickets.service.ts       # NEW
    │   ├── stores/tickets.store.ts           # NEW
    │   ├── components/tickets/               # NEW — StatusBadge, TransitionControl, HistoryTimeline,
    │   │                                     #       MergeDialog, LinkPicker
    │   ├── views/tickets/                    # NEW — List, Form, Detail
    │   └── locales/{ar,en}.json              # + ~150 keys each, identical sets
    └── tests/tickets/                        # NEW
```

**Structure Decision**: `backend/src/tickets/` holds `lifecycle.ts` and `taxonomy.ts` — declarations
every layer reads, with no model access and no decisions of their own. This mirrors
`backend/src/auth/permissions.ts` from Phase 1 and `backend/src/lib/phone.ts` from Phase 2: the
project has a consistent home for "the single source of truth about a rule", separate from the
services that apply it. The lifecycle service is split from the ticket service because judging a
transition is a distinct concern from editing a subject line, and conflating them is how the
transition check ends up skipped on one path.

## Complexity Tracking

> No Constitution Check gate failed. These are decisions whose cost is real enough to record.

| Decision | Why Needed | Simpler Alternative Rejected Because |
| --- | --- | --- |
| **The lifecycle is a declared constant read by enforcement, interface, and tests** (research.md D1) | SC-002 requires all 36 ordered status pairs to behave correctly and SC-003 requires identical refusal when invoked directly. One declaration means the test cannot disagree with the code, because both read the same thing | *Conditionals in the service*: the obvious approach, and it works until someone adds a status. Then the tests still pass while mirroring the old rules, which is the worst possible failure — a green suite over a broken lifecycle. *A database table of transitions*: editable at runtime, which nobody wants, and it makes the rules invisible to code review |
| **Ticket history is a separate table, dual-written with the audit log** (D2) | FR-037 makes ticket history readable by anyone who can read the ticket; the audit log is `audit:view` only. Two access rules over one store means every audit query carries a visibility condition, and the failure direction is leaking administrative events to an agent | *A view over `audit_logs`*: no duplication, and genuinely attractive — the events overlap heavily. Rejected because it forces the audit log's simple rule ("administrators only") to become conditional, and because the two have different retention futures: an audit log is a compliance artifact, a ticket history is working context. **Accepted cost**: some events are written twice, in one transaction |
| **Merge spans histories rather than moving rows** (D3) | FR-041 requires the survivor to carry the merged ticket's history. Provenance — which ticket an entry originally belonged to — is exactly what the reader needs | *Reassign `ticket_id` on the merged entries*: simpler query, and loses the distinction between "this happened to this ticket" and "this happened to a ticket that was merged in". An agent reading the result could not tell the two apart. *Copy the entries*: duplicates rows and doubles the write |
| **The reference is derived from the ticket's own identifier** (D5) | FR-004 requires a unique, stable, readable reference. Deriving it from the primary key is unique by construction, with no counter to contend over | *A separate counter table*: needs a row lock per creation, which serialises ticket creation for no gain. *A random or opaque reference*: unique, and unreadable aloud — which is the one thing FR-004 asks for. **Accepted cost**: the reference reveals roughly how many tickets exist. For an internal support system that is not sensitive, and the alternative costs either contention or readability |

### Changed during implementation

Three things the design got slightly wrong, found by building it. Recorded here rather than quietly
corrected, because the reasoning is what a later phase inherits.

- **The reference is derived at read time, not stored** (D5). The decision called for a stored
  generated column; **MySQL forbids a generated column expression that refers to an `AUTO_INCREMENT`
  column**, so that form was never available. Deriving it in `backend/src/tickets/reference.ts` keeps
  the property D5 was actually after — the reference is a presentation of the primary key — and is
  the better end of the constraint: there is no window in which a row exists without a reference, no
  uniqueness to enforce beyond the primary key's own, and searching by reference becomes an exact id
  lookup rather than a `LIKE`. data-model.md and contracts/ticket-api.md were corrected to match.

- **`TRANSITION_NOT_ALLOWED` and `TICKET_MERGED` carry their structure as SIBLING keys**, not inside
  `details`. The contracts were drafted as `details.allowed` and `details.survivorId`. The codebase's
  `details` is `{ field, message }` pairs with a defined meaning, and Phase 2 had already established
  the sibling pattern for `duplicates` for exactly this reason. Following the existing envelope beat
  changing it for one phase.

- **Three permissions are conditional, not one.** `tickets:close` was anticipated. `tickets:reopen`
  gates a single edge a route probe cannot reach without first constructing a closed ticket, and
  `tickets:manage_any` is never a route gate at all — it is only ever an additional allowance the
  service consults. The matrix test's two coverage assertions were widened to accept a named
  conditional test as coverage. That is not a loosening: the existing "every conditional permission
  names the test that covers it" assertion still holds, so exempt-and-untested remains impossible.

### Non-violations worth recording

- **No new dependencies.** The first phase since Phase 0 to add none — this is domain logic over
  machinery that already exists.
- **`record.deleted` finally has a caller**, in merge (FR-053). Phase 1 defined it expecting Phase 2
  to be first; Phase 2's Clarification Q1 ruled out deletion and carried it forward. Research D8
  confirms merge is genuinely the right caller rather than a convenient one: a merged ticket is
  removed from active work permanently and irreversibly, which is what the key means.
- **`tickets:close` is a conditional permission**, like `notes:manage` in Phase 2 — an Agent may close
  a ticket assigned to them, and acting on someone else's requires `tickets:manage_any`. It is
  declared in the matrix test's `CONDITIONAL_PERMISSIONS` and names the test covering it, per the
  mechanism Phase 2 added.
- **Categories and priorities are code enumerations, not tables** (Q1). If a later phase needs
  Administrator-managed categories, that is an additive migration plus a management screen — nothing
  built now blocks it, and nothing built now anticipates it.

## Outstanding from earlier phases

Not blockers, recorded so they are not lost:

- **Browser checks are unrun across three phases** — Phase 0's V8–V10, Phase 1's V6–V8, Phase 2's
  V7–V8. This phase adds three more screens to the same shell. The constitution's per-phase gate
  clauses 2 and 4 have now been "built but not visually confirmed" three times running, and each
  phase makes the eventual verification pass larger.
- **Nothing since Phase 0 is pushed.** `origin/main` is at `b864d17`; Phases 1 and 2 exist only in
  the local repository.
- **The attachment tests leave files on disk** with no cleanup, so the suite accumulates them. A small
  leak, fixable in the test helper's teardown.
