# Phase 0 Research: Project Foundation

**Feature**: `001-phase-0-foundation` | **Date**: 2026-08-25

This document resolves every `NEEDS CLARIFICATION` raised in the plan's Technical Context.
Decisions here are binding for the implementation phase.

## Observed starting state

Recorded because it materially changes the task list:

| Observation                                                                                    | Implication                                                            |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Frontend exists at `frontend/crm-frontend/`, nested one level deeper than FR-001's `/frontend` | Requires a move, not a fresh scaffold                                  |
| Frontend `package.json` has only `vue` as a dependency                                         | Tailwind, Pinia, vue-router, vue-i18n are all absent and must be added |
| Existing frontend is the stock Vite template (`App.vue`, `HelloWorld.vue`, `style.css`)        | Template placeholder content must be replaced by the app shell         |
| No `backend/` directory exists                                                                 | Backend is a greenfield build                                          |
| Git repo on `main`, **zero commits, no remote**                                                | CI workflow can be written but cannot execute until a remote exists    |
| `mysql` client not installed; Docker 29.6.2 present                                            | Local MySQL must be containerised                                      |
| Node v22.17.1, npm 10.9.2                                                                      | npm workspaces available (npm 7+); Node 22 LTS is the baseline         |
| No root `.gitignore`                                                                           | Needed before first commit to avoid committing `node_modules` / `.env` |

---

## D1. Monorepo layout and workspace tooling

**Decision**: Flatten `frontend/crm-frontend/` to `frontend/`, and adopt **npm workspaces**
declared in a new root `package.json` with workspaces `["frontend", "backend"]`.

**Rationale**: FR-001 requires "clearly separated frontend and backend workspaces sharing a
common environment configuration convention at the root". A `frontend/crm-frontend` +
`backend` pairing is asymmetric and would make workspace globs and CI paths awkward for
twelve phases. npm workspaces ship with the installed npm 10.9.2, need no extra tooling, and
give a single root `npm install` — directly serving SC-001 (under 10 minutes from clean clone).

**Alternatives considered**:

- _pnpm / Yarn workspaces_: better hoisting and speed, but adds a toolchain install step that
  works against SC-001 and is not mandated by the constitution.
- _Turborepo / Nx_: build orchestration and caching are valuable at scale, but this phase has
  two packages and no shared library. Rejected as speculative per the constitution's YAGNI rule.
- _Keep `frontend/crm-frontend` and add `backend/`_: avoids a move, but leaves a permanently
  inconsistent tree that every later phase and CI path must special-case.

**Note**: The move must preserve the existing `.gitignore`, `tsconfig*.json`, and
`vite.config.ts`. Since nothing is committed yet, the move is low-risk, but `node_modules`
should be deleted and reinstalled at the new location rather than moved.

---

## D2. Backend language: TypeScript or JavaScript

**Decision**: **TypeScript in strict mode**, matching the frontend.

**Rationale**: The constitution's Technology Standards table fixes the frontend as
"TypeScript (strict mode)" but is silent on the backend language — a genuine gap. Choosing TS
keeps one language and one type discipline across the monorepo, lets request/response shapes
be shared conceptually with the frontend, and makes the layered structure of Principle III
enforceable at compile time (a controller cannot accidentally receive a model instance).

**Alternatives considered**:

- _Plain JavaScript_: faster to start, no build step. Rejected because Phases 1–12 add RBAC,
  SLA rules, and integrations where type errors are expensive, and retrofitting TS across a
  grown codebase is far costlier than starting with it.

**Toolchain**: `tsx` for dev (fast, no separate watch build), `tsc` for production build.

---

## D3. Local MySQL provisioning

**Decision**: **Docker Compose** service (`mysql:8.4`) with a named volume, plus a healthcheck
so dependent startup is deterministic.

**Rationale**: The `mysql` CLI is not installed on this machine, but Docker 29.6.2 is. A
committed `docker-compose.yml` makes the database a one-command dependency
(`docker compose up -d`), which is the single biggest lever on SC-001. It also pins the MySQL
version so all developers and CI share one engine version.

**Alternatives considered**:

- _Developer-installed MySQL_: no container overhead, but every developer's setup diverges and
  SC-001's 10-minute target becomes unrealistic on a clean machine.
- _SQLite for local, MySQL in production_: fastest local start, but Sequelize dialect
  differences (enums, JSON columns, FK behaviour) would let bugs hide until deployment. Rejected
  as violating the spirit of a foundation phase.

---

## D4. Password hashing

**Decision**: **bcrypt** via the `bcrypt` package, cost factor 12.

**Rationale**: Constitution Principle II explicitly permits "bcrypt or Argon2". bcrypt has the
simpler native-install story on Windows (the current dev platform) and cost 12 is the current
mainstream default. Only the seeded test user is hashed in this phase, but the helper written
here is what Phase 1 will reuse for real user creation.

