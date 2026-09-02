# Specification Quality Checklist: Integrations

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-02
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

**16/16 pass.** All three clarifications were resolved in-session and are recorded with their
reasoning in the spec's Clarifications section: the ERP adapter contract plus a simulator (Q1),
administrator-issued machine credentials (Q2), and identifier-only notification payloads (Q3).

**One gate is outstanding and is not a spec defect.** Q2's decision deviates from the Technology
Standards table, whose own rule requires an amendment rather than a phase-level decision. The
amendment is proposed in [constitution-amendment-proposal.md](../constitution-amendment-proposal.md)
and needs explicit approval before any Phase 11 implementation task begins. `/speckit-plan` can be
run against this spec; `/speckit-implement` cannot proceed without the approval.

**One constitution open item remains open by design.** "ERP system identity" survives the amendment
in reworded form. Q1 settles how this system talks to an ERP; it cannot settle which ERP the
organisation runs, and recording that as answered would be false.

### Deliberately not marked as needing clarification

- **Numbers.** Rate limits, retry counts, rotation-overlap length, delivery timeouts and retention
  periods are specified as "stated" rather than fixed. They are tuning values that need real
  conditions to choose well, and inventing them here would give them unearned authority — the
  treatment Phase 10 gave its suppression floor, which is still recorded as an open question there.
- **Read-only.** Write-through was decided rather than asked: PLAN.md's Definition of done asks only
  that an external system can *pull* data and receive a webhook, and widening the interface later is
  an additive version change rather than a redesign. Recorded in Assumptions and Out of Scope.
- **Delivery guarantees.** At-least-once and unordered were chosen rather than asked, because the
  alternatives have consequences a stakeholder should not have to adjudicate: exactly-once requires
  receiver cooperation this system cannot enforce, and ordered delivery lets one slow receiver hold
  up every later event. Both are stated as requirements (FR-031, FR-032) precisely so a receiver
  cannot be surprised by them.

### Watch during planning

- **FR-010 is the requirement most likely to be quietly broken.** "The interface MUST NOT restate
  business rules" is easy to satisfy on day one and easy to lose the moment an endpoint needs a
  field no existing service returns. Phase 10 made this checkable with a single-boundary module and
  an import-graph test; this phase should plan the equivalent rather than rely on review.
- **FR-034 inverts a Phase 9 check.** Phase 9 refuses to *call out* to anything that is not a
  private address (the AI processor must be on controlled infrastructure). This phase refuses to call
  out to anything that *is* one. Two opposite rules about outbound addresses in one codebase is a
  genuine trap for whoever implements the second, and they should not share a helper without the
  direction being explicit in its name.
