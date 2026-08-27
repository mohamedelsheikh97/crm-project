# Specification Quality Checklist: Phase 1 — Security & Administration Foundations

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-26
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

**Validated 2026-08-26: 16/16 items passing.**

Initial validation found 15/16, failing only on two `[NEEDS CLARIFICATION]` markers. Both were
resolved in the same session and the spec updated; re-validation passes all sixteen.

### Resolved during `/speckit-specify`

- **FR-031 — MFA.** PLAN.md listed it as "(Optional per SRS priority)", explicitly deferring the
  decision rather than omitting it. **Resolved: out of scope for this phase.** No MFA-related field
  is added in anticipation of a flow that is not being built.
- **FR-021 — custom roles.** PLAN.md named three roles without saying whether the set was closed.
  **Resolved: the set is fixed.** Agent, Supervisor, and Administrator are seeded and permanent;
  only the permissions each holds are editable.

Both decisions **narrowed** scope, so no requirement was weakened or made vaguer in order to let an
item pass.

### Content Quality note

Unlike the Phase 0 checklist — where three items were accepted as permanent exceptions because that
phase's deliverable *was* project structure — this spec holds to the strict reading. Requirements are
phrased in terms of outcomes ("evaluated against currently stored permissions", "a recognised
adaptive hashing algorithm") rather than named technologies. The role names Agent, Supervisor, and
Administrator come from PLAN.md and are domain vocabulary, not implementation detail.

### Constitution compliance (v1.1.0)

- **I. Bilingual-First & RTL**: FR-044, FR-045; User Story 5 acceptance scenarios 2 and 3; SC-009,
  SC-010
- **II. Security by Default**: the substance of this phase — FR-015, FR-016 (server-side
  enforcement), FR-025 (adaptive hashing), FR-026–FR-030 (lockout), FR-032–FR-041 (audit logging).
  **This phase closes the audit-logging deviation Phase 0 recorded as time-boxed.**
- **III. Layered Architecture**: FR-051 carries the Phase 0 layering forward and requires
  authorization decisions in the service layer
- **IV. Accessibility**: FR-046, FR-047; SC-009
- **V. Phase-Gated Delivery**: this spec is the specify step for Phase 1; PLAN.md Phase 1 is
  referenced throughout and traced in the PLAN.md Traceability section
- **Technology Standards**: no deviation proposed; the spec names no technologies
- **Traceability**: every Scope bullet and both halves of the Definition of done are mapped

### Risks flagged for `/speckit-plan`

1. **No test framework exists.** Phase 0 shipped without one by user decision. SC-003 requires
   verifying every role-and-action combination through a path that bypasses the interface — that is
   impractical to do exhaustively by hand and will not stay verified as later phases add modules. The
   spec records standing up a harness as an assumption; the plan should treat it as a task.
2. **FR-016 versus Phase 0's session design.** Phase 0 issues short-lived tokens carrying no role or
   permission claims. FR-016 and FR-017 require decisions against current stored state within 60
   seconds, which constrains how much authorization data may be cached in a token. The plan must
   resolve this deliberately rather than by default.
3. **FR-041 (audit write failure).** Requiring that a failed audit write surface rather than vanish
   raises a real design question — whether the audited action rolls back with it. The plan should
   decide this explicitly.

---

### Post-implementation re-validation (2026-08-26, `/speckit-implement`)

**Status unchanged: 16/16.** No accepted exception changed, and no new one was needed. Both
clarification decisions held through implementation without pressure to revisit them:

- **MFA stayed out of scope.** A scope audit confirms no MFA column, flow, or setting exists
  anywhere in `backend/src` or `frontend/src`. Nothing was added "in anticipation".
- **The role set stayed fixed.** No create, rename, or delete route or column exists. A request to
  create a role receives `404`, because the route genuinely does not exist rather than being
  guarded.

### Complexity Tracking verified against what was built

All four `plan.md` entries describe the implementation accurately:

1. **Authorization read per request.** Built as designed — the token carries no role or permission
   claims, and `authenticate` loads the current row every time. Verified live: after granting
   `audit:view` to Agent, an agent's **existing token** reached the endpoint immediately. Staleness
   is zero, not merely bounded.
2. **A locked account is indistinguishable from an unknown one.** Built, and the accepted cost is
   real: a locked-out user cannot self-diagnose. Verified byte-identical live and by test A6, which
   also asserts no path is an order of magnitude faster. **The right fix remains out-of-band
   notification once email exists in Phase 5 — not weakening the response.**
3. **State-changing audit writes share the action transaction.** Built. Proven by shrinking the
   `action` column so the audit insert fails, then confirming the state change rolled back with it.
   The documented residual limitation stands unchanged: authentication-path events cannot be
   transactional, and log loudly instead.
4. **Catalog in code, grants in data.** Built. Adding a module in a later phase needs no migration.

### Carry-forward into the Phase 2 spec (MANDATORY)

**Phase 0's audit deviation is closed.** It was recorded as time-boxed and must not be carried
further. Test A7 enumerates `AUDIT_ACTIONS` and exercises each trigger, so the closure is evidenced
rather than asserted. Phase 2 inherits a working audit log, not an obligation to build one.

Three things Phase 2 must pick up rather than reinvent:

- **Adding a protected endpoint takes three steps, not one**: a catalog entry in
  `backend/src/auth/permissions.ts`, a `requirePermission` on the route, and a grant decision in the
  seeder. The matrix test fails the build on any omission — including a catalog key that nothing
  enforces. That failure is the feature.
- **`data.exported` and `record.deleted` already exist in `AUDIT_ACTIONS` with no callers.** Phase 2
  is the first phase with real records to delete, so it must wire those keys rather than inventing
  its own shape.
- **The admin UI patterns are fixed** in `contracts/admin-ui.md` and built as reusable components:
  `DataTable`, `TablePagination`, `FormField`, `EmptyState`, `ConfirmDialog`. Later screens reuse
  them so RTL correctness and keyboard behaviour are inherited rather than re-derived per screen.

### Risks flagged for Phase 2

- **The browser checks V6–V8 have not been run** (no browser available in the implementation
  session). The screens are built and the locale-parity and component tests pass, but the visual
  and keyboard confirmation is outstanding. Phase 0's V8–V10 are likewise unconfirmed, and this
  phase's screens sit inside that same shell.
- **The test suite takes roughly two minutes** because bcrypt at cost 12 is deliberately slow and
  integration tests share one database serially. That is acceptable now; if it becomes a drag,
  lowering the cost factor **in the test environment only** is the correct lever — never in
  production.