**Alternatives considered**:

- _Argon2id_: stronger memory-hard guarantees and generally the modern preference. Rejected only
  on native-build friction for Windows contributors; revisit in Phase 1 if the team standardises
  on Linux/WSL. Noted as a deliberate, revisitable choice rather than a permanent one.

---

## D5. Token format, lifetimes, and transport

**Decision**: JWT (HS256) via `jsonwebtoken`. Access token 15 minutes, refresh token 7 days
(fixed by the clarify session). **Access token returned in the JSON response body and held in
memory only; refresh token set as an `httpOnly`, `SameSite=Strict`, `Secure`-in-production
cookie.** Separate signing secrets for the two token types.

**Rationale**: Constitution Principle II makes security structural, and token transport is the
single hardest thing to retrofit — it touches the frontend service layer, CORS configuration,
and every protected route. Keeping the access token out of `localStorage` removes the standard
XSS token-theft path, and an `httpOnly` refresh cookie cannot be read by injected script at all.
Distinct secrets mean an access token can never be replayed as a refresh token, which is exactly
the token-type-confusion edge case the spec calls out.

**Alternatives considered**:

- _Both tokens in `localStorage`_: simplest to implement and debug; any XSS yields a 7-day
  refresh token. Rejected under Principle II.
- _Both in `httpOnly` cookies_: strongest against XSS, but makes every API call cookie-authenticated
  and pulls full CSRF defence into Phase 0. Rejected as disproportionate for this phase.
- _Opaque tokens with a server-side session table_: enables instant revocation, but requires a
  sessions table that FR-006b forbids in this phase. Deferred to Phase 1 alongside real revocation.

**Consequence to implement**: because the refresh cookie is cross-origin in development
(`localhost:5173` → `localhost:3000`), CORS must set an explicit origin (never `*`) and
`credentials: true`, and the frontend must send `credentials: 'include'` on refresh calls.

---

## D6. Frontend token handling and refresh interception

**Decision**: Access token lives in a non-persisted Pinia store. A single wrapper around `fetch`
in `src/services/http.ts` is the only module that touches tokens; on a 401 due to expiry it calls
the refresh endpoint once, updates the store, and retries the original request. Concurrent 401s
share one in-flight refresh promise.

**Rationale**: FR-015 makes the service layer the exclusive backend-communication boundary and
FR-019 forbids components from implementing refresh logic. Sharing one in-flight refresh promise
prevents the classic bug where several parallel requests each trigger their own refresh and
invalidate one another.

**Alternatives considered**:

- _axios with interceptors_: ergonomic and battle-tested, but adds a dependency for behaviour the
  native `fetch` API covers in this phase. Revisit if request/response transformation needs grow.
- _Refresh on a timer before expiry_: avoids user-visible 401s, but silently keeps sessions alive
  for idle users and still needs 401 handling as a fallback. Rejected as more logic for less
  certainty.

---

## D7. Structured request logging

**Decision**: `pino` with `pino-http`, emitting JSON. `pino-pretty` in development only.

**Rationale**: FR-008 requires method, path, status code, and response time — all of which
`pino-http` logs by default. JSON output means Phase 10's reporting and any future log
aggregation can consume it without a parser rewrite. This also resolves the observability item
the clarify session deferred to plan time.

**Alternatives considered**:

- _morgan_: the conventional Express logger, but line-oriented text that needs re-parsing later.
- _console.log_: no. Fails structured-logging expectations immediately.

**Requirement**: request logs MUST redact `password`, `authorization`, and `cookie` fields so
credentials never reach log storage.

---

## D8. Environment variable validation

**Decision**: A `zod` schema in `backend/src/config/env.ts`, parsed once at startup; process
exits with the list of missing/invalid variables on failure. A committed root `.env.example`
documents every variable.

**Rationale**: FR-017 requires refusing to start and reporting which variables are absent.
Parsing once into a typed, frozen config object also means no `process.env` access is scattered
through the codebase, which keeps Principle III's layering honest.

**Alternatives considered**:

- _envalid_: purpose-built and slightly terser, but `zod` is likely wanted anyway for request
  validation in Phase 1+, so one dependency covers both.
- _Manual `if (!process.env.X) throw`_: no dependency, but grows unmaintainable and gives poor
  aggregate error messages.

---

## D9. Migrations and seeding

**Decision**: `sequelize-cli` with migration and seeder files authored as **CommonJS `.cjs`**,
while application code stays TypeScript ESM. Config supplied via `.sequelizerc` pointing at
`backend/src/db/`.

**Rationale**: `sequelize-cli` executes migrations in its own runtime and has long-standing
friction with TS ESM. Keeping the handful of migration files as `.cjs` is the well-trodden path
and avoids a loader hack in the foundation phase. Migrations are declarative schema steps, so
losing type-checking there costs little.

**Alternatives considered**:

