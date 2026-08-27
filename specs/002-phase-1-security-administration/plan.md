# Implementation Plan: Phase 1 — Security & Administration Foundations

**Branch**: `002-phase-1-security-administration` | **Date**: 2026-08-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-phase-1-security-administration/spec.md`

**PLAN.md Reference**: Phase 1 — Security & Administration Foundations

**Builds on**: Phase 0 — Project Foundation (`001-phase-0-foundation`)

## Summary

Turn Phase 0's single seeded account into a real access model: a `roles` table with three fixed
roles, permissions expressed as `module:action` pairs granted to roles, server-side enforcement on
every protected route, password policy with lockout, and an append-only audit log.

The load-bearing decision is **where authorization state lives**. Phase 0 issues a 15-minute access
token carrying no role or permission claims, and its data-model anticipated adding them here. This
plan deliberately does not. FR-016 requires decisions against *current* stored permissions and
FR-007/FR-017 require changes to take effect within 60 seconds — a 15-minute token cannot satisfy
that, and shortening it to 60 seconds would triple the refresh traffic to buy a weaker guarantee.
Instead the token continues to answer only "who is this", and the database answers "what may they
do", on every protected request. Staleness becomes zero rather than merely bounded.

The second decision is that this phase finally has **tests**. Phase 0 shipped without a framework by
explicit user decision. SC-003 asks for every role × action combination to be verified through a
path that bypasses the interface — that is not hand-checkable, and it would silently rot as Phases
2–12 add modules. Vitest arrives here, and the permission matrix is generated from the catalog
rather than hand-written, so it stays complete by construction.

## Technical Context

**Language/Version**: TypeScript ~6.0.2 strict on Node.js 22.17.1 LTS, both workspaces — unchanged
from Phase 0 as built

**Primary Dependencies** (all existing from Phase 0 unless marked NEW):

- Backend — Express 5, Sequelize 6 + `mysql2`, `jsonwebtoken`, `bcrypt`, `zod`, `pino` +
  `pino-http`, `cookie-parser`, `cors`
- Frontend — Vue 3.5, Vite 8, Pinia 3, vue-router 4, vue-i18n 11, Tailwind CSS v4
- Testing (**NEW**) — `vitest` 4, `supertest` 7 for backend HTTP, `@vue/test-utils` 2 +
  `happy-dom` for components (research.md D8)
- Tooling — `sequelize-cli`, `tsx`, ESLint 10 flat config, Prettier

**Storage**: MySQL 8.4 in Docker Compose, as established in Phase 0. Four new tables this phase —
`roles`, `role_permissions`, `audit_logs`, `password_history` — plus new columns on `users`
([data-model.md](./data-model.md))

**Testing**: Vitest across both workspaces, introduced in this phase. Backend integration tests run
against a separate `crm_support_test` schema with migrations applied. The permission matrix
(SC-003) is a generated test over the permission catalog × the three roles, so coverage cannot drift
as later phases add modules (research.md D8)

**Target Platform**: Linux/Windows server for the backend; evergreen browsers for the frontend

**Project Type**: Web application — the existing `frontend/` + `backend/` npm workspaces

**Performance Goals**: Permission and deactivation changes effective within 60s (SC-004, SC-011) —
achieved at 0s by design. Audit log filtering usable as the log grows (FR-040), so all filter
columns are indexed and results are always paged. No throughput target; this phase has no business
load

**Constraints**:

- Authorization MUST NOT be decided from token claims alone (FR-016), which fixes the design in
  research.md D1
- The role set is fixed at three; no role creation, renaming, or deletion (FR-021, Clarifications Q2)
- MFA is out of scope, and no MFA-related column is added in anticipation (FR-031, Clarifications Q1)
- No email delivery exists until Phase 5, so password reset is Administrator-driven (spec Assumptions)
- Audit entries are append-only and must never contain credentials (FR-035, FR-036)
- The no-enumeration guarantee from Phase 0 extends to lockout: a locked real account and an unknown
  account must be indistinguishable (FR-030)

**Scale/Scope**: ~14 new backend endpoints, 4 new tables plus 6 new `users` columns, ~40 permission
catalog entries across the modules that exist today, ~8 new frontend screens, 2 new Pinia stores.
Roughly 120 new i18n keys per locale

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Evaluated against constitution **v1.1.0**.

### Initial evaluation (pre-research)

| Gate | Status | Evidence |
|---|---|---|
| **I. Bilingual-First & RTL** (NON-NEGOTIABLE) | PASS | FR-044, FR-045; every new screen is specified bilingual with root-level direction; SC-010 requires identical `ar`/`en` key sets |
| **II. Security by Default** (NON-NEGOTIABLE) | PASS | This phase *is* the principle: FR-015/FR-016 server-side enforcement, FR-025 adaptive hashing, FR-026–FR-030 lockout, FR-032–FR-041 audit logging. **Closes the time-boxed audit-logging deviation Phase 0 recorded** |
| **III. Layered Architecture** (NON-NEGOTIABLE) | PASS | FR-051 carries Phase 0's layering forward and places authorization decisions in the service layer |
| **IV. Accessibility** | PASS | FR-046, FR-047; SC-009. Unlike Phase 0 this phase has real screens, so the full WCAG 2.1 AA expectation applies rather than a structural baseline |
| **V. Phase-Gated Delivery** | PASS | specify → clarify (inline, 2 questions resolved) → plan executed in order; this gate is the constitution review |
| **Technology Standards** (fixed stack) | PASS | No stack substitution. Vitest is an addition in an area the constitution's table does not cover, resolved the same way Phase 0 resolved the backend-language gap |
| **Traceability to PLAN.md** | PASS | Spec maps every Scope bullet and both halves of the Definition of done; this plan references Phase 1 throughout |

No gate fails and none is PARTIAL. Research proceeded.

### Post-design re-evaluation

Re-checked after [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/](./contracts/), and [quickstart.md](./quickstart.md) were produced.

| Gate | Status | What the design added |
|---|---|---|
| **I. Bilingual-First & RTL** | PASS — strengthened | Locale key parity moves from a manual `node -e` check to an automated test (D8). The admin UI contract fixes table, form, and empty-state patterns so later phases inherit RTL-correct building blocks rather than reinventing them |
| **II. Security by Default** | PASS — strengthened | D1 removes the staleness window entirely rather than bounding it. D4 makes state-changing audit writes transactional with the action they record. D6 extends the no-enumeration guarantee to cover lockout. **The Phase 0 audit deviation is closed, not carried forward** |
| **III. Layered Architecture** | PASS | `requirePermission` middleware resolves nothing itself — it delegates the decision to `authorization.service`. Only services touch models, as in Phase 0. The admin UI reaches the backend solely through `frontend/src/services/` |
| **IV. Accessibility** | PASS | The admin-ui contract fixes keyboard and announcement behaviour for tables, forms, and validation errors, verified per-screen in quickstart V-series checks |
| **V. Phase-Gated Delivery** | PASS | Artifacts complete; ready for `/speckit-tasks` |
| **Technology Standards** | PASS | Vitest, supertest, `@vue/test-utils`, and `happy-dom` are additions, not substitutions. Recorded as a non-violation below |
| **Traceability** | PASS | quickstart.md maps both Definition-of-done clauses to concrete validation steps |

**Outcome: gate passes with no violations.** Complexity Tracking below records decisions that
warrant justification even though none is a gate failure.

## Project Structure

### Documentation (this feature)

```text
specs/002-phase-1-security-administration/
├── plan.md                    # This file
├── spec.md                    # Feature specification (+ Clarifications: MFA, custom roles)
├── research.md                # Phase 0 output — 14 decisions
├── data-model.md              # Phase 1 output — 4 new tables, users columns, permission catalog
├── quickstart.md              # Phase 1 output — validation procedure
├── contracts/                 # Phase 1 output
│   ├── admin-api.md           #   user, role, permission, and audit endpoints
│   ├── authorization.md       #   the enforcement contract every later phase inherits
│   └── admin-ui.md            #   admin shell, table/form/empty-state patterns
├── checklists/
│   └── requirements.md        # Spec quality checklist (16/16)
└── tasks.md                   # Phase 2 — created by /speckit-tasks, NOT by this command
```

### Source Code (repository root)

Additions to the Phase 0 tree. Unchanged Phase 0 files are omitted.

```text
crm-project/
├── package.json                          # + test scripts
├── vitest.config.ts                      # NEW — workspace projects config
├── .env.example                          # + auth policy variables
├── .github/workflows/ci.yml              # + test step (Phase 0 had none to run)
│
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   └── env.ts                    # + password policy and lockout variables
│   │   ├── auth/
│   │   │   └── permissions.ts            # NEW — the permission catalog, single source of truth
│   │   ├── routes/
│   │   │   ├── index.ts                  # + admin routers
│   │   │   └── admin/
│   │   │       ├── users.routes.ts       # NEW
│   │   │       ├── roles.routes.ts       # NEW
│   │   │       └── audit.routes.ts       # NEW
│   │   ├── controllers/
│   │   │   ├── auth.controller.ts        # + change-password; me returns role+permissions
│   │   │   └── admin/
│   │   │       ├── users.controller.ts   # NEW
│   │   │       ├── roles.controller.ts   # NEW
│   │   │       └── audit.controller.ts   # NEW
│   │   ├── services/
│   │   │   ├── auth.service.ts           # + lockout, password policy, history
│   │   │   ├── authorization.service.ts  # NEW — the only place a permission decision is made
│   │   │   ├── audit.service.ts          # NEW — append-only writer + reader
│   │   │   ├── user.service.ts           # NEW
│   │   │   ├── role.service.ts           # NEW
│   │   │   └── password.service.ts       # NEW — policy, hashing, history
│   │   ├── models/
│   │   │   ├── user.model.ts             # + role, active, lockout, must-change columns
│   │   │   ├── role.model.ts             # NEW
│   │   │   ├── role-permission.model.ts  # NEW
│   │   │   ├── audit-log.model.ts        # NEW
│   │   │   └── password-history.model.ts # NEW
│   │   ├── middleware/
│   │   │   ├── authenticate.ts           # + loads current user state per request
│   │   │   ├── require-permission.ts     # NEW — delegates to authorization.service
│   │   │   └── require-password-change.ts# NEW — gates the forced-change state
│   │   └── db/
│   │       ├── migrations/               # NEW — roles, permissions, audit, history, users columns
│   │       └── seeders/                  # NEW — three roles, default grants, admin migration
│   └── tests/                            # NEW
│       ├── helpers/
│       ├── auth/
│       ├── admin/
│       └── authorization.matrix.test.ts  # generated role × action matrix (SC-003)
│
└── frontend/
    ├── src/
    │   ├── router/index.ts               # + /admin routes with a permission guard
    │   ├── stores/
    │   │   ├── auth.store.ts             # + role and permission set
    │   │   └── admin-users.store.ts      # NEW
    │   ├── services/
    │   │   ├── admin-users.service.ts    # NEW
    │   │   ├── admin-roles.service.ts    # NEW
    │   │   └── admin-audit.service.ts    # NEW
    │   ├── composables/
    │   │   └── usePermissions.ts         # NEW — `can()` for hiding controls
    │   ├── layouts/
    │   │   └── AdminLayout.vue           # NEW
    │   ├── components/admin/             # NEW — DataTable, Pagination, FormField, EmptyState
    │   ├── views/
    │   │   ├── ChangePasswordView.vue    # NEW
    │   │   └── admin/                    # NEW — Users, UserForm, Roles, AuditLog, Config
    │   └── locales/{ar,en}.json          # + ~120 keys each, identical sets
    └── tests/                            # NEW — component and store tests
