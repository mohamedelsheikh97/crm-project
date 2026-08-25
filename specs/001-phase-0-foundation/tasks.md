---
description: 'Task list for Phase 0 — Project Foundation'
---

# Tasks: Phase 0 — Project Foundation

**Input**: Design documents from `/specs/001-phase-0-foundation/`

**PLAN.md Reference**: Phase 0 — Project Foundation

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Branch**: `001-phase-0-foundation` (already created, based on `main` @ `ef44685`)

**Tests**: **NONE.** No automated test framework is installed in this phase. This is a recorded user
decision (spec Clarifications Q2) and FR-016 forbids blocking CI on a test stage that does not
exist. Do **not** add Vitest, Jest, Supertest, Playwright, or any test runner. Validation is the
manual V1–V13 procedure in [quickstart.md](./quickstart.md).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: `[US1]`–`[US4]`, mapping to the user stories in spec.md
- Every task states its exact file path

---

## READ THIS FIRST — Non-negotiable rules for the implementing model

These are the failure modes most likely to sink this phase. Violating any of them means the task is
not done, even if the code runs.

1. **ESM import extensions.** `backend/package.json` sets `"type": "module"` and `tsconfig.json`
   uses `"module": "NodeNext"`. Every **relative** import in backend TypeScript MUST carry a `.js`
   extension even though the source file is `.ts`:
   `import { env } from './config/env.js'` — **not** `'./config/env'`. Omitting it compiles but
   crashes at runtime with `ERR_MODULE_NOT_FOUND`.
2. **One `.env`, at the repository root.** FR-001 requires a shared root env convention. The backend
   loads `../../../.env` relative to `backend/src/config/`; the frontend gets it via
   `envDir: '..'` in `vite.config.ts`. Do NOT create `backend/.env` or `frontend/.env`.
3. **Logical Tailwind utilities only.** `ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start`, `text-end`,
   `start-*`, `end-*`. **Never** `ml-*`, `mr-*`, `pl-*`, `pr-*`, `text-left`, `text-right`,
   `left-*`, `right-*`. Symmetric utilities (`mx-*`, `px-*`, `mt-*`, `w-*`, `text-center`) are
   fine. One `ml-4` silently breaks Arabic layout — Constitution Principle I treats it as a defect.
4. **Layering is not optional.** `routes → controllers → services → models`. A route handler
   contains no logic beyond calling a controller. A controller touches no Sequelize model. Only
   `backend/src/services/` imports from `backend/src/models/`. On the frontend, no file under
   `components/`, `views/`, or `layouts/` may call `fetch` — all traffic goes through
   `frontend/src/services/`.
5. **`password_hash` never leaves the process.** It is excluded by a Sequelize `defaultScope`.
   Reading it requires the explicit `withPassword` scope, used in exactly one place
   (`auth.service.ts` login).
6. **No hardcoded user-visible strings** in Vue templates or scripts. Every one is an i18n key.
   `ar.json` and `en.json` MUST have identical key sets.
7. **Do not create tables, columns, or endpoints beyond this phase.** FR-006b forbids roles,
   permissions, lockout counters, and audit-log tables. `data-model.md` lists the specific deferred
   columns. Adding them now is out of scope, not helpful foresight.
8. **Commit after each task or logical group.** Work stays on `001-phase-0-foundation`. Do not push
   — no git remote exists.

**Canonical values** (do not invent alternatives):

| Thing               | Value                              |
| ------------------- | ---------------------------------- |
| Backend port        | `3000`                             |
| Frontend dev port   | `5173`                             |
| API prefix          | `/api` — unversioned (FR-020)      |
| Access token TTL    | `900` seconds (15 min)             |
| Refresh token TTL   | `604800` seconds (7 days)          |
| Refresh cookie name | `crm_refresh`                      |
| Refresh cookie path | `/api/auth`                        |
| Locale storage key  | `crm.locale`                       |
| Seed account        | `admin@crm.local` / `ChangeMe123!` |
| bcrypt cost         | `12`                               |
| Database name       | `crm_support`                      |

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Restructure the repo into an npm-workspaces monorepo and make `npm install` work.

- [X] T001 Flatten the frontend workspace: move every file and directory from
      `frontend/crm-frontend/` up one level into `frontend/`, then delete the now-empty
      `frontend/crm-frontend/`. Include the dotfiles — `.gitignore` and `.vscode/`. Do **not** move
      `node_modules` if present; delete it, it will be reinstalled at the root by T009. Use
      `git mv` where possible so git tracks the rename. **Verify**: `ls frontend` shows
      `index.html`, `package.json`, `package-lock.json`, `src/`, `tsconfig.json`,
      `tsconfig.app.json`, `tsconfig.node.json`, `vite.config.ts`, `.gitignore`, `README.md`, and
      `frontend/crm-frontend` no longer exists. Rationale: research.md D1 — FR-001 requires
      `frontend/` and `backend/` as symmetric siblings.

- [X] T002 Delete `frontend/package-lock.json`. A workspace member must not carry its own lockfile;
      the root lockfile created by T009 is authoritative. Leaving it causes npm to resolve two
      dependency trees.

- [X] T003 Create the workspace root `package.json` at repository root with:
      `"name": "crm-support"`, `"private": true`, `"version": "0.1.0"`, `"type": "module"`,
      `"workspaces": ["frontend", "backend"]`, `"engines": { "node": ">=22.0.0" }`, and these
      scripts exactly (`quickstart.md` invokes them by name): - `"dev": "concurrently -n backend,frontend -c blue,green \"npm:dev:backend\" \"npm:dev:frontend\""` - `"dev:backend": "npm run dev --workspace backend"` - `"dev:frontend": "npm run dev --workspace frontend"` - `"build": "npm run build --workspace backend && npm run build --workspace frontend"` - `"lint": "eslint ."` - `"lint:fix": "eslint . --fix"` - `"format": "prettier --write ."` - `"format:check": "prettier --check ."` - `"db:migrate": "npm run db:migrate --workspace backend"` - `"db:migrate:undo": "npm run db:migrate:undo --workspace backend"` - `"db:seed": "npm run db:seed --workspace backend"`

      Root `devDependencies`: `concurrently`, `eslint`, `@eslint/js`, `typescript-eslint`,
                  `eslint-plugin-vue`, `eslint-config-prettier`, `prettier`, `typescript`. Pin to current
                  major versions (ESLint 9.x, Prettier 3.x, TypeScript 5.x).