- _Umzug directly with TS migrations_: fully typed and ESM-native, but hand-rolled CLI plumbing
  for what `sequelize-cli` already does.
- _`sequelize.sync()`_: trivially easy, but no migration history — unacceptable when Phases 1–12
  each evolve the schema.

---

## D10. Tailwind CSS version and RTL strategy

**Decision**: **Tailwind CSS v4** via the `@tailwindcss/vite` plugin. Use logical properties
(`ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start`, `text-end`) rather than physical
(`ml-*`, `pl-*`, `text-left`) so direction follows the root `dir` attribute automatically.

**Rationale**: Constitution Principle I forbids per-component direction hacks and mandates
root-level RTL. Tailwind v4 has first-class logical-property utilities, so setting `dir="rtl"`
on `<html>` flips the whole layout with no duplicated RTL stylesheet. The Vite plugin also
removes the PostCSS config file that v3 required, and v4 suits the installed Vite 8.

**Alternatives considered**:

- _Tailwind v3 + PostCSS + `tailwindcss-rtl` plugin_: proven, but an extra plugin and config file
  to achieve what v4 does natively.
- _Physical utilities plus an RTL stylesheet override_: exactly the per-component hack Principle I
  prohibits.

**Follow-on rule for later phases**: a lint or review check should reject physical-direction
utilities, since a single `ml-4` silently breaks Arabic layout.

---

## D11. i18n library and persistence

**Decision**: `vue-i18n` v11 in Composition API mode, with `ar` and `en` message files under
`frontend/src/locales/`. Selection persisted in `localStorage` under `crm.locale`, read
synchronously before mount so the correct `lang`/`dir` are applied on first paint. Fallback
locale `en`.

**Rationale**: FR-012 requires persistence across reloads and FR-022 requires correct `lang`/`dir`
on load. Reading `localStorage` before app mount avoids a visible flash of the wrong direction.
`en` fallback satisfies User Story 3's corrupted-locale-file scenario.

**Alternatives considered**:

- _Locale in the URL path (`/ar/...`, `/en/...`)_: better for SEO and shareable links, and worth
  revisiting for the Phase 8 public portal. Rejected now because it couples routing to i18n
  before any real routes exist.
- _Locale in a cookie_: needed only if the server rendered markup, which it does not here.

---

## D12. CI provider and the no-remote constraint

**Decision**: **GitHub Actions** at `.github/workflows/ci.yml`, running on `push` and
`pull_request`: `npm ci` at the root, then `npm run lint` and `npm run build` across both
workspaces. No test stage (FR-016).

**Rationale**: GitHub Actions needs no infrastructure and is the default for a repo of this shape.
Root `npm ci` exercises the workspace wiring, so a broken workspace fails CI immediately.

**Blocking constraint**: the repository has **no commits and no remote**. The workflow file can be
authored now, but SC-005 (a result within 5 minutes of a push) is unverifiable until someone
creates a remote and pushes. This must surface as an explicit task and be flagged to the user
rather than silently assumed.

---

## D13. Linting and formatting

**Decision**: ESLint 9 flat config with `typescript-eslint` and `eslint-plugin-vue`, plus
Prettier for formatting, wired as root `npm run lint` / `npm run format` scripts spanning both
workspaces.

**Rationale**: The constitution's Open Items place "Code style conventions (ESLint/Prettier
config)" in the Phase 0 CI pipeline, and the clarify session confirmed lint stays in scope even
though tests do not.

**Alternatives considered**:

- _Biome_: much faster and single-tool, but `eslint-plugin-vue` has no equivalent yet for
  Vue SFC template linting.
- _Lint in a pre-commit hook only_: easy to bypass locally; CI enforcement is what the
  constitution asks for.

---

## Resolved-unknowns summary

| Technical Context item   | Resolution                                                       |
| ------------------------ | ---------------------------------------------------------------- |
| Backend language/version | TypeScript strict on Node 22 LTS (D2)                            |
| Monorepo tooling         | npm workspaces; flatten to `frontend/` + `backend/` (D1)         |
| Storage provisioning     | Dockerised MySQL 8.4 (D3)                                        |
| Password hashing         | bcrypt cost 12 (D4)                                              |
| Token format & transport | JWT HS256; access in memory, refresh in httpOnly cookie (D5, D6) |
| Logging                  | pino + pino-http, JSON, credential redaction (D7)                |
| Env validation           | zod schema, fail-fast at startup (D8)                            |
| Migration tooling        | sequelize-cli with `.cjs` migrations (D9)                        |
| Styling & RTL            | Tailwind v4, logical properties only (D10)                       |
| i18n                     | vue-i18n v11, `localStorage` persistence, `en` fallback (D11)    |
| CI                       | GitHub Actions; **blocked on remote creation** (D12)             |
| Lint/format              | ESLint 9 flat config + Prettier (D13)                            |
| Testing                  | Out of scope this phase, per clarify decision                    |
