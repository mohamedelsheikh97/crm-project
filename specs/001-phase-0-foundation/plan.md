# Implementation Plan: Phase 0 — Project Foundation

**Branch**: `001-phase-0-foundation` | **Date**: 2026-08-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-phase-0-foundation/spec.md`

## Summary

Stand up the bootable CRM-Support foundation: an npm-workspaces monorepo with a Vue 3 frontend
and an Express + Sequelize backend, JWT authentication (15-minute access token plus 7-day refresh
token), a minimal `users` table with a seeded test account, and Arabic/English i18n with
root-level RTL. No business features.

The existing `frontend/crm-frontend/` scaffold is a bare Vite template — it has `vue` and nothing
else. Tailwind, Pinia, vue-router, and vue-i18n are all absent despite being constitution-mandated,
and there is no backend at all. So this phase is mostly greenfield with one relocation: flatten
`frontend/crm-frontend/` to `frontend/` so the workspace layout is symmetric with `backend/`.

Technical approach follows [research.md](./research.md): TypeScript on both sides, Dockerised
MySQL 8.4 (no local `mysql` client is installed), access token held in memory with the refresh
token in an `httpOnly` cookie, pino JSON logging, and Tailwind v4 logical properties so a single
stylesheet serves both text directions.

## Technical Context

**Language/Version**: TypeScript 5.x strict on Node.js 22.17.1 LTS, both workspaces (research.md D2)

**Primary Dependencies**:
- Backend — Express 5, Sequelize 6 + `mysql2`, `jsonwebtoken`, `bcrypt`, `zod`, `pino` + `pino-http`, `cookie-parser`, `cors`
- Frontend — Vue 3.5, Vite 8, Pinia, vue-router 4, vue-i18n 11, Tailwind CSS v4 via `@tailwindcss/vite`
- Tooling — `sequelize-cli`, `tsx`, ESLint 9 flat config + `typescript-eslint` + `eslint-plugin-vue`, Prettier

**Storage**: MySQL 8.4 in Docker Compose with a named volume and healthcheck (research.md D3). One
table this phase: `users` (research.md D9, [data-model.md](./data-model.md))

**Testing**: None. Automated test tooling is explicitly out of scope by user decision recorded in
the spec's Clarifications (Q2); FR-016 forbids blocking CI on a test stage that does not exist.
Validation is the manual V1–V13 procedure in [quickstart.md](./quickstart.md)

**Target Platform**: Linux/Windows server for the backend; evergreen browsers for the frontend.
Development is on Windows 11 with Docker available

**Project Type**: Web application — separate frontend and backend workspaces in one monorepo

**Performance Goals**: Language switch visible within 1s (SC-003); CI result within 5 min of push
(SC-005); clean-clone to running in under 10 min (SC-001). No throughput target — this phase has
no business load

**Constraints**:
- Access token 15 min, refresh token 7 days, absolute not sliding (spec Clarifications Q1)
- Routes unversioned under `/api/` until Phase 11 (FR-020)
- No roles, permissions, lockout, or audit tables (FR-006b)
- Credentialed CORS forbids a wildcard origin, so `CORS_ORIGIN` must be explicit
- **Repository has no commits and no remote**, so SC-005 is unverifiable until one exists (research.md D12)

**Scale/Scope**: ~6 backend endpoints (5 auth + health), 1 table, 2 locales, 2 routes, 1 seeded
user. Foundation for the 12 phases in PLAN.md

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against constitution **v1.1.0**.

### Initial evaluation (pre-research)

| Gate | Status | Evidence |
|---|---|---|
| **I. Bilingual-First & RTL** (NON-NEGOTIABLE) | PASS | FR-010–FR-012, FR-022; ar/en locale files with identical key sets; root-level `dir`, no per-component flipping |
| **II. Security by Default** (NON-NEGOTIABLE) | **PARTIAL** — see Complexity Tracking | Server-side token verification (FR-003), bcrypt hashing, no enumeration on login. **Audit logging is absent** |
| **III. Layered Architecture** (NON-NEGOTIABLE) | PASS | FR-004 routes→controllers→services→models; FR-015 service-layer-only API access; Composition API throughout |
| **IV. Accessibility** | PASS (scoped) | FR-022–FR-024 structural baseline; full WCAG 2.1 AA audit deferred to phases with real screens |
| **V. Phase-Gated Delivery** | PASS | specify → clarify → plan executed in order; this gate is the constitution review |
| **Technology Standards** (fixed stack) | PASS | Stack matches the constitution table exactly; backend language gap resolved as TypeScript (research.md D2) |
| **Traceability to PLAN.md** | PASS | Spec maps every FR to a Phase 0 Scope bullet; the "empty baseline" deviation is documented |

One gate is PARTIAL and is justified in Complexity Tracking below. No gate fails outright, so
research proceeded.

### Post-design re-evaluation

Re-checked after [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/](./contracts/), and [quickstart.md](./quickstart.md) were produced.

| Gate | Status | What the design added |
|---|---|---|
| **I. Bilingual-First & RTL** | PASS — strengthened | D10 mandates logical-property utilities only, with a table of banned physical utilities; D11 reads locale synchronously pre-mount so RTL users see no LTR flash |
| **II. Security by Default** | **PARTIAL** — unchanged, justified | D5 hardened the design: two distinct signing secrets plus a `type` claim make token-type confusion cryptographically impossible; refresh token is `httpOnly`/`SameSite=Strict`; startup rejects equal secrets and wildcard CORS; logs redact credentials. Audit logging still deferred |
| **III. Layered Architecture** | PASS — strengthened | Contracts state that only services touch models and no component calls `fetch`; V12 makes both reviewable |
| **IV. Accessibility** | PASS (scoped) | frontend-shell.md fixes landmark structure, a real `<button>` toggle, and focus indicators verified in both directions (V10) |
| **V. Phase-Gated Delivery** | PASS | Artifacts complete; ready for `/speckit-tasks` |
| **Technology Standards** | PASS | No deviation from the fixed stack; every addition is an unspecified detail resolved, not a substitution |
| **Traceability** | PASS | quickstart.md maps all three Definition-of-done clauses to concrete validation steps |

**Outcome: gate passes** with one documented, time-boxed deviation.

## Project Structure

### Documentation (this feature)

```text
specs/001-phase-0-foundation/
├── plan.md                    # This file
├── spec.md                    # Feature specification (+ Clarifications session)
├── research.md                # Phase 0 output — 13 decisions, all unknowns resolved
├── data-model.md              # Phase 1 output — users table, tokens, config, locales
├── quickstart.md              # Phase 1 output — V1–V13 validation procedure
├── contracts/                 # Phase 1 output
│   ├── auth-api.md            #   5 endpoints + error envelope
│   └── frontend-shell.md      #   root/layout/styling/service-layer contracts
├── checklists/
│   └── requirements.md        # Spec quality checklist (13/16, 3 accepted exceptions)
└── tasks.md                   # Phase 2 — created by /speckit-tasks, NOT by this command
```

### Source Code (repository root)

```text
crm-project/
├── package.json                     # NEW — npm workspaces root, dev/build/lint/db scripts
├── docker-compose.yml               # NEW — MySQL 8.4 + volume + healthcheck
├── .env.example                     # NEW — documents every required variable
├── .gitignore                       # NEW — root; no root .gitignore exists today
├── eslint.config.js                 # NEW — ESLint 9 flat config spanning both workspaces
├── .prettierrc                      # NEW
├── .github/workflows/ci.yml          # NEW — install + lint + build (no test stage)
│
├── backend/                         # NEW — entire workspace
│   ├── package.json
│   ├── tsconfig.json
│   ├── .sequelizerc
│   └── src/
│       ├── server.ts                # listen; startup validation and fail-fast
│       ├── app.ts                   # Express wiring, middleware order
│       ├── config/
│       │   ├── env.ts               # zod schema; rejects equal secrets and wildcard CORS
│       │   └── database.ts          # Sequelize instance + connection check
│       ├── routes/                  # delegate only — no business logic
│       │   ├── index.ts
│       │   ├── auth.routes.ts
│       │   └── health.routes.ts
│       ├── controllers/             # HTTP in/out only
│       │   ├── auth.controller.ts
│       │   └── health.controller.ts
│       ├── services/                # ALL business logic; only layer touching models
│       │   ├── auth.service.ts
│       │   └── token.service.ts
│       ├── models/                  # schema definition only
│       │   ├── index.ts
│       │   └── user.model.ts
│       ├── middleware/
│       │   ├── authenticate.ts      # access-token verification
│       │   ├── error-handler.ts     # centralised envelope; never leaks stack traces
│       │   └── request-logger.ts    # pino-http with redaction
│       └── db/
│           ├── migrations/          # .cjs — 001-create-users
│           └── seeders/             # .cjs — idempotent admin@crm.local
│
└── frontend/                        # MOVED from frontend/crm-frontend/, then extended
    ├── package.json                 # + pinia, vue-router, vue-i18n, tailwind
    ├── vite.config.ts               # + @tailwindcss/vite
    ├── index.html                   # lang/dir set before paint
    └── src/
        ├── main.ts                  # install router, pinia, i18n; apply locale pre-mount
        ├── App.vue                  # renders the layout shell
        ├── layouts/
        │   └── DefaultLayout.vue    # header/nav/main landmarks
        ├── router/index.ts          # history mode; home + 404
        ├── stores/
        │   ├── auth.store.ts        # access token IN MEMORY — never persisted
        │   └── locale.store.ts      # persists only the locale code
        ├── services/
        │   ├── http.ts              # single-flight refresh + retry; only token consumer
        │   └── auth.service.ts
        ├── composables/
        │   └── useDirection.ts      # keeps <html> lang/dir in sync
        ├── locales/{ar,en}.json     # identical key sets
        ├── components/
        │   └── LanguageToggle.vue   # real <button>, keyboard operable
        └── views/{HomeView,NotFoundView}.vue