- [X] T004 [P] Create `.env.example` at repository root documenting **every** variable from
      data-model.md's Application Configuration table, with a comment block at the top explaining
      that `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must be two _different_ random strings of at
      least 32 characters and that startup fails if they are equal or if `CORS_ORIGIN` is `*`.
      Keys, in this order, with the secrets left empty:
      `NODE_ENV=development`, `PORT=3000`, `DB_HOST=127.0.0.1`, `DB_PORT=3306`,
      `DB_NAME=crm_support`, `DB_USER=crm`, `DB_PASSWORD=crm_local_password`,
      `JWT_ACCESS_SECRET=`, `JWT_REFRESH_SECRET=`, `CORS_ORIGIN=http://localhost:5173`,
      `LOG_LEVEL=info`, `VITE_API_BASE_URL=http://localhost:3000/api`.
      This file IS committed. `.env` is NOT — the root `.gitignore` already excludes it.

- [X] T005 [P] Create `docker-compose.yml` at repository root with one `mysql` service on image
      `mysql:8.4`, `restart: unless-stopped`, a named volume `crm-mysql-data` mounted at
      `/var/lib/mysql`, and port mapping `"${DB_PORT}:3306"`. Read credentials from the root `.env`
      (Compose auto-loads it): `MYSQL_DATABASE: ${DB_NAME}`, `MYSQL_USER: ${DB_USER}`,
      `MYSQL_PASSWORD: ${DB_PASSWORD}`, plus a `MYSQL_ROOT_PASSWORD`. Add a healthcheck running
      `mysqladmin ping` with `interval: 5s`, `retries: 20`, `start_period: 30s` — quickstart step 2
      instructs the developer to wait for `healthy`, so the healthcheck must actually exist
      (research.md D3).

- [X] T006 [P] Create `.prettierrc` at repository root (`singleQuote: true`, `semi: true`,
      `printWidth: 100`, `trailingComma: "all"`) and `.prettierignore` excluding `node_modules`,
      `dist`, `package-lock.json`, and `backend/src/db/migrations`.

- [X] T007 Create `backend/package.json`: `"name": "backend"`, `"private": true`, `"version":
"0.1.0"`, **`"type": "module"`**, `"main": "dist/server.js"`. Scripts:
      `"dev": "tsx watch src/server.ts"`, `"build": "tsc -p tsconfig.json"`,
      `"start": "node dist/server.js"`, `"db:migrate": "sequelize-cli db:migrate"`,
      `"db:migrate:undo": "sequelize-cli db:migrate:undo"`,
      `"db:seed": "sequelize-cli db:seed:all"`.
      `dependencies`: `express` (5.x), `sequelize` (6.x), `mysql2`, `jsonwebtoken`, `bcrypt`, `zod`,
      `pino`, `pino-http`, `cookie-parser`, `cors`, `dotenv`.
      `devDependencies`: `@types/express`, `@types/jsonwebtoken`, `@types/bcrypt`,
      `@types/cookie-parser`, `@types/cors`, `@types/node`, `sequelize-cli`, `tsx`, `pino-pretty`,
      `typescript`. Every package here is fixed by research.md D2–D9 — do not substitute.

- [X] T008 Create `backend/tsconfig.json`: `"target": "ES2023"`, `"module": "NodeNext"`,
      `"moduleResolution": "NodeNext"`, `"strict": true`, `"noUncheckedIndexedAccess": true`,
      `"noImplicitOverride": true`, `"esModuleInterop": true`, `"skipLibCheck": true`,
      `"outDir": "dist"`, `"rootDir": "src"`, `"sourceMap": true`, `"declaration": false`,
      `"include": ["src/**/*.ts"]`, `"exclude": ["dist", "src/db/**/*.cjs"]`. Strict mode is
      required by research.md D2.

- [X] T009 Edit `frontend/package.json`: set `"name": "frontend"` (was `crm-frontend`; the root
      scripts select it by directory, but the name should match the directory). Add
      `dependencies`: `pinia` (3.x), `vue-router` (4.x), `vue-i18n` (11.x) alongside the existing
      `vue`. Add `devDependencies`: `tailwindcss` (4.x) and `@tailwindcss/vite` (4.x). Leave the
      existing `dev`/`build`/`preview` scripts unchanged — `"build": "vue-tsc -b && vite build"` is
      what CI relies on to type-check. Rationale: research.md notes the scaffold currently has only
      `vue`; all four constitution-mandated libraries are missing.

- [X] T010 Run `npm install` from the repository root. **Verify**: a single root `package-lock.json`
      exists, a single root `node_modules/` exists, `node_modules/frontend` and
      `node_modules/backend` are symlinks to the workspace directories, and neither
      `frontend/node_modules` nor `backend/node_modules` contains a duplicate dependency tree. If
      `bcrypt` fails to build natively on Windows, install the VS Build Tools rather than swapping
      to `bcryptjs` — research.md D4 fixes the package.

- [X] T011 Create `eslint.config.js` at repository root — ESLint 9 **flat config**, ESM. Compose:
      `@eslint/js` recommended, `typescript-eslint` recommended, `eslint-plugin-vue`
      `flat/recommended` for `**/*.vue`, and `eslint-config-prettier` last so formatting rules do
      not fight Prettier. Global ignores: `dist/`, `node_modules/`, `backend/src/db/**/*.cjs`
      (CommonJS migration files, intentionally outside the TS project per research.md D9).
      Add an override for `frontend/**/*.vue` enabling the Vue parser with
      `parserOptions.parser: typescript-eslint`'s parser so `<script setup lang="ts">` parses.
      **Verify**: `npm run lint` exits 0 (it will lint almost nothing yet — that is fine, the point
      is that the config loads without error).

- [X] T012 Create the local `.env` by copying `.env.example`, then fill `JWT_ACCESS_SECRET` and
      `JWT_REFRESH_SECRET` with two **different** 48-character random hex strings (e.g.
      `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` run twice).
      **Verify**: `.env` is listed by `git check-ignore .env` — it must never be committed.

