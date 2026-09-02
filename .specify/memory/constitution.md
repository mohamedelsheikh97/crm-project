<!--
## Sync Impact Report

### v1.3.0 (2026-09-03)
Bump type: MINOR — materially expanded guidance; no principle removed or redefined.

Modified:
- Technology Standards: the single "Authentication" row split into "Authentication — people"
  (JWT at login, preserved verbatim) and "Authentication — machines" (administrator-issued
  client credentials, hashed at rest, verified per request)
- Technology Standards: new "Machine client authentication" paragraph requiring the secret to be
  verifiable but not retrievable, rotatable with an overlap, and revocable with immediate effect —
  and forbidding a machine credential from impersonating a user or exceeding the authority of the
  person granting it
- Open Items: "ERP system identity and integration protocol (needed before Phase 11)" reworded to
  "ERP system identity" — Phase 11 settles the protocol via its adapter contract, and the identity
  remains outstanding because which ERP the organisation runs is not a design decision

Reason: Phase 11 exposes a published interface to external systems. A machine client never logs in,
so the fixed-stack table's authentication row did not describe it, and the table's own rule forbids
introducing a deviation within a phase spec. The option needing no amendment — a long-lived
service-account JWT — was rejected because a JWT is valid until expiry by design, which contradicts
Phase 11's FR-019 requirement of immediate revocation unless a revocation list is added, at which
point it is the same per-request database lookup with extra machinery.

Migration: none. No completed phase is affected — Phases 0-10 contain no machine clients, every
authenticated request in them comes from a person's session, and the human-authentication row is
preserved unchanged. Phase 11 is additive; its FR-067 requires the system to work with every
integration capability switched off, and SC-026 asserts that by running the Phase 0-10 suite
unchanged.

Proposal: specs/012-phase-11-integrations/constitution-amendment-proposal.md

### v1.2.0 (2026-09-02)
Bump type: MINOR — materially expanded guidance; no principle removed or redefined.

Modified:
- Technology Standards: two AI processing rows added (staff-facing external provider,
  customer-facing controlled-infrastructure processor)
- Technology Standards: new "AI processing boundary" paragraph making the per-surface
  egress split a governance rule rather than a deployment decision
- Open Items: "AI provider selection (needed before Phase 9)" removed — resolved by
  specs/010-phase-9-ai-features/spec.md Clarifications Q1

Reason: Phase 9 introduces AI processing. The fixed-stack table named no AI provider, and
the table's own rule forbids introducing one unilaterally within a phase spec. Phase 9
Clarifications Q1 splits egress per surface, so two entries are required rather than one.

Migration: none. No completed phase is affected — Phases 0-8 contain no AI processing, and
Phase 9 is additive (SC-022 asserts the Phase 0-8 suite passes with the capability disabled).

Proposal: specs/010-phase-9-ai-features/constitution-amendment-proposal.md

### v1.1.0 (2026-08-25)
Bump type: MINOR — traceability source redefined; no principle removed.

Modified:
- Principle I rationale: SRS citation → PLAN.md citation
- Principle II: account-lockout threshold sourced from PLAN.md Phase 1, not SRS NFR-2
- Principle V: traceability now references PLAN.md phase headings instead of
  FR-x.y identifiers from `Customer_Support_CRM_SRS.docx`
- Technology Standards: "SRS Traceability" → "Traceability", now anchored to
  PLAN.md Scope bullets and Definition of done
- Definition-of-done gate item 5: FR-x.y traceability → PLAN.md Definition of done

Reason: `Customer_Support_CRM_SRS.docx` is not present in the repository. PLAN.md is
the only authoritative requirements document available, so all traceability now
anchors to it.

### v1.0.0 (2026-08-25)
Bump type: MAJOR — initial substantive constitution; all placeholders replaced.

Added Sections:
- Core Principles (all five: Bilingual-First & RTL, Security by Default,
  Layered Architecture, Accessibility, Phase-Gated Delivery)
- Technology Standards (fixed stack, traceability)
- Development Workflow & Phase Ordering

Modified Principles: None (initial creation).
Removed Sections: None.
Deferred TODOs: None.
-->

# CRM-Support Constitution

## Core Principles

### I. Bilingual-First & RTL (NON-NEGOTIABLE)

Every UI component MUST render correctly in both Arabic (RTL) and English (LTR).
The i18n scaffolding (ar/en locale files, RTL root-level toggle) is established in
Phase 0 and MUST remain active and correct in every subsequent phase.

- All new screens, components, and form elements MUST be tested in both language directions
  before a phase is marked done.
- RTL layout MUST be applied at the root level; per-component hacks to flip direction
  are prohibited.
- Text content MUST be externalised into locale files; hardcoded strings in templates
  or component logic are prohibited.