```

**Structure Decision**: npm workspaces with `frontend/` and `backend/` as siblings
(research.md D1). The existing `frontend/crm-frontend/` is flattened to `frontend/` so FR-001's
"clearly separated frontend and backend workspaces" is literally true and CI paths stay simple for
twelve phases. `node_modules` is reinstalled at the new location rather than moved. Backend layering
mirrors Constitution Principle III one-to-one, so a violation is visible from the directory tree
alone. Nothing is committed yet, so the move carries no history-rewrite risk.

## Complexity Tracking

> Filled because the Constitution Check has one PARTIAL gate requiring justification.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **Principle II: no audit logging of login events.** The principle requires audit logging of "logins, failed login attempts, permission changes, data exports, deletions". Phase 0 authenticates users but persists no audit record | PLAN.md places the audit log in **Phase 1** scope, and FR-006b explicitly forbids creating an audit-log table in Phase 0. Building one now would contradict both the phase boundary and the spec just clarified. Partial mitigation is real: pino logs every login attempt with method, path, status, and timing (FR-008), so the events are observable in logs — they are simply not durable, queryable records | *Add an `audit_logs` table now*: violates FR-006b and pre-empts a Phase 1 design that must cover permission changes, exports, and deletions — building it against only login events risks a schema that Phase 1 discards. *Skip audit entirely until later*: worse, since request logs give no coverage at all. **Time-boxed: this deviation MUST close in Phase 1, and Phase 1's spec MUST treat the audit log as a first-class deliverable rather than inheriting it as assumed-done** |
| **Two JWT signing secrets instead of one** | One secret with only a `type` claim separating token kinds means a bug in claim-checking silently promotes a refresh token to an access token. Distinct secrets make that failure cryptographically impossible rather than merely checked | *Single secret + `type` claim*: relies on every verification path checking the claim correctly, forever. The extra cost here is one environment variable, which is trivial against the class of vulnerability it removes |

### Non-violations worth recording

- **No test framework** is a user decision (spec Clarifications Q2), and the constitution contains
  no testing principle, so this is not a gate violation. It is a real risk: Phase 1 delivers RBAC
  and audit logging, where the constitution demands provably correct server-side enforcement.
  Recommend standing up the harness at the start of Phase 1.
- **Unversioned `/api/`** is a user decision (Clarifications Q3) and no principle mandates
  versioning before Phase 11. FR-021's single configurable base path is the mitigation.
- **Accessibility scoped to a structural baseline** conforms to Principle IV for a phase with no
  feature screens; full WCAG auditing needs screens to audit.