- [X] T013 Run `docker compose up -d`, then poll `docker compose ps` until the `mysql` service
      reports `healthy`. **Verify**: the service is healthy and the `crm_support` database exists
      (`docker compose exec mysql mysql -u"$DB_USER" -p"$DB_PASSWORD" -e 'SHOW DATABASES;'`).

**Checkpoint**: `npm install` succeeds from a clean clone, lint config loads, MySQL is reachable.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Configuration, error handling, logging, and build wiring that every user story needs.

**CRITICAL**: No user story work can begin until this phase is complete.

- [X] T014 Create `backend/src/config/env.ts`. Load the root `.env` with
      `dotenv.config({ path: path.resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') })`,
      then validate `process.env` against a **zod** schema covering exactly the variables in
      `.env.example`. Rules (data-model.md, Application Configuration): - `NODE_ENV` is an enum of `development` | `production` | `test` - `PORT` and `DB_PORT` coerce to integers - `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are each `min(32)` - a `superRefine` that fails when the two secrets are **equal** — equal secrets defeat the
      token-type separation in T033 - a refinement that fails when `CORS_ORIGIN === '*'` — credentialed CORS forbids wildcards - `LOG_LEVEL` is optional, defaulting to `info`

      On failure: print **every** issue as `MISSING/INVALID <VAR>: <message>` — one line per
                  variable, so the developer sees the full list, not just the first — then `process.exit(1)`.
                  On success, export `export const env = Object.freeze(parsed.data)`. This module is the ONLY
                  place `process.env` is read; no other file may touch it (research.md D8, FR-017).

- [X] T015 Create `backend/src/config/database.ts` exporting a configured Sequelize instance
      (`dialect: 'mysql'`, credentials from `env`, `logging: false`, `define: { underscored: true,
timestamps: true }` so columns are `created_at`/`updated_at` per data-model.md) plus two
      functions: `assertDatabaseConnection()` which calls `sequelize.authenticate()` and **throws**
      a descriptive error naming the database host/port on failure (used by T029 for fail-fast
      startup, FR-005), and `checkDatabaseConnection(): Promise<boolean>` which returns `false`
      instead of throwing (used by the health endpoint, which must degrade rather than crash).

- [X] T016 [P] Create `backend/src/errors/app-error.ts` defining the error vocabulary from
      contracts/auth-api.md: a `type ErrorCode = 'VALIDATION_ERROR' | 'INVALID_CREDENTIALS' |
'UNAUTHENTICATED' | 'NOT_FOUND' | 'INTERNAL_ERROR'`, an `AppError extends Error` class with
      `code: ErrorCode`, `status: number`, and `details: Array<{ field: string; message: string }>`
      (defaulting to `[]`), and named factory helpers: `validationError(details)` → 400,
      `invalidCredentials()` → 401 with message `Email or password is incorrect.`,
      `unauthenticated()` → 401, `notFound()` → 404. Fixing the messages here is what makes the
      no-enumeration guarantee (V5) hold — two call sites must not drift apart.

- [X] T017 [P] Create `backend/src/middleware/request-logger.ts` exporting `pino-http` middleware.
      JSON output. Use `pino-pretty` transport **only** when `env.NODE_ENV === 'development'`.
      Configure `redact` to cover `req.headers.authorization`, `req.headers.cookie`, and
      `req.body.password` — research.md D7 makes redaction a requirement, not a nicety.
      `pino-http` logs method, path, status, and response time by default, which is exactly FR-008.

- [X] T018 [P] Create `backend/src/middleware/error-handler.ts` exporting two handlers:
      `notFoundHandler` (a normal middleware that forwards `notFound()` to `next`) and
      `errorHandler` (a 4-arity Express error middleware). `errorHandler` must:
      send `{ error: { code, message, details } }` with `err.status` when `err instanceof AppError`;
      otherwise log the full error **including stack** server-side at `error` level and send `500`
      with `{ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.',
details: [] } }`. **A stack trace MUST NEVER appear in a response body in any environment**
      (FR-007) — not even when `NODE_ENV === 'development'`.

- [X] T019 [P] Create `backend/src/types/express.d.ts` augmenting `express-serve-static-core`'s
      `Request` with an optional `user?: { id: number; email: string }`, populated by the
      authenticate middleware in T035. Without this, `req.user` will not type-check under strict
      mode.

- [X] T020 Create `backend/.sequelizerc` (CommonJS, uses `require`/`module.exports`) pointing
      `config` at `src/db/config.cjs`, `migrations-path` at `src/db/migrations`,
      `seeders-path` at `src/db/seeders`, and `models-path` at `src/models`.

- [X] T021 Create `backend/src/db/config.cjs` (**CommonJS**, per research.md D9 — `sequelize-cli`
      runs in its own runtime and does not understand TS ESM). It must `require('dotenv')` and load
      the **root** `.env` via `path.resolve(__dirname, '../../../.env')`, then export
      `development`, `test`, and `production` keys each reading `DB_*` from `process.env` with
      `dialect: 'mysql'`. **Verify**: `npm run db:migrate` from the root prints "No migrations were
      executed" rather than a config or connection error.

- [X] T022 [P] Replace the contents of `frontend/src/style.css` with `@import "tailwindcss";` as the
      first line (Tailwind v4 needs no `@tailwind` triple-directive and no `tailwind.config.js` —
      research.md D10). Below it add only a minimal base layer: a visible `:focus-visible` outline
      that meets WCAG AA contrast, since the focus-indicator contract requires one and Tailwind's
      preflight removes the browser default. Delete any leftover Vite template CSS.

- [X] T023 Edit `frontend/vite.config.ts` to add the `@tailwindcss/vite` plugin alongside
      `@vitejs/plugin-vue`, set **`envDir: '..'`** so `VITE_API_BASE_URL` resolves from the root
      `.env` (rule 2 above), and set `server: { port: 5173 }`. **Verify**: `npm run build --workspace
frontend` succeeds.

**Checkpoint**: `npm run build` succeeds for both workspaces. Config validation, error envelope,
logging, and Tailwind are all in place. User stories can now begin.

---

## Phase 3: User Story 1 — Local Environment Boots Successfully (Priority: P1) 🎯 MVP

**Goal**: `npm run dev` brings up both apps; the backend proves its database connection through a
health endpoint and refuses to start — loudly and specifically — when a dependency is missing.

**Independent Test**: quickstart.md **V1**, **V2**, and **V11**. `curl
http://localhost:3000/api/health` returns `{"status":"ok","database":"connected"}`;
`http://localhost:5173` renders with no console errors; stopping MySQL makes startup fail with a
message naming the database; removing an env var makes startup fail naming that variable.

