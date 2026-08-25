# Specification Quality Checklist: Phase 0 — Project Foundation

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-25
**Feature**: [spec.md](../spec.md)

## Content Quality

- [ ] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [ ] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [ ] No implementation details leak into specification

## Notes

**Re-validated 2026-08-25 after `/speckit-clarify` session: 16/16 → 13/16 items passing.**

Three items regressed, all for the same root cause. The five clarifications introduced
concrete technical specifics into the spec:

- `/api/` route prefix (FR-020)
- Root `lang` / `dir` HTML attributes (FR-022, SC-008)
- `users` table column list (FR-006, FR-006a)

**Recommendation: accept these three as known, justified exceptions rather than reworking
the spec.** Phase 0 is a scaffolding phase whose entire deliverable _is_ project structure —
the route path shape, the root element attributes, and the baseline schema are the actual
subject matter, not leaked implementation detail. Abstracting them away would make the spec
unimplementable and would discard the decisions just made. Every later phase (1–12) specifies
user-facing behaviour and should be held to the strict reading of these three items.

All other items pass, and several materially improved:

- _Requirements are testable_: token expiry is now concrete (15 min / 7 days), so User Story 2's
  expired-token scenario is finally testable.
- _Scope is clearly bounded_: explicit out-of-scope statements now exist for test tooling,
  API versioning, WCAG auditing, and Phase 1 tables.
- _Edge cases_: token-type confusion at the refresh endpoint added.

No [NEEDS CLARIFICATION] markers exist. One spec contradiction was found and resolved:
PLAN.md's "empty baseline" migration vs. FR-009's seeded test user — resolved in favour of a
minimal `users` table, documented as a deliberate deviation in the spec's traceability section.

The spec is ready for `/speckit-plan`.

### Constitution compliance (v1.1.0)

- Bilingual-First & RTL: Addressed in FR-010, FR-011, FR-012 and User Story 3
- Security by Default: Addressed in FR-002, FR-003, FR-007, FR-009
- Layered Architecture: Addressed in FR-004, FR-015
- Phase-Gated Delivery: This spec IS the specify step for Phase 0
- Traceability: PLAN.md "Phase 0 — Project Foundation" is the referenced source; every
  Scope bullet and Definition-of-done clause is mapped in the spec's PLAN.md
  Traceability section. The SRS document is NOT referenced (it is not present in the repo).
- Accessibility (Principle IV): previously absent from the spec entirely — now covered by a
  structural baseline (FR-022–FR-024, SC-007, SC-008). Full WCAG 2.1 AA audit deferred to
  phases with real feature screens.

### Risk flagged for `/speckit-plan`

No automated test framework is established in Phase 0 (user decision). Phase 1 delivers RBAC
and audit logging, where the constitution requires provable server-side permission enforcement.
Recommend introducing the test harness at the start of Phase 1 so that security-critical logic
is not written untested.

---

### Post-implementation re-validation (2026-08-25, `/speckit-implement`)

**Status unchanged: 13/16.** The three unchecked Content Quality / technology-agnosticism items
remain accepted exceptions for exactly the reason recorded above — Phase 0's deliverable *is*
project structure, so the route prefix, root `lang`/`dir` attributes, and baseline schema are the
subject matter rather than leaked detail. Implementation surfaced no reason to revisit that
judgement, and no new exception was needed.

Phases 1–12 remain held to the strict reading of these three items.

### Carry-forward into the Phase 1 spec (MANDATORY)

`plan.md` Complexity Tracking records the deferred audit log as **time-boxed**, and that entry is
still accurate as built: Phase 0 authenticates users and `pino` logs every login attempt, but no
`audit_logs` table exists (FR-006b forbids it here). Both Complexity Tracking rows were verified
against the implementation:

- *Two JWT signing secrets* — built as specified. `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are
  separate, startup rejects them if equal, and each token additionally carries a `type` claim.
- *No audit logging* — still open, still deferred, still time-boxed.

**Phase 1's spec MUST treat the audit log as a first-class deliverable and MUST NOT inherit it as
assumed-done.** The same applies to the test framework recorded under "Risk flagged" above: no test
runner exists in Phase 0 by decision, and Phase 1 delivers RBAC, where the constitution requires
provable server-side enforcement. Stand the harness up at the start of Phase 1.
