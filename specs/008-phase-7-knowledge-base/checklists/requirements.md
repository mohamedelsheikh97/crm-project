# Specification Quality Checklist: Phase 7 — Knowledge Base

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-01
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

**Validation iteration 1 — 2026-09-01.** Three `[NEEDS CLARIFICATION]` markers raised at FR-005,
FR-011 and FR-032, each a place where PLAN.md's own scope bullets are ambiguous rather than a place
where a default existed and was not chosen. All other items passed.

**Validation iteration 2 — 2026-09-01.** All three answered and encoded; checklist complete.

- **Q1 → a public, unauthenticated help centre ships in this phase.** New: FR-032, FR-032a–FR-032e,
  SC-015, SC-017. The deciding argument was not the scope bullet but Phase 5's Out of Scope, which
  assigned *deflection before a conversation starts* to Phase 7 — deferring the public surface would
  have left two consecutive phases each believing the other owned it. FR-032a carries the
  consequence: this is the fourth entry in the single-file public router Phase 5 built so the whole
  unauthenticated surface stays readable at once.
- **Q2 → the knowledge base has its own taxonomy; a guide is an ordered series of articles.** New:
  FR-011, FR-011a–FR-011d, SC-014, and a `Guide` key entity. FR-040 was rewritten to match: because
  the taxonomies differ, suggestion cannot match on category equality and the KB↔ticket relationship
  must be stated explicitly. That is the price of a taxonomy worth browsing, and it is recorded
  rather than absorbed.
- **Q3 → one language is enough to publish, and the language is always shown.** New: FR-005,
  FR-005a–FR-005c, SC-016. Follows Phase 4 FR-070's precedent for one-language templates. FR-029 is
  what makes it survivable: a cross-language near-miss is made discoverable rather than reported as
  a flat absence.

Notes on the closer calls, retained from iteration 1:

- **Content Quality / no implementation details**: the spec names existing project *behaviours* it
  must not break (Phase 4's template library staying separate, Phase 6's automation catalog and run
  record, Phase 5's single-file public router and its rate limiting) rather than modules, tables, or
  endpoints. Traceability to earlier phases is required by the constitution, so these stay.
- **Success criteria technology-agnostic**: SC-004 says "fast enough to be used while a customer is
  waiting" rather than naming a millisecond budget — user-facing and still testable.
- **Testable and unambiguous**: FR-019, FR-039 and FR-040 deliberately require relevance ordering to
  be *deterministic and best-first* without fixing the ranking algorithm, which is a `/speckit-plan`
  decision. Each is testable as stated (two identical queries, identical order).
- **FR-029 is deliberately weak on mechanism.** It requires a cross-language near-miss to be
  *discoverable*, not that search silently translates. How is a design decision.

**Carried into `/speckit-plan`** — decisions this spec deliberately leaves to design:

- **How search actually works in Arabic.** MySQL's built-in full-text tokenisation has a minimum
  token length and no Arabic stemming, and FR-027 forbids silently discarding legitimate short
  terms. Whether that means tuning the engine, a different index strategy, or something else is the
  single largest open design question in this phase — and FR-020 makes it non-negotiable that both
  languages work.
- **The stated KB↔ticket-category relationship FR-040 requires**, and whether it is per-article,
  per-KB-category, or a mapping table.
- **Whether deflection reuses the ticket-suggestion path** or is a separate public one, given that
  the two have different visibility rules (FR-031 internal articles must never leak to FR-032d).
- **How the public surface is rate limited** relative to Phase 5's existing scopes (FR-036).

Ready for `/speckit-plan`. Constitution check to perform there: Principle I (article content
direction independent of interface direction, FR-055; and the Q3 consequence that a reader may meet
an article they cannot read), Principle II (a new unauthenticated surface — FR-032a–FR-032c are the
defence, and the permission matrix must extend over the new keys), Principle III (search and
suggestion belong in services, not in models or route handlers).