**Maps to**: FR-001, FR-004, FR-005, FR-007, FR-008, FR-017 · SC-001, SC-006 · PLAN.md Definition
of done clause 1 ("Both apps run locally")

- [X] T024 [US1] Create `backend/src/services/health.service.ts` exporting
      `getHealth(): Promise<{ status: 'ok' | 'degraded'; database: 'connected' | 'disconnected' }>`.
      It calls `checkDatabaseConnection()` from T015 and maps `true` → `ok`/`connected`,
      `false` → `degraded`/`disconnected`. This is a service because it is the only layer permitted
      to reach the database (Principle III) — do not inline the ping in the controller.

- [X] T025 [US1] Create `backend/src/controllers/health.controller.ts` exporting an async
      `getHealth(req, res, next)` that calls the service and responds `200` when `status === 'ok'`,
      **`503`** when `degraded`, with the exact bodies in contracts/auth-api.md. It must not throw
      on a disconnected database — returning 503 while staying alive is what the Edge Case and V11
      require. Wrap in try/catch forwarding to `next`.

- [X] T026 [US1] Create `backend/src/routes/health.routes.ts` — an Express `Router` with
      `router.get('/health', healthController.getHealth)` and nothing else. No logic in this file.

- [X] T027 [US1] Create `backend/src/routes/index.ts` exporting one `Router` that mounts
      `health.routes`. Auth routes are added to this same file in T038. This router is mounted at
      `/api` by T028, which is what produces the unversioned prefix required by FR-020.

- [X] T028 [US1] Create `backend/src/app.ts` exporting a configured Express app. Middleware order
      matters and is fixed: (1) `app.disable('x-powered-by')`, (2) `requestLogger` from T017,
      (3) `cors({ origin: env.CORS_ORIGIN, credentials: true })` — an explicit origin and
      `credentials: true`, never `*` (contracts/auth-api.md, Cross-cutting), (4)
      `express.json({ limit: '100kb' })`, (5) `cookieParser()`, (6) `app.use('/api', apiRouter)`,
      (7) `notFoundHandler`, (8) `errorHandler`. The two error handlers MUST be last, in that order.
      `app.ts` does not call `listen`.

- [X] T029 [US1] Create `backend/src/server.ts` — the only file that starts the process. Order:
      (1) import `env` first so validation runs and exits before anything else initialises
      (FR-017); (2) `await assertDatabaseConnection()` inside a try/catch that logs a message
      **naming the database host and port** and calls `process.exit(1)` on failure — the backend
      must not serve traffic in a half-broken state (FR-005, US1 Scenario 2); (3)
      `app.listen(env.PORT)` logging the bound port; (4) `SIGTERM`/`SIGINT` handlers that close the
      HTTP server and the Sequelize connection before exiting.

- [X] T030 [US1] Delete `frontend/src/components/HelloWorld.vue` and replace
      `frontend/src/App.vue` with a minimal placeholder that renders a single `<div>` and imports
      nothing from the deleted component. The real shell lands in T054; this task exists only so the
      frontend builds and boots clean now. **Verify**: no reference to `HelloWorld` remains
      anywhere (`grep -ri helloworld frontend/src`).

- [X] T031 [US1] Run `npm run dev` from the root and execute quickstart **V1**: backend answers
      `GET /api/health` with `{"status":"ok","database":"connected"}`, frontend renders at
      `http://localhost:5173` with an empty browser console. Fix anything that fails before moving
      on.

- [X] T032 [US1] Execute quickstart **V2** and **V11** and record the results: - `docker compose stop` then `npm run dev:backend` → process exits naming the database. - Remove `JWT_ACCESS_SECRET` from `.env`, retry → exits naming that variable. Restore it. - With the backend already running, `docker compose stop` then `curl -i
  http://localhost:3000/api/health` → `503 {"status":"degraded","database":"disconnected"}`
      **and the process is still alive**. `docker compose start` afterwards.
      The third check is the one most likely to fail — it proves T025 does not throw and T029's
      fail-fast does not also kill a running server.

**Checkpoint**: PLAN.md Definition-of-done clause 1 is satisfied and independently demonstrable.

---

## Phase 4: User Story 2 — Developer Authenticates with a Seeded Test Account (Priority: P1)

**Goal**: Log in with `admin@crm.local`, receive a 15-minute access token plus a 7-day refresh
cookie, reach a protected route with the access token, and refresh it when it expires — with wrong
credentials revealing nothing.

**Independent Test**: quickstart.md **V3**–**V7**. All seven acceptance scenarios in spec.md User
Story 2 produce the correct response (SC-002).

**Maps to**: FR-002, FR-003, FR-006, FR-006a, FR-006b, FR-009, FR-015, FR-018, FR-019, FR-021 ·
SC-002, SC-002a · PLAN.md Definition of done clause 2

### Data layer

- [X] T033 [P] [US2] Create `backend/src/models/user.model.ts` defining the `users` model exactly as
      data-model.md specifies and **no more**: `id` (INTEGER UNSIGNED, PK, autoIncrement), `email`
      (STRING(255), unique, allowNull false), `password_hash` (STRING(255), allowNull false), plus
      Sequelize `timestamps` producing `created_at`/`updated_at`. Add
      `defaultScope: { attributes: { exclude: ['password_hash'] } }` and a named scope
      `withPassword` that includes it. Add a `beforeSave`-style normalisation (or a setter) that
      lowercases and trims `email` so `A@x.com` and `a@x.com` cannot coexist. Do **NOT** add
      `role_id`, `is_active`, `failed_login_attempts`, `locked_until`, `last_login_at`,
      `mfa_secret`, or `department_id` — data-model.md defers all of them to Phase 1 and FR-006b
      forbids them here.

- [X] T034 [P] [US2] Create `backend/src/models/index.ts` importing the Sequelize instance and the
      `User` model and re-exporting both. No associations exist in this phase (data-model.md:
      "None in this phase").

