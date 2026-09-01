# Specification Quality Checklist: Phase 8 — Customer Portal

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

**Status: PASS** — 16 of 16. Ready for `/speckit-plan`.

## Validation Notes

### Iteration 1 — 2026-09-01

Three `[NEEDS CLARIFICATION]` markers were raised at the phase's three genuine decision points, each
one changing what gets built rather than only how it looks. All other items passed.

### Iteration 2 — 2026-09-01 (after clarification)

All three resolved by the user. Q1 → invite-only; Q2 → per-contact visibility; Q3 → no portal uploads.
Recorded under `## Clarifications → Session 2026-09-01` with the reasoning and the cost of each, and
propagated through the spec rather than only noted:

| Answer                            | Propagated to                                                                                                                                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q1 — invite-only**              | FR-002–FR-002f, FR-003–FR-003b, FR-056; User Story 1 (retitled — issuing the invitation moved in from User Story 8, which invite-only makes inseparable from the credential); edge cases; SC-001, SC-025–SC-027; Out of Scope         |
| **Q2 — per-contact visibility**   | FR-015–FR-017, FR-026–FR-026j, FR-032, FR-033, FR-055, FR-057a, FR-060a; User Story 3 (rewritten), User Story 8; Key Entities (Ticket Requesting Contact, Portal Account); SC-003, SC-007, SC-028, SC-029, SC-031                    |
| **Q3 — no portal uploads**        | FR-022–FR-022b; User Story 2 scenario 6, User Story 5 scenario 5; edge cases; SC-030; Out of Scope, with the condition for lifting it stated                                                                                        |

**The largest consequence is structural and belongs in the plan.** Q2 requires an association a ticket
does not currently carry — which contact it came from (FR-026a) — set at all four points a ticket is
born (FR-026b–FR-026e), failing closed where absent (FR-026f), with one deterministic backfill
(FR-026g) and a manual path for the rest (FR-026h, FR-057a). `/speckit-plan` should treat this as the
phase's second-largest piece of work after the identity realm separation, not as a field addition.

**Two open items are deliberately left open, and named rather than hidden:**

- The virus-scanning deferral Phase 2 recorded is **still open**. Q3 declines the capability rather than
  the safeguard, so the deferral is now a stated precondition for accepting portal uploads (Out of
  Scope) rather than an inherited Phase 2 leftover. It has not been resolved, and the spec says so.
- Whether a provisional customer record may be invited is settled as "yes, but only by explicit staff
  act, and the rule is enforced server-side" (FR-002f, Assumptions). An organisation preferring to
  forbid it outright changes one requirement; flagged as a `/speckit-clarify` candidate.

### Iteration 3 — 2026-09-01 (after implementation)

The spec is unchanged by implementation: no requirement was found unbuildable, and no requirement
needed rewording to match what was built. Three things are worth recording against it.

**Two requirements turned out to describe more work than their wording implied**, and both are now
stated in the plan's _Changed during implementation_ table rather than left as surprises:

- **FR-033** reads as a scoping rule on an existing capability. `message-attachment.service`
  exports `findForDownload`, which had no caller and no route anywhere in the codebase — Phase 5 listed
  message attachments without ever serving their bytes. The portal builds the first download endpoint.
- **FR-026d** cannot work against Phase 5 as it stood: a form's identity comes from a field typed
  `email` OR `phone`, and every form fell through to phone normalisation, so an email address matched
  no existing contact and each submission created another provisional customer. Fixed in
  `contactKindFor`, which improves Phase 5's behaviour as a side effect.

**One requirement's mechanism changed, and the requirement did not.** FR-036 offered "reopening within
a defined window"; the lifecycle already encodes finality (`closed → open` is Supervisor-only), so the
implementation uses that boundary instead of inventing a second time-based rule. The requirement's own
words permit either — "one stated rule" — and the plan states which.

**Verified, not asserted.** 235 portal tests across 13 files, plus the full frontend suite (188) and
the authorization matrix (151) including the new `portal:manage` probe. The two enumerated matrices —
realm and scope — iterate `portal/endpoints.ts` rather than sampling, per SC-002 and SC-003.

**Nine tasks remain open in tasks.md, all deliberately.** T125–T128 and T132–T136 are manual passes
and human judgements: a by-eye RTL review of a whole conversation, a WCAG pass in both languages, an
actual phone, greyscale, reading the invitation email cold, and the two questions that need somebody
who runs support — whether `pending` means "waiting for you", and whether a customer reply reopening a
resolved request should restart the SLA response clock. Ticking those would be a claim about
verification that has not happened.

**Content-quality note.** Named prior decisions (Phase 2 Q3, Phase 5 D14, Phase 7 Q1) and internal
vocabulary such as ticket status names, `customers:update`, `customers.company`, and `is_provisional`
appear where a requirement must be traceable to the commitment or existing structure it honours. These
are references to this project's own requirements record, not technology choices — no framework,
language, library, or API shape is specified anywhere in the spec.

**Scope-boundary note.** Portal reply (User Story 5, FR-034–FR-036) is not named in PLAN.md's Phase 8
scope bullets. It is included with its reasoning stated in Assumptions and flagged there as the first
candidate if scope must be cut — a deliberate, visible extension rather than an unexamined one.

**Two decisions PLAN.md left to this phase were resolved without asking**, because earlier phases had
already framed them and only one reading survives that framing:

- The chat widget's per-conversation token is **replaced**, not promoted to a credential (FR-011).
- The authenticated portal **reuses** Phase 7's public help-centre content set rather than adding a
  second one (FR-046).

## Notes

- No blocking items remain. `/speckit-clarify` is optional; the two named open items above are the only
  candidates for it.
