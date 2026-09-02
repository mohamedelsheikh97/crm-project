# Specification Quality Checklist: Phase 10 — Reports & Management

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

All checklist items pass. The spec is ready for `/speckit-plan`.

### Clarifications resolved (Session 2026-09-02)

| Marker | Question                                    | Resolution                                                              |
| ------ | ------------------------------------------- | ----------------------------------------------------------------------- |
| FR-030 | Who may see an agent's performance figures  | **Supervisors and administrators only.** No agent access, not even to their own. |
| FR-045 | What "real-time" means for the dashboard    | **Automatic refresh on an interval**, configurable.                     |
| FR-011 | Reports reflect the past as it was, or now  | **As it is now.** Current record state, with disclosure.                |

Each resolution propagated beyond its own requirement, and the propagation is the part worth
re-reading:

- **Q1 rewrote a user story and added a success criterion.** User Story 5 lost its agent-facing half;
  scenarios 4 and 5 now assert refusal and supervisor-mediated investigation instead. FR-030a splits
  the permission from operational reporting, FR-030b closes the side doors (ticket screen,
  notification, shared dashboard component), and SC-014a requires every reporting endpoint, export and
  dashboard component to be enumerated against an agent session.
  **The consequence worth keeping in view:** an agent cannot check a figure that is wrong about them.
  FR-034 was strengthened rather than left alone, because traceability is now the only route by which a
  disputed figure can be settled at all.
- **Q2 turned one requirement into five.** Interval refresh has failure modes that on-load computation
  does not: refreshes overlapping under load (FR-045a), a dashboard querying all night on an
  unattended screen (FR-045b), a screen reader announcing every changed number (FR-045c), and a failed
  refresh blanking the screen (FR-045d). SC-018 now specifies measurement with the maximum number of
  dashboards open simultaneously, and SC-018a–b make the first two testable.
- **Q3's mitigation is a requirement, not a footnote.** FR-011a requires every report to state that it
  reflects current state. Without it, a manager who quoted last month's figure and finds it has moved
  has no explanation — and that is the failure mode Q3 chose to accept. FR-011b gives two previously
  open edge cases a definite answer, and SC-026a asserts the disclosure exists.

### Validation notes

- **The central risk is stated in the Overview rather than buried in a requirement.** A wrong number
  looks exactly like a right one, does not error, and gets acted on. FR-001 through FR-008 exist
  because of it, and SC-001's "matches a hand-computed count, with zero discrepancies" is the only
  criterion that can establish correctness at all — which is why the Assumptions section explicitly
  forbids verifying one query against another. Two queries that agree can both be wrong.
- **FR-007 and SC-025 are the architectural constraint, expressed as a requirement.** Reporting is the
  first phase that reads across all forty-eight tables, and the danger is a reporting query becoming a
  second definition of another phase's rules. The two will drift, the report will be the wrong one, and
  nothing will say so.
- **Numbering note.** FR-036 and FR-061 both guard small-sample identification from different
  directions: FR-036 protects an individual from being characterised by a handful of tickets, FR-061
  prevents aggregation being used to reach records the viewer could not see directly. They are not
  duplicates and both should survive review.
- **One success criterion is deliberately human-judged.** SC-021 requires a reader of Arabic to open
  each export format. RTL in PDF is the hardest part of FR-048, and no automated check establishes that
  a document is legible.
- **No constitution gate this time.** Unlike Phase 9, nothing here touches the fixed technology stack:
  reporting reads the existing database with the existing framework. If the plan concludes that the
  operational database cannot serve these reports at the required volumes, that becomes a finding to
  raise — the spec's Out of Scope deliberately refuses to adopt a warehouse speculatively.