- [X] T035 [US2] Create the baseline migration
      `backend/src/db/migrations/20260825000001-create-users.cjs` (**CommonJS**) with `up` creating
      the `users` table with the five columns above, and an **explicit unique index on `email`** —
      declared in the migration, not merely on the model, so the guarantee holds against direct SQL
      writes (FR-006a). `down` drops the table. **Verify**: `npm run db:migrate` succeeds, then
      `SHOW INDEX FROM users` lists a unique index on `email`, and `SHOW TABLES` lists `users` and
      `SequelizeMeta` — **and nothing else** (FR-006b).

- [X] T036 [US2] Create the seeder `backend/src/db/seeders/20260825000002-admin-user.cjs`
      (**CommonJS**) inserting one row: `email: 'admin@crm.local'`, `password_hash` = `bcrypt.hash`
      of `ChangeMe123!` at **cost 12**, with timestamps. It MUST be **idempotent** — query for the
      email first and return early if present, so re-running neither duplicates nor errors
      (data-model.md). It MUST also refuse to run when `NODE_ENV !== 'development'` — this account
      must not exist in any other environment. `down` deletes the row by email. **Verify**:
      `npm run db:seed` twice in a row; the second run is a no-op and `SELECT COUNT(*) FROM users`
      returns `1`. The plaintext password appears only in this file and quickstart.md.

### Token and auth services

- [X] T037 [US2] Create `backend/src/services/token.service.ts`. Export the constants
      `ACCESS_TOKEN_TTL_SECONDS = 900` and `REFRESH_TOKEN_TTL_SECONDS = 604800`, and four
      functions: - `signAccessToken({ id, email })` → HS256 JWT signed with `env.JWT_ACCESS_SECRET`, claims
      `sub` (the id), `email`, and **`type: 'access'`**, `expiresIn` 900s - `signRefreshToken({ id })` → HS256 JWT signed with `env.JWT_REFRESH_SECRET`, claims `sub`
      and **`type: 'refresh'`**, `expiresIn` 604800s. No `email` claim — the refresh token
      carries no identity beyond the subject - `verifyAccessToken(token)` → verifies against the access secret **and** asserts
      `payload.type === 'access'`, throwing `unauthenticated()` otherwise - `verifyRefreshToken(token)` → verifies against the refresh secret **and** asserts
      `payload.type === 'refresh'`

      Two distinct secrets plus the `type` claim is deliberate belt-and-braces (research.md D5,
                  plan.md Complexity Tracking): the separate secrets make cross-use cryptographically
                  impossible, and the `type` assertion makes the rejection explicit and testable. Implement
                  both — do not "simplify" to one. Neither token carries role or permission claims; those
                  arrive in Phase 1.

- [X] T038 [US2] Create `backend/src/services/auth.service.ts` — the only file in this phase that
      imports a model. Export: - `login(email, password)` → normalises the email (trim + lowercase), rejects a malformed
      email shape or an empty password with `validationError`, loads the user via the
      `withPassword` scope, compares with `bcrypt.compare`, and returns
      `{ user: { id, email }, accessToken, refreshToken }`. **When no user exists, still run a
      `bcrypt.compare` against a fixed dummy hash before throwing**, so the response time does
      not distinguish "no such user" from "wrong password". Both paths throw the identical
      `invalidCredentials()` from T016 — a difference of any kind is an account-enumeration
      defect (US2 Scenario 7, V5). - `refresh(refreshToken)` → verifies via `verifyRefreshToken` and returns a new access token
      only. **Do not issue a new refresh token** — the 7-day window is absolute, not sliding
      (contracts/auth-api.md), which is what bounds the damage from a stolen refresh token. - `getUserById(id)` → returns the user under the default scope, so `password_hash` cannot
      leak.

      Note for later phases: password writes enforce a minimum length of 8; the login path only
                  requires non-empty, since a length check on login tells an attacker nothing but a rejected
                  short password would confuse a legitimate user with a short legacy password.

### HTTP layer

- [X] T039 [US2] Create `backend/src/middleware/authenticate.ts` exporting middleware that reads
      the `Authorization` header, requires the exact form `Bearer <token>`, calls
      `verifyAccessToken`, sets `req.user = { id, email }`, and calls `next()`. Every failure —
      header absent, wrong scheme, expired, bad signature, or `type: 'refresh'` — forwards
      `unauthenticated()` (401). Do not distinguish these cases in the response (FR-003,
      contracts/auth-api.md failure table).

- [X] T040 [US2] Create `backend/src/controllers/auth.controller.ts` with four handlers. HTTP
      concerns only — no business logic, no model access: - `login`: calls `authService.login`, sets the refresh cookie via `res.cookie('crm_refresh',
  refreshToken, { httpOnly: true, sameSite: 'strict', path: '/api/auth', maxAge: 604800000,
  secure: env.NODE_ENV !== 'development' })`, responds `200` with
      `{ accessToken, expiresIn: 900, user: { id, email } }`. Assert by inspection that
      `password_hash` appears nowhere in the response. - `refresh`: reads `req.cookies.crm_refresh`, forwards `unauthenticated()` when absent,
      responds `200` with `{ accessToken, expiresIn: 900 }`. Sets no new cookie. - `logout`: clears the cookie with the **same** `path` and options and responds `204`. It
      MUST succeed even when no cookie was sent — logout is idempotent. - `me`: responds `200` with `{ id, email }` from `req.user`.

