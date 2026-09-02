# Specification Quality Checklist: Phase 9 — AI Features

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

All checklist items pass. The spec is ready for `/speckit-plan`.

### Clarifications resolved (Session 2026-09-01)

| Marker | Question                              | Resolution                                                                        |
| ------ | ------------------------------------- | --------------------------------------------------------------------------------- |
| FR-008 | Data egress to a third-party provider | **Split by surface.** Staff-facing features may use an external provider; the chatbot must not leave controlled infrastructure. |
| FR-045 | Categorisation: applied or proposed   | **Proposed only.** Classification never writes `tickets.category`; a human accepts. |
| FR-065 | Retention of AI inputs and outputs    | **Metadata only.** No submitted content or generated text is stored.               |

Each resolution propagated beyond its own requirement, and the propagation is the part worth re-reading:

- **Q1** added FR-008a (routing to a processor is structural, not configuration) and FR-008b (no fallback
  from controlled infrastructure to an external provider), plus SC-024a. The failure mode being designed
  against is a chatbot quietly pointed at the wrong processor by a settings edit.
- **Q2** rewrote the whole categorisation block. FR-045b now states as a verifiable property that Phase 6
  automation and SLA policy never evaluate a machine-written category, and SC-012 became an assertion that
  no classification path writes the field at all. User Story 4's scenarios were rewritten from "applies" to
  "proposes", gaining a dismissal case.
- **Q3** added FR-065a–c and SC-024b. FR-065a is the one to keep an eye on: it reconciles "store no
  content" with FR-043's requirement that chatbot conversations be retrievable, on the grounds that a
  conversation is retained as *speech to a customer*, not as an AI artefact. Anyone reading only one of
  those two requirements will think the spec contradicts itself.

### Validation notes

- **Numbering gaps are intentional.** SC-008 and SC-009 are unassigned so the summarisation and drafting
  block (SC-001–SC-007) and the categorisation block (SC-010–SC-012) start on round numbers, in the same
  style as the Phase 8 spec.
- **Constitution gate for `/speckit-plan`.** The Technology Standards table fixes the stack and names no AI
  provider, and its Governance section requires an explicit amendment rather than unilateral introduction
  within a phase. Q1 needs two entries — an external provider and a controlled-infrastructure processor —
  and the amendment should also close the "AI provider selection" Open Item that this spec now answers.
  This is a plan-stage gate, not a spec defect.
- **Three success criteria are deliberately human-judged** (SC-002, SC-006, SC-010). There is no automated
  oracle for whether generated text is useful; asserting one would produce tests that pass while the
  feature is worthless.

---

## Post-implementation note (2026-09-02)

This checklist validated the SPEC, and it still passes as written. Recorded here
because two requirements read differently once implemented, and a reviewer
comparing spec to code will hit both.

**FR-002 needed a table the plan said not to build.** The plan's data-model
stated "no per-model or per-provider configuration table", and that still holds
for the provider and the processing location. But FR-002's "switchable by a
permitted administrator" and SC-021's "within one page load" cannot be satisfied
by environment variables — they need a restart, cannot be edited through a
screen, and a change to one is not auditable. So `ai_settings` exists for the
toggles, ceilings, assistant languages and grounding floor, seeded from env,
with `AI_ENABLED` remaining the environment-level master switch. This follows
Phase 6's stated rule rather than departing from it: env holds operational
tuning, anything an administrator edits at runtime with an audit entry is a row.

**FR-052 asks for something this system does not have.** "Respect the viewer's
existing ticket visibility" reads as though a scoping predicate belongs in the
similar-ticket query. It does not: staff visibility here is `tickets:view` and
nothing narrower, and the ownership matrix scopes only notifications and tasks.
The route gate IS the rule. It is documented at length in
`similar-ticket.service.ts` so its absence does not look like the omission
SC-014 exists to catch, and that comment names the query Phase 12 must revisit
when RBAC becomes department-aware.
