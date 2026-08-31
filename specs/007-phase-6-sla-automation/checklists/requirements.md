# Specification Quality Checklist: Phase 6 — SLA & Automation

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-31
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

**Validation iteration 1 — 2026-08-31.** Two `[NEEDS CLARIFICATION]` markers (FR-024, FR-025) plus a
scope question on FR-044 were raised as Questions 1–3. All other items passed.

**Validation iteration 2 — 2026-08-31.** All three answered and encoded; checklist complete.

- **Q1 → working time against a configurable business calendar**, defaulting to Sunday–Thursday,
  09:00–17:00, Africa/Cairo, with dated non-working exceptions. Default targets are now stated as a
  table in FR-009 (urgent 1h/4h, high 4h/1d, normal 8h/3d, low 1d/5d, editable). New: FR-025a–FR-025c,
  FR-026–FR-027 tightened, SC-016. **This closes the constitution's Open Item _"SLA response/resolution
  time targets (needed before Phase 6)"_ — the constitution should be updated to record it as resolved
  during `/speckit-plan`.**
- **Q2 → the resolution target computes the due date; a human override outranks it permanently.** New:
  FR-024, FR-024a–FR-024d, SC-017. Honours Phase 4 FR-028's seam, and FR-024c explicitly treats
  pre-existing hand-set dates as overrides rather than machine values — the trap Phase 4 warned about.
- **Q3 → skill-based routing is in scope as a minimal competency model** over Phase 3's existing
  category taxonomy, with a load-based fallback. New: FR-044, FR-044a–FR-044d, SC-018, and a
  competency permission added to FR-082. No teams, no proficiency levels (Phase 12).

Notes on the closer calls, retained from iteration 1:

- **Content Quality / no implementation details**: the spec names existing project _behaviours_ it must
  not break (the queue's due-date sort, the notification store, Phase 5's transports and opt-out rules)
  rather than modules, tables, or endpoints. Traceability to earlier phases is required by the
  constitution, so these references stay.
- **Success criteria technology-agnostic**: SC-004 and SC-011 mention "verified by test", which is a
  verification method rather than a technology, and SC-014 names the Phase 4 surfaces that must keep
  working — both stay measurable without naming a stack.
- **Testable and unambiguous**: FR-013, FR-046, and FR-060 deliberately require _that_ a precedence,
  tie-break, and run order be documented and deterministic without fixing the algorithm, which is a
  `/speckit-plan` decision. Each is testable as stated (two identical runs, identical result).

**Carried into `/speckit-plan`** — decisions this spec deliberately leaves to design:

- The policy precedence rule of FR-013 (priority-and-category over priority over category over
  catch-all is the obvious candidate, but it must be stated and tested).
- Whether breach detection extends the existing in-process scheduler sweeps or introduces a third one,
  and how FR-034's idempotency marker is shaped (Phase 4's `due_warning_sent_for` value-comparison
  pattern is the precedent).
- Whether the rule engine evaluates synchronously after commit or on the scheduler, given FR-071's
  requirement that a rule failure never fails the triggering interaction.

Ready for `/speckit-plan`. Constitution check to perform there: Principle I (every new configuration
screen bilingual, FR-083–FR-085), Principle II (server-side gates on all six new permissions, FR-082;
bounded rule authority, FR-058), Principle III (the SLA clock and rule engine belong in services, not
in models or route handlers).