- [X] T041 [US2] Create `backend/src/routes/auth.routes.ts`: `POST /login`, `POST /refresh`,
      `POST /logout`, and `GET /me` with the `authenticate` middleware from T039 applied to `/me`
      only. Delegation only — no logic. Then register this router in
      `backend/src/routes/index.ts` (T027) under `/auth`, producing the paths
      `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, `/api/auth/me`.

### Frontend consumption

- [X] T042 [P] [US2] Create `frontend/src/stores/auth.store.ts` — a Pinia store holding
      `accessToken: string | null` and `user: { id: number; email: string } | null` **in memory
      only**, with a computed `isAuthenticated` and actions `setSession`, `setAccessToken`, and
      `clear`. It MUST NOT be persisted to `localStorage` or `sessionStorage` and MUST NOT use a
      Pinia persistence plugin (data-model.md D5/D6 — keeping the token out of web storage is what
      removes the standard XSS token-theft path).

- [X] T043 [US2] Create `frontend/src/services/http.ts` — the **only** module in the frontend that
      reads or writes the access token. Requirements: - Base URL comes from `import.meta.env.VITE_API_BASE_URL` and nowhere else, so Phase 11's
      version segment is a one-line change (FR-021). - Every request sends `credentials: 'include'` so the `httpOnly` refresh cookie is
      transmitted. - Attaches `Authorization: Bearer <token>` when the auth store holds one. - On a `401` response, calls `POST /auth/refresh` once, updates the store, and **retries the
      original request exactly once**. If the refresh also fails, clears the store and propagates
      the error (FR-019). - **Single-flight**: hold the in-flight refresh in a module-scoped
      `let refreshPromise: Promise<boolean> | null`, return the same promise to every concurrent
      caller, and null it in a `.finally()`. Without this, parallel 401s each start their own
      refresh (research.md D6, data-model.md state transitions). - Unwraps the `{ error: { code, message, details } }` envelope into a typed `ApiError`
      carrying `code`, so callers can branch on a stable machine-readable value. - Never retries the refresh call itself — that would recurse.

- [X] T044 [US2] Create `frontend/src/services/auth.service.ts` exposing `login(email, password)`,
      `logout()`, and `fetchMe()`, each delegating to `http.ts`. No component may import `http.ts`
      directly; features talk to services like this one (FR-015).

- [X] T045 [US2] Execute quickstart **V3**, **V4**, **V5**, **V6**, and **V7** against the running
      backend and record the results. Specifically confirm: the `Set-Cookie` carries `HttpOnly` and
      `SameSite=Strict`; `expiresIn` is `900`; no `password_hash` anywhere in any body; the two
      wrong-credential bodies in V5 are **byte-identical**; presenting the refresh token to
      `/api/auth/me` returns 401; and `POST /api/auth/refresh` with no cookie returns 401. Any
      difference in V5 is a defect, not a cosmetic issue.

**Checkpoint**: PLAN.md Definition-of-done clause 2 is satisfied. US1 still works.

---

## Phase 5: User Story 3 — Language Switch Flips Layout Direction (Priority: P1)

**Goal**: Toggling the language switches all text to Arabic and mirrors the layout to RTL with no
page reload, survives a refresh with no flash of the wrong direction, and is operable by keyboard
alone.

**Independent Test**: quickstart.md **V8**, **V9**, **V10**. `<html lang dir>` is correct in all
four states (en→ar, ar→en, reload-in-ar, reload-in-en), the change is visible within 1s, and no
reload occurs.

**Maps to**: FR-010–FR-015, FR-022–FR-024 · SC-003, SC-004, SC-007, SC-008 · PLAN.md Definition of
done clause 3

- [X] T046 [P] [US3] Create `frontend/src/locales/en.json` with dot-namespaced keys, flat object,
      covering every string the shell renders: `app.title`, `nav.home`, `language.name.en`,
      `language.name.ar`, `language.switchTo.en`, `language.switchTo.ar`, `layout.skipToContent`,
      `route.home.title`, `route.notFound.title`, `home.heading`, `home.description`,
      `notFound.heading`, `notFound.description`, `notFound.backToHome`.
      `language.switchTo.ar` must read as the language it switches **to** (e.g. "Switch to Arabic"),
      because that is what the toggle announces (frontend-shell.md).

- [X] T047 [P] [US3] Create `frontend/src/locales/ar.json` with an **identical key set** to
      `en.json` and correct Arabic values. A key present in one file and missing from the other
      renders the raw key to the user. **Verify** the sets match programmatically, e.g.
      `node -e "const a=require('./frontend/src/locales/ar.json'),e=require('./frontend/src/locales/en.json');const ka=Object.keys(a).sort(),ke=Object.keys(e).sort();console.log(JSON.stringify(ka)===JSON.stringify(ke))"`
      → must print `true`.

- [X] T048 [US3] Create `frontend/src/i18n/index.ts` creating the `vue-i18n` v11 instance in
      **Composition API mode** (`legacy: false`), with `messages` from the two locale files,
      `fallbackLocale: 'en'` (which is what satisfies US3 Scenario 4, the corrupted/missing locale
      file), and the initial `locale` resolved by T049. Export the instance as the default.

- [X] T049 [US3] Create `frontend/src/stores/locale.store.ts` exporting
      `export const SUPPORTED_LOCALES = ['en', 'ar'] as const`, `export const LOCALE_STORAGE_KEY =