```

**Structure Decision**: Extend the Phase 0 workspaces rather than introduce new ones. Admin backend
code is grouped in `routes/admin/` and `controllers/admin/` subdirectories because this phase adds
enough endpoints that a flat directory would obscure the layering the constitution asks reviewers to
verify at a glance; services stay flat since they are addressed by domain, not by URL shape. The
permission catalog lives at `backend/src/auth/permissions.ts` — deliberately outside `services/`,
because it is a declaration every layer reads rather than logic any layer executes (research.md D2).

## Complexity Tracking

> No Constitution Check gate failed. These are decisions whose cost is real enough to record, so a
> later reviewer sees the reasoning rather than rediscovering the trade-off.

| Decision | Why Needed | Simpler Alternative Rejected Because |
| --- | --- | --- |
| **Authorization state read from the database on every protected request** (research.md D1) | FR-016 forbids deciding from token claims alone; FR-007 and FR-017 cap staleness at 60 seconds. A per-request read makes staleness zero and makes deactivation immediate | *Role and permission claims in the access token*: the Phase 0 token lives 15 minutes, so a deactivated user keeps working for up to 15 minutes — a direct FR-007 failure. Shortening the token to 60 seconds would multiply refresh traffic roughly fifteenfold to buy a bound that is still weaker than zero. *A cache with TTL*: adds an invalidation problem to save one indexed primary-key lookup on a system with no measured load — the constitution's YAGNI rule rejects it until profiling justifies it |
| **A locked account returns the same response as an unknown account** (research.md D6) | FR-030 requires them indistinguishable, extending the no-enumeration guarantee Phase 0 established. Telling an anonymous caller "this account is locked" confirms the account exists, which is the exact leak lockout is meant to close | *Return a distinct "account locked" message*: friendlier, and what many products do, but it turns the login form into an account-existence oracle. **Accepted cost, recorded honestly**: a legitimate locked-out user cannot self-diagnose and must contact an Administrator or wait out the period. If this proves painful in practice the correct fix is notifying the account owner out of band once email exists in Phase 5 — not weakening the response |
| **Audit writes for state changes share the action's transaction** (research.md D4) | FR-041 forbids silently discarding an audit entry. Sharing a transaction makes "the action happened but was not recorded" unrepresentable for every state change | *Best-effort logging after the fact*: simpler, but produces exactly the silent gap FR-041 prohibits. **Residual limitation, recorded**: login-path events (successful sign-in, failed sign-in, lockout) cannot be made transactional — a failed sign-in cannot be un-failed if its audit write fails. Those paths log at `error` level and surface loudly instead, which is the honest ceiling rather than a pretence of a guarantee |
| **Permission catalog declared in code, grants stored as data** (research.md D2) | Later phases add modules by adding code. A catalog in code means adding a module is a code change, while granting it stays an Administrator action | *A `permissions` table*: every new module in Phases 2–12 would need a migration plus a seeder, and the DB rows could silently drift from what the code actually checks. *Permissions as a JSON column on roles*: no referential integrity and no way to query "which roles grant this" |

### Non-violations worth recording

- **Vitest, supertest, `@vue/test-utils`, and `happy-dom` are additions, not stack deviations.** The
  constitution's Technology Standards table fixes frontend, backend, ORM, database, auth, and i18n
  but is silent on testing — the same gap Phase 0 found for the backend language and resolved in
  research rather than by amendment. No listed technology is substituted, so no amendment is
  required. Phase 0's decision to ship without tests was explicitly a *this phase* decision, and its
  plan recommended standing the harness up here.
- **The `must_change_password` gate is enforced in middleware.** Middleware sits outside the
  `routes → controllers → services → models` chain, but so does Phase 0's `authenticate`. The
  middleware makes no decision of its own: it reads state the authenticate step already loaded and
  refuses or forwards. The same holds for `requirePermission`, which delegates every decision to
  `authorization.service`.
- **Phase 0's expectation that tokens would gain role claims is deliberately not honoured.**
  `data-model.md` in Phase 0 stated that access tokens carry "no role or permission claims — those
  arrive in Phase 1." This plan keeps the token claim-free for authorization purposes, because
  FR-016 (written from Constitution Principle II) makes claim-based authorization the wrong answer.
  This is a considered reversal of a prior phase's expectation, not an oversight; it is recorded
  here so a reader of the Phase 0 artifacts is not misled.
- **CI gains a test stage.** Phase 0's FR-016 forbade blocking CI on a test stage that did not
  exist. One exists now, so the prohibition no longer applies and `npm test` joins lint and build.

## Outstanding from Phase 0

Not blockers for this phase, but they remain open and are recorded so they are not lost:

- **V8–V10** (language switch, no-flash reload, keyboard operation) were never confirmed in a
  browser. This phase's screens depend on that shell being correct, and its own accessibility checks
  will exercise the same machinery.
- **V13** (CI reports pass/fail) was blocked on there being no git remote. A remote now exists, the
  Phase 0 branch is pushed, and it has been merged through a pull request — so the workflow has had
  the opportunity to run and the result simply needs confirming. This phase adds a test stage to the
  same workflow, which makes confirming it more valuable than before.
- **Phase 0 is merged.** `origin/main` is at `b864d17` (PR #1). This branch was cut from
  `001-phase-0-foundation` at `7dd51a3`, which is exactly what was merged, so there is no content
  divergence between this branch's base and `main` — Phase 1 targets `main` cleanly.