**Rationale:** PLAN.md explicitly makes bilingual Arabic/English support a cross-cutting
concern enforced from Phase 0, not a feature to be retrofitted at Phase 12.

### II. Security by Default (NON-NEGOTIABLE)

Access control and audit logging are structural, not cosmetic.

- Permission checks MUST be enforced server-side on every protected endpoint; hiding
  UI elements is insufficient and MUST NOT substitute for server enforcement.
- JWT tokens MUST be verified by middleware on every protected route; tokens MUST NOT
  be validated only at login.
- Audit logging MUST capture every security-relevant event: logins, failed login attempts,
  permission changes, data exports, and record deletions.
- Passwords MUST be hashed using a recognised adaptive algorithm (bcrypt or Argon2);
  plaintext storage or reversible encryption is prohibited.
- Account lockout MUST activate after repeated failed login attempts (threshold
  configurable; established in PLAN.md Phase 1).

**Rationale:** The RBAC model introduced in Phase 1 underpins every subsequent phase.
A permission gap found in Phase 8 is far more expensive than one caught in Phase 1.

### III. Layered Architecture (NON-NEGOTIABLE)

Both the backend and frontend MUST maintain strict layer separation.

**Backend (Express + Sequelize):**

- Layer order: `routes → controllers → services → models`.
- Business logic MUST live in service files only; route handlers MUST delegate immediately
  to a controller, and controllers MUST delegate business logic to a service.
- Models MUST NOT contain business logic beyond schema definition and simple query scopes.

**Frontend (Vue 3 + Pinia + typescript):**

- Composition API (`<script setup>`) MUST be used for all components; Options API is
  prohibited.
- Global and cross-component state MUST be managed via Pinia stores; local component
  state is acceptable only when it does not cross component boundaries.
- API calls MUST be centralised in service/composable modules; components MUST NOT call
  `fetch`/`axios` directly.

**Rationale:** The layered structure was mandated in PLAN.md as a cross-cutting rule
for all phases. Violations discovered late (e.g., business logic in a route handler in
Phase 5) require refactoring across layers that should have been clean from Phase 0.

### IV. Accessibility

All user-facing screens MUST meet WCAG 2.1 AA accessibility standards in both Arabic
and English language modes.

- Interactive elements MUST be keyboard-navigable and have appropriate ARIA labels.
- Color contrast ratios MUST meet WCAG AA minimums (4.5:1 for normal text).
- RTL layouts MUST preserve logical reading order for screen readers.
- Form validation errors MUST be announced to screen readers, not only indicated visually.

**Rationale:** Accessibility is listed as a cross-cutting concern in PLAN.md alongside
RTL support. Retrofitting ARIA and contrast after all screens are built is consistently
more expensive than applying it incrementally per phase.

### V. Phase-Gated Feature Delivery via Spec Kit

Every feature or phase MUST progress through the full Spec Kit workflow before
implementation begins.

- Workflow order: `/speckit-specify → /speckit-plan → /speckit-tasks → /speckit-implement`.
- `/speckit-plan` output MUST be reviewed against this constitution before `/speckit-tasks`
  is generated; a plan that violates a NON-NEGOTIABLE principle MUST be revised before
  proceeding.
- Traceability MUST be maintained: every spec and task MUST reference the originating
  phase heading in `PLAN.md` (e.g., "Phase 3 — Ticket Management (Core)").
- Phases 0–3 and Phase 1's RBAC model MUST NOT be reordered; all later phases depend on
  them. Phases 9 and 10 MAY be reordered relative to each other if priorities shift.

**Rationale:** PLAN.md explicitly requires the Spec Kit cycle per phase and designates
this constitution as the gate that each `/speckit-plan` run must pass before task generation.

## Technology Standards

The following stack is fixed for this project. Deviations require explicit amendment to
this constitution and MUST NOT be introduced unilaterally within a phase spec.

| Layer                | Technology                                                 |
| -------------------- | ---------------------------------------------------------- |
| Frontend framework   | Vue 3 (`<script setup>` Composition API)                   |
| Frontend build       | Vite                                                       |
| Frontend language    | TypeScript (strict mode)                                   |
| Frontend styling     | Tailwind CSS                                               |
| Frontend state       | Pinia                                                      |
| Backend runtime      | Node.js + Express                                          |
| Backend ORM          | Sequelize                                                  |
| Database             | MySQL                                                      |
| Authentication — people | JWT (issued at login, verified per request via middleware) |
| Authentication — machines | Administrator-issued client credentials (identifier + secret), hashed at rest, verified per request |
| Internationalisation | vue-i18n with `ar` and `en` locale files                   |
| AI — staff-facing    | Anthropic Claude API (`claude-opus-5`) via `@anthropic-ai/sdk` |
| AI — customer-facing | Self-hosted OpenAI-compatible inference server on controlled infrastructure |