'crm.locale'`, a standalone `resolveInitialLocale()` that reads `localStorage`, validates the
      value against `SUPPORTED_LOCALES` and returns `'en'` for anything unrecognised (wrapped in
      try/catch for private-browsing storage failures), and a Pinia store with `locale`, a computed
      `direction` (`'rtl'` for `ar`, else `'ltr'`), and `setLocale(next)` which updates the store,
      writes `localStorage`, sets `i18n.global.locale.value`, and calls `applyDocumentLocale` from
      T050. Persist **only** the locale code — nothing else (frontend-shell.md, State contract).

- [X] T050 [US3] Create `frontend/src/composables/useDirection.ts` exporting
      `applyDocumentLocale(locale)` which sets `document.documentElement.lang` and
      `document.documentElement.dir`, plus a `useDirection()` composable exposing the reactive
      direction for components that need it. Both attributes must live on `<html>` — not on a
      wrapper `<div>` — because Tailwind's logical utilities resolve against the root direction
      (FR-022, research.md D10).

- [X] T051 [US3] Edit `frontend/index.html`: set `<html lang="en" dir="ltr">` as the static default
      and add a small **inline, synchronous** `<script>` in `<head>` that reads
      `localStorage.getItem('crm.locale')`, validates it against `'ar'`/`'en'`, and sets
      `documentElement.lang`/`dir` **before any stylesheet or module executes**. This is the only
      thing that prevents the flash of LTR that V9 checks for; setting it in `main.ts` alone is too
      late. Wrap in try/catch. Also set the document `<title>`.

- [X] T052 [US3] Rewrite `frontend/src/main.ts` to: create the app, install **Pinia**, then the
      **i18n** instance, then the **router**, call `applyDocumentLocale(resolveInitialLocale())`
      **before** `app.mount('#app')`, and import `./style.css`. Order matters — Pinia must be
      installed before any store is used, and the locale must be applied pre-mount (FR-014,
      research.md D11).

- [X] T053 [US3] Create `frontend/src/router/index.ts` — `createRouter` with
      `createWebHistory()` (history mode, FR-013) and two routes: `/` → `HomeView` named `home`,
      and a catch-all `/:pathMatch(.*)*` → `NotFoundView` named `not-found`. Put the i18n **key**
      (e.g. `route.home.title`) in `meta.titleKey`, never a literal string, and add an
      `afterEach` hook that sets `document.title` by translating that key — so navigation is
      translatable from the first route onward (frontend-shell.md, Routing contract). Route
      definitions live in this file only, never inline in a component.

- [X] T054 [P] [US3] Create `frontend/src/views/HomeView.vue` and
      `frontend/src/views/NotFoundView.vue`, both `<script setup lang="ts">`. Render only i18n keys
      via `useI18n()` — zero hardcoded strings. `NotFoundView` includes a `<RouterLink>` home
      labelled from `notFound.backToHome`. Logical Tailwind utilities only.

- [X] T055 [US3] Create `frontend/src/components/LanguageToggle.vue` — `<script setup lang="ts">`.
      A real `<button type="button">` (never a `div` with a click handler), rendered inside the
      header. Its `aria-label` is the localised `language.switchTo.<next>` string, announcing the
      language it switches **to**, not the current one. Clicking calls
      `localeStore.setLocale(nextLocale)`. It must show a clearly visible focus indicator in both
      directions (FR-024, frontend-shell.md, Language toggle contract).

- [X] T056 [US3] Create `frontend/src/layouts/DefaultLayout.vue` with the semantic landmark
      structure fixed by frontend-shell.md: `<header>` containing the app title and
      `LanguageToggle`, `<nav>` for primary navigation (empty in this phase, populated from Phase
      1), and exactly one `<main>` containing `<slot />` or `<RouterView />`. Add a
      skip-to-content link using `layout.skipToContent`. Logical utilities only — no `ml-*`,
      `pl-*`, or `text-left` anywhere (FR-023).

- [X] T057 [US3] Replace `frontend/src/App.vue` (the T030 placeholder) with the real shell:
      `<script setup lang="ts">` rendering `DefaultLayout` wrapping `<RouterView />`. Nothing else.

- [ ] T058 [US3] Execute quickstart **V8**, **V9**, and **V10** in a browser and record the
      results. Confirm specifically: `<html lang="en" dir="ltr">` initially; the toggle flips to
      `lang="ar" dir="rtl"` with mirrored layout and Arabic text **and no page reload** within ~1s;
      a hard reload returns in Arabic/RTL with **no visible flash of LTR**; and the whole shell is
      reachable and operable with Tab / Shift+Tab / Enter / Space with a visible focus ring in both
      directions, with focus order following RTL visual order in Arabic.

**Checkpoint**: All three PLAN.md Definition-of-done clauses are now satisfied. US1 and US2 still
work.

---

## Phase 6: User Story 4 — CI Pipeline Validates Each Code Change (Priority: P2)

**Goal**: Every push installs dependencies, lints, and builds both workspaces, reporting an
unambiguous pass or fail.

**Independent Test**: A clean push passes; a push containing a deliberate syntax error fails.

**Maps to**: FR-016 · SC-005

- [X] T059 [US4] Create `.github/workflows/ci.yml`. Triggers: `push` on all branches and
      `pull_request`. One job on `ubuntu-latest` with **`timeout-minutes: 10`** — the timeout is
      what makes the "pipeline step times out" edge case fail cleanly instead of hanging. Steps:
      `actions/checkout@v4`; `actions/setup-node@v4` with `node-version: '22'` and `cache: 'npm'`;
      `npm ci` at the root (this exercises the workspace wiring, so a broken workspace fails CI
      immediately — research.md D12); `npm run lint`; `npm run build` with
      `VITE_API_BASE_URL` set to a placeholder in `env`. **No test step** — FR-016 forbids blocking
      on a stage that does not exist. Do not add one "for later".

- [X] T060 [US4] Verify the pipeline's commands locally before trusting the workflow: run
      `npm ci`, `npm run lint`, and `npm run build` from a clean root and confirm all three exit 0.
      Then confirm the failure path: introduce a deliberate TypeScript error in a scratch file, run
      `npm run build`, confirm it exits non-zero, and revert. This validates US4 Scenarios 1 and 2
      without needing a remote.

- [ ] T061 [US4] **BLOCKED — requires the user.** The repository has no git remote (research.md
      D12), so SC-005 ("reports a result within 5 minutes of a code push") and quickstart **V13**
      cannot be verified. Do not fabricate a pass. Report to the user that a remote must be created
      and `001-phase-0-foundation` pushed, then: confirm the workflow runs `npm ci`, lint, and build
      for both workspaces and reports within 5 minutes; then push a deliberate syntax error and
      confirm it **fails** rather than silently passing. Leave this task unchecked until that
      happens, and update quickstart.md V13 to remove the "Blocked" note once it does.

**Checkpoint**: CI is authored and its commands are locally proven. Remote verification is
outstanding and explicitly flagged.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T062 [P] Create `README.md` at the repository root: what the project is, the prerequisite
      versions from quickstart.md, the setup commands, the workspace layout, and a pointer to
      `specs/001-phase-0-foundation/quickstart.md` for validation and
      `.specify/memory/constitution.md` for the rules. Include the "where do I add a backend
      endpoint / a frontend page" answer explicitly — SC-006 is about a newcomer finding this
      without asking anyone. Delete the stock Vite `frontend/README.md` or replace its contents
      with a one-line pointer to the root README.

- [X] T063 **Physical-utility audit (Principle I).** Search the whole frontend for banned
      direction-specific Tailwind classes:
      `grep -rnE "\b(ml|mr|pl|pr)-[0-9a-z]|\btext-(left|right)\b|\b(left|right)-[0-9]" frontend/src frontend/index.html`
      → must return **nothing**. Replace any hit with its logical equivalent (`ms/me`, `ps/pe`,
      `text-start/text-end`, `start/end`). Symmetric utilities (`mx-*`, `px-*`, `mt-*`) are fine
      and will not match this pattern.

- [X] T064 **Layering audit (Principle III, quickstart V12).** Confirm by inspection and record the
      result: no business logic in `backend/src/routes/` (handlers only delegate); only
      `backend/src/services/` imports from `backend/src/models/`
      (`grep -rn "from '.*models" backend/src | grep -v "backend/src/services\|backend/src/models"`
      → empty); no file under `frontend/src/components/`, `frontend/src/views/`, or
      `frontend/src/layouts/` calls `fetch` (`grep -rn "fetch(" frontend/src/components
