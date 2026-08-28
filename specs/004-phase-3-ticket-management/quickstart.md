# Quickstart: Phase 3 — Ticket Management (Core)

**Feature**: `004-phase-3-ticket-management` | **Date**: 2026-08-28

How to run and validate this phase. Details live in [data-model.md](./data-model.md),
[contracts/](./contracts/), and [research.md](./research.md) — this file says what to run and what
should happen.

---

## Prerequisites

- Phases 0, 1, and 2 merged to `main` and working.
- MySQL 8.4 running; `crm_support` and `crm_support_test` exist.
- `npm install` at the repo root (workspaces install both packages).
- At least one customer exists — a ticket needs one, and creating against a deactivated customer is
  refused by design (FR-007).

---

## Setup

```powershell
npm run migrate --workspace backend
npm run seed --workspace backend
npm run dev
```

The migration adds `tickets`, `ticket_history`, and `ticket_links`, and grants the nine new
permissions to the three roles.

**The test helper must be updated in the same change.** `backend/tests/helpers/database.ts` names
each seeder explicitly and carries a note that a later phase must add its own. Phase 2 learned this
the hard way: forgetting it makes every new test return 403 for reasons that look nothing like the
cause.

---

## Automated validation

```powershell
npm test                                    # full suite, both projects
npm test -- ticket-lifecycle.matrix         # all 36 ordered status pairs
npm test -- authorization.matrix            # catalog x roles, now 27 permissions
npm test -- ticket-merge                    # including the three-ticket chain
```

Expected: the Phase 0–2 suite still passes unchanged, plus the new tests. No existing test should
need editing — Phase 3 adds tables and permissions and changes nothing already built. If an existing
test needs a change, that is a signal to look at what was altered rather than at the test.

Two tests are **generated**, not hand-written:

- The **lifecycle matrix** walks every from/to pair per role against the declared table. It reads the
  same constant the service reads, so it proves the service honours the declaration rather than that
  someone transcribed a list correctly twice.
- The **permission matrix** grows by nine keys automatically, and additionally asserts every
  `/api/tickets` route carries a permission and every catalog key is enforced somewhere.
  `tickets:close` is declared in `CONDITIONAL_PERMISSIONS` and must name the test covering its
  ownership rule.

---

## Manual validation

Sign in as each role to check the parts a test suite cannot see.

### V1 — Create and list (US1)

Create a ticket with an Arabic subject and description. It gets a `TKT-` reference, status `new`, and
appears in the list. Filter by status, priority, and assignee; confirm the filters are in the URL and
survive a reload.

### V2 — Lifecycle (US2)

From `new`, confirm the only offered move is **Open**. Walk `open → pending → open → resolved`.
Confirm **Resolved is not offered from New** and **Closed is not offered from Open** — the two
constraints most likely to be missing.

Then attempt an illegal move directly against the API:

```powershell
curl -X POST http://localhost:3000/api/tickets/1/transitions `
  -H "Authorization: Bearer $token" -H "Content-Type: application/json" `
  -d '{\"to\":\"resolved\",\"version\":0}'
```

Expect `422 TRANSITION_NOT_ALLOWED` with `details.allowed` naming what *is* reachable. **A refusal
that names nothing is a failed check** — the requirement is a message that tells the user where they
can go (FR-017).

### V3 — Assignment (US3)

As Supervisor, assign, reassign, and unassign. As **Agent**, confirm the assignment control is absent
and that calling the endpoint directly returns `403` — including when assigning to yourself. There is
no claim action (Q3).

### V4 — Close and reopen (US2)

As the assigned Agent, close your own resolved ticket. As a different Agent, confirm you **cannot**
close it. As Supervisor, reopen it and confirm **all prior history is still present** (FR-022).

### V5 — History (US4)

Open the history. Confirm oldest-first ordering, previous and new values on each change, and that
actor names remain readable. Deactivate the actor and confirm the entries stay attributed (FR-038).
Confirm no write endpoint exists.

### V6 — Merge (US5)

Merge B into A. Confirm B shows a permanent banner naming A, that every action on B is refused
through the interface **and** through a direct API call, and that A's history now spans both.

Then merge A into C and re-open B: it must resolve to **C** (FR-045). This three-ticket chain is the
check that separates a working merge from one that looks correct until the second merge.

### V7 — Links (US6)

Link two tickets, confirm the relationship appears on both, that a duplicate is refused in either
direction, and that unlinking leaves both tickets otherwise untouched (FR-049).

### V8 — Arabic and RTL

Switch to Arabic. The whole ticket interface mirrors: filters, timeline, dialogs, pagination arrows.
Statuses and priorities appear as Arabic labels, not as `open` or `high`. A **mixed Arabic-and-Latin
subject** must not scramble — this is the phase's longest free text and the most likely place for a
bidirectional defect.

### V9 — Accessibility

Keyboard-only: reach every control, open and dismiss the merge dialog, confirm focus returns to the
trigger. Confirm status is not conveyed by colour alone and that icon-only controls announce
something.

---

## A standing note on V8 and V9

The browser checks have gone unrun for **three consecutive phases** — Phase 0 V8–V10, Phase 1 V6–V8,
Phase 2 V7–V8. Constitution principles I and IV are built and unit-tested but have never been
visually confirmed, and RTL and accessibility defects are precisely the kind that pass every test and
fail every user.

Phase 3 is a good place to stop deferring: it introduces the longest Arabic free text so far, a modal
dialog, and a timeline whose direction is the whole point. Running V8 and V9 once, here, would
retire the accumulated risk from all three phases rather than carrying it into a fourth.