**Machine client authentication.** An external system authenticating to the published interface
presents an administrator-issued credential rather than a token obtained by logging in, because it
has no login. The credential's secret MUST be stored such that it can be verified but not retrieved,
MUST be rotatable with an overlap during which both the old and new secrets are accepted, and MUST be
revocable with immediate effect — a mechanism that cannot be revoked before it expires does not
satisfy this. A machine credential carries its own authority, expressed in the same permission
vocabulary used for people; it MUST NOT impersonate a user, because attributing an automated action
to whichever administrator configured it makes the audit trail misleading. A machine credential MUST
NOT be able to reach anything a person granting it could not reach themselves.

**AI processing boundary.** Staff-facing AI features — ticket summarisation, reply drafting, and
similar-ticket suggestion — MAY transmit ticket content to the external provider named above. The
customer-facing assistant MUST NOT: its processing occurs only on infrastructure the organisation
controls. This boundary MUST be structural in code rather than configurable at runtime, and MUST fail
closed. Changing which surface uses which processor is an amendment to this constitution, not a
deployment decision.

**Traceability:** `PLAN.md` is the authoritative requirements source for this project.
Every Spec Kit spec and task file MUST reference the PLAN.md phase it implements, and MUST
map its requirements back to that phase's **Scope** bullets and **Definition of done**.
This enables audits to confirm full PLAN.md coverage across phases.

**Open Items (to resolve before the relevant phase begins, not before Phase 0):**

- SLA response/resolution time targets (needed before Phase 6)
- ERP system identity — which product the organisation runs (Phase 11 delivers the adapter
  contract and a simulator; the protocol question is settled by that contract, the identity is not)
- Branding assets per organisation/department (needed before Phase 12)
- Code style conventions (ESLint/Prettier config — establish in Phase 0 CI pipeline)

## Development Workflow & Phase Ordering

**Phase sequencing:**
Phases are executed in dependency order. The mandatory ordering constraints are:

- Phases 0 → 1 → 2 → 3 are strictly ordered; later phases depend on all of them.
- Phase 4 depends on Phase 3; Phase 5 depends on Phases 3 and 4.
- Phase 6 depends on Phases 3, 4, and 5.
- Phase 7 depends on Phases 1 and 3; Phase 8 depends on Phases 1, 3, and 7.
- Phase 9 depends on Phases 3, 5, and 7.
- Phase 10 depends on Phases 3–9 (needs real operational data).
- Phase 11 depends on Phases 1–10.
- Phase 12 depends on Phase 1 (RBAC must be department-aware from the start of this phase).
- Phases 9 and 10 MAY be reordered relative to each other.

**Definition-of-done gate (per phase):**
A phase is complete only when:

1. All tasks generated by `/speckit-tasks` are marked done.
2. The feature works in both Arabic (RTL) and English (LTR).
3. Server-side permission checks are verified (not just UI hiding).
4. All screens pass basic WCAG 2.1 AA checks.
5. The phase's PLAN.md **Definition of done** is satisfied and traceable to merged code.

**Constitution review:**
Every `/speckit-plan` output MUST be cross-checked against this constitution by the
reviewer before `/speckit-tasks` is run. Particular attention MUST be paid to the
RTL/i18n and layered-architecture rules, as these are the most commonly violated quietly
within a single phase implementation.

## Governance

This constitution supersedes all other informal practices, ad-hoc decisions, and
phase-level notes. Where any spec, plan, or task conflicts with this constitution, the
constitution prevails and the conflicting artifact MUST be revised.

**Amendment procedure:**

1. Propose the amendment in writing, citing the principle or section being changed and
   the rationale.
2. Obtain explicit approval before any Spec Kit phase that the amendment would affect.
3. Provide a migration note if the amendment requires retroactive changes to completed
   phases (e.g., a new mandatory field in all audit logs).
4. Increment `CONSTITUTION_VERSION` per semantic versioning:
   - MAJOR: removal or backward-incompatible redefinition of any NON-NEGOTIABLE principle.
   - MINOR: new principle or section added, or materially expanded guidance.
   - PATCH: clarifications, wording fixes, non-semantic refinements.
5. Update `LAST_AMENDED_DATE` to the date of the amendment.

**Compliance review:**

- All code reviews and PR approvals MUST verify compliance with the NON-NEGOTIABLE
  principles (Bilingual-First & RTL, Security by Default, Layered Architecture).
- The reviewer, not only the implementer, is responsible for catching violations.
- Complexity introduced beyond what the current phase requires MUST be justified against
  YAGNI; speculative abstractions are prohibited.

**Runtime governance reference:** `.specify/memory/constitution.md` (this file) is the
authoritative governance document for all `/speckit-plan` runs.

**Version**: 1.3.0 | **Ratified**: 2026-08-25 | **Last Amended**: 2026-09-03