frontend/src/views frontend/src/layouts` → empty); `frontend/src/services/http.ts` is the
      only file reading the access token.

- [X] T065 **Hardcoded-string audit (Principle I).** Confirm no user-visible literal text exists in
      any `.vue` template or script — every string is a `t('key')` call. Also re-run the identical
      key-set check from T047, since keys were added throughout Phase 5.

- [X] T066 Run `npm run format` then `npm run lint` at the root and resolve every finding. Both must
      exit 0.

- [X] T067 **Full quickstart run from a clean state.** `docker compose down -v`, delete
      `node_modules` and `.env`, then execute quickstart.md Setup end to end and time it. SC-001
      requires under 10 minutes. If any step is undocumented or out of order, fix
      `quickstart.md` — the document is the deliverable, not just the notes.

- [X] T068 Walk the full V1–V12 checklist one final time and mark each result in the phase notes.
      Then verify the three PLAN.md Definition-of-done clauses explicitly: both apps run locally;
      login against the seeded account returns a valid JWT; switching language flips layout
      direction. V13 stays open per T061.

- [X] T069 Update `specs/001-phase-0-foundation/checklists/requirements.md` if any accepted
      exception changed, and confirm the plan.md Complexity Tracking entry about deferred audit
      logging is still accurate — it is **time-boxed and MUST close in Phase 1**, so it needs to
      carry forward into the Phase 1 spec rather than being inherited as assumed-done.

- [X] T070 Commit all remaining work on `001-phase-0-foundation`. Do **not** push (no remote) and do
      **not** merge to `main` until the user confirms the Definition-of-done gate in
      `.specify/memory/constitution.md` is met.

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 Setup (T001–T013)** — no dependencies; must be first. T003 depends on T001 (workspaces
  must exist). T010 depends on T003, T007, T009. T011 depends on T010. T013 depends on T012 (Compose
  reads `.env`).
- **Phase 2 Foundational (T014–T023)** — depends on Phase 1. **Blocks all four user stories.**
- **Phase 3 US1 (T024–T032)** — depends on Phase 2.
- **Phase 4 US2 (T033–T045)** — depends on Phase 2. Its backend half is independent of US1's code,
  but V3–V7 need a running server, so in practice run US1 first.
- **Phase 5 US3 (T046–T058)** — depends on Phase 2 only. Fully independent of US1 and US2; a second
  developer can build it in parallel.
- **Phase 6 US4 (T059–T061)** — depends on the root `lint` and `build` scripts existing (T003) and
  on both workspaces building (T023, T029). Practically: run last of the stories.
- **Phase 7 Polish (T062–T070)** — depends on all stories being complete.

### Critical path

T001 → T003 → T007 → T010 → T014 → T015 → T028 → T029 → T031

Everything else hangs off that spine.

### Within each user story

Models → services → controllers → routes → frontend consumption → manual validation. Never invert
this; a controller written before its service invites logic leaking upward, which is exactly the
Principle III violation the directory layout is designed to make visible.

### Parallel opportunities

| Group                   | Tasks                  | Why safe                                             |
| ----------------------- | ---------------------- | ---------------------------------------------------- |
| Setup config files      | T004, T005, T006       | Three distinct new files, no imports between them    |
| Foundational middleware | T016, T017, T018, T019 | Separate files; only T018 depends on T016            |
| Frontend build wiring   | T022                   | Independent of all backend work                      |
| US2 data layer          | T033, T034             | Separate model files                                 |
| US2 frontend            | T042                   | No dependency on the backend being finished          |
| US3 locale files        | T046, T047             | Two files; verify the key sets match after both land |
| US3 views               | T054                   | Independent of the layout and toggle                 |
| Polish audits           | T062, T063             | Read-only inspection of different concerns           |

**Cross-story parallelism**: once Phase 2 is done, US1, US2, and US3 can proceed simultaneously.
US3 (T046–T058) touches no backend file at all, so it is the cleanest split for a second worker.

---

## Implementation Strategy

### MVP first

1. Phase 1 Setup — the repo installs and MySQL runs.
2. Phase 2 Foundational — config, errors, logging, Tailwind. **Blocking.**
3. Phase 3 US1 — both apps boot, health endpoint answers, failures are loud.
4. **STOP and validate V1, V2, V11.** This alone satisfies PLAN.md Definition-of-done clause 1 and
   is a genuinely useful increment: every later phase depends on a bootable environment.

### Incremental delivery

1. Setup + Foundational → environment ready
2. - US1 → both apps run (**clause 1**, MVP)
3. - US2 → login returns a valid JWT (**clause 2**)
4. - US3 → language switch flips direction (**clause 3** — Phase 0 is now functionally done)
5. - US4 → CI safety net for Phases 1–12
6. - Polish → audits, docs, full quickstart run

### Suggested MVP scope

**Phases 1–3 (T001–T032).** That yields a running monorepo with a health-checked database
connection and fail-fast startup — the prerequisite for literally everything else in PLAN.md.

---

## Notes

- **No tests in this phase.** Every validation is manual and mapped to a `V#` in quickstart.md.
  If you find yourself wanting a test runner, that instinct is right but it is a Phase 1 task —
  plan.md records it as a known risk, not an oversight.
- **The audit-logging gap is deliberate and time-boxed.** Phase 0 authenticates users but persists
  no audit record, because FR-006b forbids the table and PLAN.md puts the audit log in Phase 1.
  pino logs every login attempt, so the events are observable but not queryable. This MUST close in
  Phase 1.
- **Unversioned `/api/`** is a recorded decision (Clarifications Q3). FR-021's single configurable
  base path is the mitigation that keeps Phase 11's change small.
- Commit after each task or logical group. Stop at any checkpoint to validate a story on its own.
- Avoid: adding dependencies not named in research.md, creating tables or columns beyond
  data-model.md, and "helpful" abstractions for phases that do not exist yet — Constitution
  Governance prohibits speculative complexity.
