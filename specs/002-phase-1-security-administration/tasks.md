---
description: "Task list for Phase 1 — Security & Administration Foundations"
---

# Tasks: Phase 1 — Security & Administration Foundations

**Input**: Design documents from `/specs/002-phase-1-security-administration/`

**PLAN.md Reference**: Phase 1 — Security & Administration Foundations

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Branch**: `002-phase-1-security-administration`, cut from `001-phase-0-foundation` @ `7dd51a3`,
which is exactly what was merged to `main` in PR #1. No content divergence from `main`.

**Tests**: **YES — required this phase.** Phase 0 shipped without a framework by explicit user
decision; this phase reverses that (research.md D8). SC-003 requires every role × action combination
verified through a path that bypasses the interface, which is not hand-checkable. Test tasks are not
optional here.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: `[US1]`–`[US5]`, mapping to the user stories in spec.md
- Every task states its exact file path

---

## READ THIS FIRST — Non-negotiable rules for the implementing model

These are the failure modes most likely to sink this phase. Violating any of them means the task is
not done, even if the code runs and the tests pass.

1. **No permission decision outside `authorization.service`.** `requirePermission` middleware
   translates an answer into a response; it never computes one. No controller, no route handler, and
   no model contains a role comparison or a permission lookup. This is what makes research.md D1's
   caching decision revisitable later without touching call sites
   ([contracts/authorization.md](./contracts/authorization.md)).
2. **Authorization reads the database, never the token.** The access token carries `sub`, `email`,
   and `type` — nothing about roles or permissions, and nothing is to be added.
   `authenticate` loads the current user row on every protected request. **Phase 0's data-model said
   role claims would "arrive in Phase 1"; that expectation is deliberately reversed** (plan.md
   Complexity Tracking). Adding a role claim breaks FR-007 and FR-016 at once.
3. **Status-code discipline.** `401` for no/invalid/expired token **and for an inactive user**;
   `403 PASSWORD_CHANGE_REQUIRED` for the forced-change state; `403 FORBIDDEN` for a permission
   failure; `404` **only** when the caller had permission to look and the thing is absent. Deciding
   permission before existence is what stops the status code leaking (FR-019). Returning `403` for a
   deactivated user confirms their session was valid — use `401`.
4. **Four sign-in failures are byte-identical.** Wrong password, unknown account, locked account, and
   inactive account all return the same `401 INVALID_CREDENTIALS` body, and all run a bcrypt compare
   so timing matches (FR-030, research.md D6). A helpful "your account is locked" message is an
   account-existence oracle and is a defect, not a courtesy.
5. **State-changing audit writes go inside the action's transaction.** If the audit insert fails,
   the change rolls back (FR-041, research.md D4). Authentication-path events are the documented
   exception — they log loudly instead, because a failed sign-in cannot be un-failed.
6. **Nothing sensitive reaches an audit row.** No password, no hash, no token, no cookie — including
   inside `previousValue`, `newValue`, and `metadata`. The audit writer strips a deny-list before
   serialising, so a careless caller cannot leak through `metadata` (FR-036).
7. **Logical Tailwind utilities only.** `ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start`, `text-end`,
   `start-*`, `end-*`. **Never** `ml-*`, `mr-*`, `pl-*`, `pr-*`, `text-left`, `text-right`,
   `left-*`, `right-*`. Symmetric utilities (`mx-*`, `px-*`, `mt-*`, `w-*`, `text-center`) are fine.
8. **No hardcoded user-visible strings.** Every one is an i18n key, and `ar.json` and `en.json` MUST
   keep identical key sets — including validation messages, empty states, dialog text, status words,
   and translated action names. Error paths are where hardcoded strings hide.
9. **ESM import extensions.** Backend relative imports carry `.js` even though the source is `.ts`:
   `import { env } from '../config/env.js'`. Omitting it compiles and crashes at runtime.
10. **Do not build what was ruled out.** No MFA column, flow, or setting (Clarifications Q1). No role
    create/rename/delete endpoint or column (Clarifications Q2). No per-user permission overrides. No
    `department_id`, no `last_login_at`. Adding them now is out of scope, not foresight.
11. **`version` is required on every update.** `PATCH`/`PUT` without it, or with a stale value, is
    `409 CONFLICT` — never a silent overwrite (research.md D11).

**Canonical values** (do not invent alternatives):

| Thing | Value |
|---|---|
| Role keys | `agent`, `supervisor`, `admin` |
| Permission key format | `module:action`, e.g. `users:reset_password` |
| Catalog location | `backend/src/auth/permissions.ts` |
| Admin API prefix | `/api/admin` |
| Password min length | `PASSWORD_MIN_LENGTH`, default `12`, floored at `8` |
| Password history size | `PASSWORD_HISTORY_SIZE`, default `5` |
| Lockout threshold | `AUTH_MAX_FAILED_ATTEMPTS`, default `5` |
| Lockout duration | `AUTH_LOCKOUT_MINUTES`, default `15` |
| Page size default / max | `25` / `100` (clamped, not rejected) |
| Test database | `crm_support_test` |
| Forced-change error code | `PASSWORD_CHANGE_REQUIRED` |

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Stand up the test framework Phase 0 deliberately omitted, and add the policy
configuration everything else reads.

- [X] T001 Install test dependencies at the repository root: `vitest` (4.x), `supertest` (7.x),
      `@types/supertest`, `@vue/test-utils` (2.x), `happy-dom`, `@vitest/coverage-v8`. Root
      `devDependencies` only — a single runner serves both workspaces (research.md D8). **Verify**:
      `npx vitest --version` resolves and the root `package-lock.json` is the only lockfile.

- [X] T002 Create `vitest.config.ts` at the repository root defining two projects: `backend`
      (environment `node`, include `backend/tests/**/*.test.ts`) and `frontend` (environment
      `happy-dom`, include `frontend/tests/**/*.test.ts`, with the Vue plugin so `.vue` files
      compile). Set `testTimeout` to 20000 — backend tests hit a real database and bcrypt at cost 12
      is deliberately slow.

- [X] T003 Add scripts to the root `package.json`: `"test": "vitest run"`,
      `"test:watch": "vitest"`, `"test:coverage": "vitest run --coverage"`. Do not add a
      per-workspace test script; the root config owns both projects.

- [X] T004 [P] Create `backend/tests/helpers/database.ts` exporting `setupTestDatabase()` which
      points Sequelize at `crm_support_test`, runs migrations, and seeds roles and grants; plus
      `truncateAll()` which empties every table except `SequelizeMeta` between tests, and
      `closeTestDatabase()`. The test schema is separate so a test run can never touch development
      data.

- [X] T005 [P] Create `backend/tests/helpers/auth.ts` exporting `createTestUser({ roleKey, ... })`
      and `signInAs(user)` returning an access token, so tests express intent rather than repeating
      a login dance. Also export `agentFor(user)` wrapping `supertest(app)` with the Authorization
      header pre-set.

- [X] T006 [P] Create `frontend/tests/helpers/mount.ts` exporting a `mountWithPlugins(component,
      options)` helper that installs a fresh Pinia, the i18n instance, and a memory-history router,
      so component tests do not each reassemble the app's plugins.

- [X] T007 Add the four policy variables to `.env.example` with the same commentary style Phase 0
      used, documenting each default and that all are optional:
      `PASSWORD_MIN_LENGTH=12`, `PASSWORD_HISTORY_SIZE=5`, `AUTH_MAX_FAILED_ATTEMPTS=5`,
      `AUTH_LOCKOUT_MINUTES=15`. Note in the comment block that changing them requires a restart
      (research.md D7).

- [X] T008 Extend the zod schema in `backend/src/config/env.ts` with those four variables: each
      coerced to a positive integer with the defaults above, and `PASSWORD_MIN_LENGTH` additionally
      `.min(8)` so policy cannot be configured below the floor Phase 0 recorded. Do **not** add any
      other `process.env` read anywhere — this file remains the only one (FR-017 from Phase 0).

- [X] T009 Add a test step to `.github/workflows/ci.yml`: a MySQL 8.4 service container, `npm ci`,
      lint, `npm test` with `NODE_ENV=test` and `DB_NAME=crm_support_test`, then build. Phase 0's
      FR-016 forbade a test stage because none existed; one exists now, so the prohibition no longer
      applies (plan.md non-violations).

**Checkpoint**: `npm test` runs and reports zero tests without erroring. CI has a test stage.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The schema, the permission mechanism, and the admin plumbing every user story needs.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Permission catalog

- [X] T010 Create `backend/src/auth/permissions.ts` — the single source of truth (research.md D2).
      Export a `const PERMISSIONS` array of the twelve keys in data-model.md (`users:view`,
      `users:create`, `users:update`, `users:deactivate`, `users:reset_password`, `roles:view`,
      `roles:update_permissions`, `audit:view`, `settings:view` — plus the module/action metadata
      each needs), a `PermissionKey` union type derived from it, `isPermissionKey(value)`, and
      `permissionCatalog()` returning the module-grouped shape
      [contracts/admin-api.md](./contracts/admin-api.md) specifies for `GET /api/admin/permissions`.
      Each entry carries an i18n `nameKey` — never a literal label. **This file lives outside
      `services/` deliberately**: it is a declaration every layer reads, not logic any layer runs.

### Migrations

Run in this order; each is a separate reversible migration (data-model.md).

- [X] T011 Create `backend/src/db/migrations/20260826000001-create-roles.cjs` (**CommonJS**)
      creating `roles` with `id`, `key` (**unique**, not null), `name_key`, `description_key`, and
      timestamps. `down` drops the table.

- [X] T012 Create `backend/src/db/migrations/20260826000002-create-role-permissions.cjs` creating
      `role_permissions` with `id`, `role_id` (FK → `roles.id`, `ON DELETE CASCADE`),
      `permission_key`, timestamps; a **composite unique index on `(role_id, permission_key)`**
      declared in the migration so a duplicate grant is impossible even via direct SQL; and a
      secondary index on `permission_key`.

- [X] T013 Create `backend/src/db/migrations/20260826000003-add-user-columns.cjs` adding
      `full_name`, `role_id`, `is_active`, `must_change_password`, `failed_login_attempts`,
      `locked_until`, and `version` to `users`. **Order matters**: add `full_name` and `role_id`
      nullable, backfill (`full_name` from the email local-part, `role_id` to the `admin` role,
      counters zero, `is_active` true), then apply `NOT NULL` and the foreign key. Add indexes on
      `role_id` and `is_active`. `down` reverses each column.

- [X] T014 Create `backend/src/db/migrations/20260826000004-create-audit-logs.cjs` creating
      `audit_logs` exactly as data-model.md specifies — `id` as **`BIGINT UNSIGNED`** because this
      table grows unbounded, `created_at` but **no `updated_at`** since an append-only row is never
      updated. Indexes on `created_at`, `actor_user_id`, `action`, and composite
      `(created_at, action)`.

- [X] T015 Create `backend/src/db/migrations/20260826000005-create-password-history.cjs` creating
      `password_history` with `id`, `user_id` (FK, cascade), `password_hash`, `created_at`, and an
      index on `(user_id, created_at)`.

- [X] T016 Run `npm run db:migrate`. **Verify**: `SHOW TABLES` lists `users`, `roles`,
      `role_permissions`, `audit_logs`, `password_history`, `SequelizeMeta` — **and nothing else**.
      `SHOW INDEX FROM role_permissions` shows the composite unique. Then `npm run db:migrate:undo`
      five times and re-apply, confirming every `down` works.

### Models

- [X] T017 [P] Create `backend/src/models/role.model.ts` defining `roles` per data-model.md, with a
      `hasMany` to `RolePermission` and `hasMany` to `User`. No create/destroy helpers — the set is
      fixed (FR-021).

- [X] T018 [P] Create `backend/src/models/role-permission.model.ts` defining `role_permissions`.

- [X] T019 [P] Create `backend/src/models/audit-log.model.ts` defining `audit_logs` with
      `timestamps: true, updatedAt: false`. **Expose no update or destroy path** — append-only is
      enforced by the absence of a write path, not a guard inside one (FR-035, research.md D5).

- [X] T020 [P] Create `backend/src/models/password-history.model.ts` with a `defaultScope`
      excluding `password_hash`, mirroring the pattern `user.model.ts` established in Phase 0. No
      endpoint ever returns any part of this table.

- [X] T021 Extend `backend/src/models/user.model.ts` with the seven new columns, `version: true` for
      optimistic locking (research.md D11), a `belongsTo` to `Role`, and an `isLocked` virtual
      derived from `locked_until` rather than stored. Keep the existing `defaultScope` excluding
      `password_hash` and the `withPassword` scope untouched. Do **not** add `mfa_secret`,
      `department_id`, or `last_login_at` (rule 10).

- [X] T022 Update `backend/src/models/index.ts` to import all five models and declare the
      associations in one place, so relationship wiring is reviewable at a glance.

### Seeders

- [X] T023 **Superseded during implementation — the three roles are inserted by the T011 migration,
      not by a seeder.** Reason: T013 adds a `NOT NULL` `users.role_id` foreign key that must be
      backfilled, and `sequelize-cli` runs **all migrations before any seeder**, so a seeder-owned
      roles table is empty exactly when the backfill needs it. This was caught by running the
      migration: `role_id` came out NULL and MySQL accepted the `NOT NULL` change anyway, leaving the
      schema lying about its own data. FR-021 makes the role set permanently fixed, so the rows are
      immutable reference data the schema depends on rather than mutable seed data — the migration is
      their correct home. Role *permissions* stay in a seeder (T024), because Administrators edit
      those at runtime. **Verify**: `SELECT COUNT(*) FROM roles` returns 3 immediately after
      `db:migrate`, with no seeder run.

- [X] T024 Create `backend/src/db/seeders/20260826000007-role-permissions.cjs` seeding the default
      grants from data-model.md: `admin` gets every catalog key, `supervisor` gets `audit:view`,
      `settings:view`, `users:view`, and `agent` gets none. Idempotent and **reconciling** — it
      inserts missing grants without deleting an Administrator's deliberate changes, so re-running
      after a later phase adds catalog entries does the right thing.

- [X] T025 Update `backend/src/db/seeders/20260825000002-admin-user.cjs` so the seeded
      `admin@crm.local` account is created with `full_name`, the `admin` role, `is_active` true, and
      `must_change_password` true (FR-049). Keep it idempotent and development-only. **The migration
      backfill deliberately does not set `must_change_password` on the pre-existing row**, so an
      established development environment keeps working (data-model.md).

- [X] T026 Run `npm run db:seed` twice. **Verify**: three roles, the documented grant counts, one
      admin user, and the second run is a no-op.

### Authorization mechanism

- [X] T027 Create `backend/src/services/authorization.service.ts` — **the only place a permission
      decision is made** (rule 1). Export `getRolePermissions(roleId): Promise<Set<PermissionKey>>`
      which reads `role_permissions`, discards keys absent from the catalog, and returns the set;
      `roleHasPermission(roleId, key): Promise<boolean>`; and `assertPermission(roleId, key)` which
      throws `forbidden()`. Reading current state per call is the design (research.md D1) — **do not
      add a cache**; the service boundary exists so one can be added later without touching callers.

- [X] T028 Add a `forbidden()` factory to `backend/src/errors/app-error.ts` returning `403` with
      code `FORBIDDEN`, and a `conflict(message)` factory returning `409` with code `CONFLICT`.
      Extend the `ErrorCode` union with `FORBIDDEN`, `CONFLICT`, and `PASSWORD_CHANGE_REQUIRED`.
      Fixing the messages here is what keeps two call sites from drifting apart, exactly as Phase 0's
      `invalidCredentials()` does.

- [X] T029 Extend `backend/src/middleware/authenticate.ts` to load the user's **current** row after
      verifying the token, populating `req.user` with `{ id, email, roleId, isActive,
      mustChangePassword }`. A missing **or inactive** user forwards `unauthenticated()` — the same
      `401` as a bad token, so deactivation is indistinguishable from an invalid session (rule 3).
      Update `backend/src/types/express.d.ts` to match.

- [X] T030 Create `backend/src/middleware/require-permission.ts` exporting
      `requirePermission(key)` returning middleware that calls
      `authorizationService.roleHasPermission` and forwards `forbidden()` on a false answer. **It
      computes nothing** (rule 1).

- [X] T031 Create `backend/src/middleware/require-password-change.ts` exporting middleware that
      forwards a `403 PASSWORD_CHANGE_REQUIRED` when `req.user.mustChangePassword` is set, except on
      `GET /api/auth/me`, `POST /api/auth/change-password`, and `POST /api/auth/logout`
      (research.md D10). Enforcing this server-side rather than by router guard is the same
      principle as FR-015.

### Audit mechanism

- [X] T032 Create `backend/src/services/audit.service.ts` exporting `record(entry, { transaction })`
      and `recordAuthEvent(entry)`. `record` **requires** a transaction and is used for every state
      change (rule 5). `recordAuthEvent` writes directly and, on failure, logs at `error` with the
      full event and increments a counter — it never throws, because a failed sign-in cannot be
      un-failed (research.md D4). Both pass every JSON field through a **redaction step** stripping a
      deny-list of keys (`password`, `newPassword`, `currentPassword`, `token`, `accessToken`,
      `refreshToken`, `hash`, `password_hash`, `cookie`, `authorization`) before serialising, so a
      careless caller cannot leak a credential through `metadata` (rule 6, FR-036).

- [X] T033 Export an `AUDIT_ACTIONS` constant from `backend/src/services/audit.service.ts` holding
      every action key in data-model.md's table, including `data.exported` and `record.deleted`
      which have no callers yet. They exist now so Phases 2–12 record in the established shape
      rather than inventing their own.

### Admin router and frontend plumbing

- [X] T034 Create `backend/src/routes/admin/index.ts` exporting a Router that applies
      `authenticate` and `requirePasswordChange` once for the whole group, then mounts the
      per-resource routers added in later phases. Register it in `backend/src/routes/index.ts` under
      `/admin`, producing `/api/admin/*`.

- [X] T035 Extend `GET /api/auth/me` — `backend/src/controllers/auth.controller.ts` and
      `backend/src/services/auth.service.ts` — to return `{ id, email, fullName, role: { key,
      nameKey }, permissions: [...], mustChangePassword }` per
      [contracts/admin-api.md](./contracts/admin-api.md). `permissions` is the **resolved key set**
      from `authorization.service`, not the role name for the client to expand (research.md D13).
      This route stays reachable while `mustChangePassword` is set.

- [X] T036 [P] Extend `frontend/src/stores/auth.store.ts` with `role` and a `permissions: string[]`,
      populated from `/auth/me`. Still **in memory only** — no `localStorage`, no persistence plugin
      (Phase 0 D5/D6 is unchanged by this phase).

- [X] T037 [P] Create `frontend/src/composables/usePermissions.ts` exporting `can(key)` reading the
      auth store. Document in a comment that `can()` governs **display only** and that every guarded
      action's endpoint enforces the same permission independently (FR-015, FR-020).

- [X] T038 Create `frontend/src/layouts/AdminLayout.vue` — the admin shell nested inside Phase 0's
      `DefaultLayout`, with the admin navigation rendered in the existing `<nav>` landmark that
      Phase 0 left empty for exactly this. Each entry is hidden when `can(...)` is false; the current
      entry carries `aria-current="page"`. Labels are i18n keys. Logical utilities only.

- [X] T039 Add the `/admin` route group to `frontend/src/router/index.ts` with a `beforeEach` guard
      redirecting when `can(...)` is false, and `meta.titleKey` on every route (never a literal).
      Add `/change-password`. **Comment that the guard is a convenience, not a control** — the
      endpoints enforce independently.

- [X] T040 [P] Create `frontend/src/components/admin/DataTable.vue`, `Pagination.vue`,
      `FormField.vue`, `EmptyState.vue`, and `ConfirmDialog.vue` implementing the patterns in
      [contracts/admin-ui.md](./contracts/admin-ui.md): a real `<table>` with a visually-hidden
      `<caption>` and `<th scope="col">`; `aria-busy` while loading; labels bound by `for`/`id`;
      errors referenced by `aria-describedby` with `aria-invalid`; a dialog with `role="dialog"`,
      `aria-modal`, trapped focus, Escape-to-dismiss, and focus returned to the trigger. These are
      what Phases 2–12 reuse, so getting them right once is the point.

**Checkpoint**: migrations and seeders apply cleanly, the permission mechanism exists and is
unit-testable, and an admin screen has somewhere to live. User stories can now begin.

---

## Phase 3: User Story 1 — Administrator Manages User Accounts (Priority: P1) 🎯 MVP

**Goal**: An Administrator creates accounts, assigns roles, and deactivates leavers. New users are
forced to set their own password before reaching anything else.

**Independent Test**: quickstart **V1**. Sign in as Administrator, create a user of each role, sign
in as each, deactivate one and confirm refusal. Delivers a working multi-user system on its own.

**Maps to**: FR-001–FR-010, FR-049 · SC-001, SC-002, SC-011, SC-012 · PLAN.md Definition of done
clause 1 ("An Administrator can create users, assign roles")

### Tests for US1

- [X] T041 [P] [US1] Create `backend/tests/admin/users.test.ts` covering the endpoint contract:
      create with each role, duplicate email → `409` on the `email` field, list paging and filters,
      patch with a stale `version` → `409`, and role change. Tests fail until T044–T047 land.

- [X] T042 [P] [US1] Create `backend/tests/admin/last-administrator.test.ts` (quickstart **A10**)
      asserting that deactivating, role-changing, **and** permission-stripping the last active
      Administrator are each refused — three separate paths to the same forbidden state, and all
      three must hold (FR-009, SC-012).

- [X] T043 [P] [US1] Create `backend/tests/auth/inactive-user.test.ts` (quickstart **A2**) asserting
      a deactivated user's existing token is refused on the next request with **`401`, not `403`**
      (FR-007, SC-011, rule 3).

### Backend for US1

- [X] T044 [US1] Create `backend/src/services/user.service.ts` — the only US1 file importing a
      model. Export `list({ page, pageSize, search, roleKey, isActive })` returning
      `{ items, page, pageSize, total }` with `pageSize` **clamped** to 100 rather than rejected;
      `getById`; `create`; `update`; `setActive`; and `unlock`. `create` and `update` run inside a
      transaction that also writes the audit entry (rule 5). Guard rails: refuse self-deactivation
      and self-demotion with `forbidden()` (FR-008), and refuse any change leaving zero active
      Administrators with `conflict()` (FR-009) — checked against the resulting state, not the
      current one.

- [X] T045 [US1] Create `backend/src/controllers/admin/users.controller.ts` with handlers for list,
      get, create, patch, deactivate, reactivate, reset-password, and unlock. HTTP concerns only —
      no business logic, no model access. Validate bodies with zod and map failures onto
      `details[]` by field name so the form can attach each error to its input.

- [X] T046 [US1] Create `backend/src/routes/admin/users.routes.ts` applying
      `requirePermission('users:view' | 'users:create' | 'users:update' | 'users:deactivate' |
      'users:reset_password')` per the table in [contracts/admin-api.md](./contracts/admin-api.md).
      Note that reactivate deliberately shares `users:deactivate` — changing an account's active
      state is one capability, not two. Delegation only, no logic.

- [X] T047 [US1] Register the users router in `backend/src/routes/admin/index.ts`. **Verify**:
      `curl` each endpoint as an Administrator and as an Agent, confirming `200`/`403` respectively.

### Frontend for US1

- [ ] T048 [P] [US1] Create `frontend/src/services/admin-users.service.ts` exposing `list`, `get`,
      `create`, `update`, `deactivate`, `reactivate`, `resetPassword`, and `unlock`, each delegating
      to `http.ts`. No component imports `http.ts` directly (FR-015).

- [ ] T049 [P] [US1] Create `frontend/src/stores/admin-users.store.ts` holding the current page,
      filters, and loading state. No token handling — that stays in `auth.store.ts`.

- [ ] T050 [US1] Create `frontend/src/views/admin/UsersListView.vue` using `DataTable` from T040.
      Columns: name, email, role, status, actions. **Status distinguishes three states** — active,
      inactive, and locked — because a locked account is a different situation from a deactivated
      one (data-model.md). Filters: search, role, active state. Row actions are real `<button>`s and
      are omitted, not disabled-without-explanation, when `can()` is false.

- [ ] T051 [US1] Create `frontend/src/views/admin/UserFormView.vue` serving create and edit. Create
      collects email, full name, role, initial password; edit collects full name and role —
      **email is not editable**, since it is the login identifier the audit log references. Warn
      before the user changes their own role. Map `details[]` onto fields and move focus to the
      first invalid one on failure.

- [ ] T052 [US1] Wire deactivation in `frontend/src/views/admin/UsersListView.vue` through the
      `ConfirmDialog` from T040: the confirm button states the
      specific consequence ("Deactivate Support Agent"), never "OK", and a server refusal (last
      Administrator) is surfaced **in the dialog** with the server's message rather than swallowed.

- [ ] T053 [US1] Create `frontend/src/views/ChangePasswordView.vue` and the
      `POST /api/auth/change-password` endpoint wiring, so a forced-change user has somewhere to
      land. Show the policy requirements up front rather than only after a failed attempt.

- [ ] T054 [P] [US1] Add all US1 i18n keys to **both** `frontend/src/locales/en.json` and
      `ar.json` — table headers, filters, status words, form labels, dialog text, validation
      messages, and route titles. Identical key sets (rule 8).

- [ ] T055 [US1] Execute quickstart **V1** and record the result: create a user in under two
      minutes, sign in as them, confirm the forced change-password redirect and that no other route
      is reachable until the password is set.

**Checkpoint**: PLAN.md Definition-of-done clause 1 is satisfied and independently demonstrable.

---

## Phase 4: User Story 2 — Permissions Are Enforced Server-Side (Priority: P1)

**Goal**: Every protected action is refused server-side when the role lacks the permission,
regardless of how it was invoked. An Administrator edits a role's grants and the change is live
immediately.

**Independent Test**: quickstart **V2**, **V3**, and the **A1** matrix. With one account per role,
every module action produces the outcome the permission matrix says it should — through the
interface and by direct request.

**Maps to**: FR-011–FR-021 · SC-003, SC-004 · PLAN.md Definition of done clause 2 ("permission
checks are enforced server-side, not just hidden in the UI")

### Tests for US2

- [X] T056 [US2] Create `backend/tests/authorization.matrix.test.ts` — **the most important test in
      this phase** (SC-003, quickstart **A1**). It is **generated, not hand-written**: iterate the
      catalog from T010 crossed with the three roles and assert each endpoint returns non-`403` when
      the role holds the key and `403` when it does not. Additionally assert that (a) **every route
      registered under `/api/admin` requires at least one permission** — a route missing
      `requirePermission` fails the suite — and (b) **every catalog key is required by some route** —
      a key nothing enforces is dead and fails. Those two assertions are what keep this honest as
      Phases 2–12 add modules ([contracts/authorization.md](./contracts/authorization.md)).

- [X] T057 [P] [US2] Create `backend/tests/admin/roles.test.ts` covering permission replacement,
      an unknown key → `400`, a stale `version` → `409`, and the FR-018 refusal when a change would
      leave no role holding `roles:update_permissions` or `users:update`.

- [X] T058 [P] [US2] Create `backend/tests/auth/permission-immediacy.test.ts` (quickstart **A14**,
      SC-004) asserting that a permission removed mid-session takes effect on the **very next
      request** — no sign-out, no wait. This is what proves research.md D1's design rather than
      merely describing it.

- [X] T059 [P] [US2] Create `backend/tests/auth/forced-password-change.test.ts` (quickstart **A3**)
      asserting every route except the three exempt ones returns `403 PASSWORD_CHANGE_REQUIRED`
      while the flag is set.

- [ ] T060 [P] [US2] Create `backend/tests/admin/not-found-vs-forbidden.test.ts` asserting FR-019:
      a caller lacking `users:view` receives `403` for both an existing and a nonexistent user id,
      and `404` appears **only** for a permitted caller. Reversing the check order leaks existence
      through the status code (rule 3).

### Backend for US2

- [X] T061 [US2] Create `backend/src/services/role.service.ts` exporting `list()` returning each
      role with its resolved permissions and a `userCount`, and `replacePermissions(roleId, keys,
      version)`. Validate every key against the catalog. Enforce FR-018 by checking the **resulting
      state of all roles**, not just the edited one, and refuse with `conflict()`. Refuse a change
      stripping the caller's own administrative access with `forbidden()` (FR-008). Runs in a
      transaction with the audit entry carrying previous and new sets (FR-034).

- [X] T062 [US2] Create `backend/src/controllers/admin/roles.controller.ts` with `list`,
      `permissionCatalog` (serving T010's `permissionCatalog()` so the screen can never offer a
      permission nothing enforces), and `replacePermissions`.

- [X] T063 [US2] Create `backend/src/routes/admin/roles.routes.ts`: `GET /roles` and
      `GET /permissions` behind `roles:view`, `PUT /roles/:id/permissions` behind
      `roles:update_permissions`. **Deliberately no `POST` or `DELETE`** — the role set is fixed, so
      those routes do not exist and a request gets `404` (FR-021, rule 10). Register in
      `backend/src/routes/admin/index.ts`.

### Frontend for US2

- [ ] T064 [P] [US2] Create `frontend/src/services/admin-roles.service.ts` exposing `list`,
      `permissionCatalog`, and `replacePermissions`.

- [ ] T065 [US2] Create `frontend/src/views/admin/RolesView.vue` showing the three roles with a
      permission grid grouped by module, a checkbox per action, and per-role save sending the full
      set plus `version`. A grant whose key is no longer in the catalog is shown as **stale** and
      dropped on save. Make FR-018 legible rather than surprising: disable the control with an
      explanation before submission where possible, and surface the server's reason when refused.

- [ ] T066 [US2] Apply `can()` across `frontend/src/layouts/AdminLayout.vue`,
      `frontend/src/views/admin/UsersListView.vue`, `UserFormView.vue`, and `RolesView.vue` so
      unavailable actions are hidden or disabled (FR-020) — **in addition to**, never instead of, the server checks. Treat a `403`
      reaching the client as a real error worth surfacing: it means the interface offered something
      the server refused, which is a defect.

- [ ] T067 [P] [US2] Add US2 i18n keys to `frontend/src/locales/en.json` and `ar.json`: role names and descriptions, module and
      action names for the permission grid, stale-grant wording, and the FR-018 refusal explanation.

- [ ] T068 [US2] Execute quickstart **V2** and **V3** and record the results. V2's third check — a
      direct `curl` to `/api/admin/users` with an Agent token returning `403` — is the one that
      matters; the first two are the interface being polite.

**Checkpoint**: PLAN.md Definition-of-done clause 2 is satisfied. US1 still works.

---

## Phase 5: User Story 3 — Security-Relevant Actions Are Recorded (Priority: P1)

**Goal**: Every security-relevant event produces a retrievable, immutable, credential-free audit
entry, filterable by an Administrator.

**Independent Test**: quickstart **V4** plus **A7**–**A9**. Perform one of each recorded action and
confirm each appears with the correct actor, target, timestamp, and outcome.

**Maps to**: FR-032–FR-041 · SC-005, SC-006, SC-008 · PLAN.md Definition of done clause 3 ("and see
an audit trail")

**This phase closes the time-boxed deviation Phase 0 recorded.** Phase 0 authenticated users but
persisted no audit record, and its plan required that gap close here — with evidence, not assertion.

### Tests for US3

- [X] T069 [US3] Create `backend/tests/audit/coverage.test.ts` (quickstart **A7**, SC-005) which
      **enumerates `AUDIT_ACTIONS` from T033** and exercises each trigger, asserting an entry
      appears. Because it iterates the constant rather than a hand-written list, an action added
      without a recording path fails the suite.

- [X] T070 [P] [US3] Create `backend/tests/audit/content.test.ts` (quickstart **A8**, SC-008)
      asserting no entry contains a password, hash, or token in **any** field including
      `previousValue`, `newValue`, and `metadata` — including a deliberate attempt to pass a
      password through `metadata`, which the redaction step must strip (FR-036).

- [X] T071 [P] [US3] Create `backend/tests/audit/immutability.test.ts` (quickstart **A9**) asserting
      no write route exists on the audit resource at any path or method — `POST`, `PATCH`, `PUT`,
      and `DELETE` against `/api/admin/audit` and `/api/admin/audit/:id` all return `404`.

- [X] T072 [P] [US3] Create `backend/tests/audit/transactional.test.ts` asserting that when the
      audit insert fails during a state change, the change **rolls back** and the caller receives an
      error — there is no path where the action succeeds unrecorded (FR-041, rule 5).

### Backend for US3

- [X] T073 [US3] Extend `backend/src/services/audit.service.ts` with `list({ page, pageSize, from,
      to, actorUserId, action, outcome })` returning `{ items, page, pageSize, total }` ordered
      **most recent first** with `pageSize` clamped to 100, and `distinctActions()` for populating
      the filter without a full scan (FR-039, FR-040).

- [X] T074 [US3] Add audit calls in `backend/src/services/user.service.ts` and
      `backend/src/services/role.service.ts` for every state-changing path built in Phases 3–4 — user created,
      updated, deactivated, reactivated, role changed, role permissions changed, password changed,
      password reset — each **inside the existing transaction** and carrying previous and new values
      where the action changes a role or a permission set (FR-034).

- [X] T075 [US3] Add `recordAuthEvent` calls in `backend/src/services/auth.service.ts` for the
      authentication paths: sign-in success, sign-in
      failure (**including when the identifier matches no account** — FR-037, so probing is visible),
      sign-out, account locked, and account unlocked. `actor_user_id` is null for unknown
      identifiers while `actor_email` preserves what was attempted.

- [X] T076 [US3] Create `backend/src/controllers/admin/audit.controller.ts` and
      `backend/src/routes/admin/audit.routes.ts` with `GET /audit` and `GET /audit/actions` behind
      `audit:view` (FR-038). **No write routes at any path** — append-only is enforced by their
      absence. Register in `backend/src/routes/admin/index.ts`.

### Frontend for US3

- [ ] T077 [P] [US3] Create `frontend/src/services/admin-audit.service.ts` exposing `list` and
      `actions`.

- [ ] T078 [US3] Create `frontend/src/views/admin/AuditLogView.vue` with columns timestamp, actor,
      action, target, outcome, and filters for date range, actor, action type, and outcome. Action
      names are **translated from their key** — the raw `user.role.changed` is never shown to a user.
      Previous and new values appear in an expandable detail row for role and permission changes.
      **No edit or delete affordance anywhere**: append-only should be visible in the interface, not
      merely enforced behind it.

- [ ] T079 [P] [US3] Add US3 i18n keys to `frontend/src/locales/en.json` and `ar.json`, including a translated label for
      **every** action key in `AUDIT_ACTIONS` — a missing one renders a raw machine key to an
      Administrator.

- [ ] T080 [US3] Execute quickstart **V4** and record the result: confirm the actions from V1–V3
      appear correctly, filter to one person over a date range in under a minute (SC-006), and
      confirm no edit or delete control exists.

**Checkpoint**: All three PLAN.md Definition-of-done clauses are now satisfied. The Phase 0 audit
deviation is closed with test evidence.

---

## Phase 6: User Story 4 — Account Security Policy Resists Guessing (Priority: P2)

**Goal**: Password policy is enforced with specific feedback, repeated guessing locks the account,
and the lockout reveals nothing about whether the account exists.

**Independent Test**: quickstart **V5** plus **A4**–**A6**. Weak and reused passwords are refused
with the failing rule named; repeated failures lock; Administrator unlock works.

**Maps to**: FR-022–FR-030, FR-050 · SC-007 · Constitution Principle II (account lockout)

### Tests for US4

- [X] T081 [P] [US4] Create `backend/tests/auth/password-policy.test.ts` (quickstart **A4**)
      asserting a too-short password, a reused password, and a wrong current password are each
      refused with the correct status and the **specific failing rule named** in `details[]`
      (FR-022–FR-024). Note the current-password failure is `401`, not `400` — it is a failed
      credential check, not a malformed request.

- [X] T082 [P] [US4] Create `backend/tests/auth/lockout.test.ts` (quickstart **A5**) asserting
      lockout at the threshold, refusal **with the correct password** while locked, automatic
      release after the period, counter reset on success, and Administrator unlock.

- [X] T083 [US4] Create `backend/tests/auth/no-enumeration.test.ts` (quickstart **A6**, SC-007) —
      **the security-critical test of this story**. Assert that wrong password, unknown account,
      locked account, and inactive account produce **byte-identical response bodies and status
      codes**. Any difference is an account-enumeration defect, not a cosmetic one (rule 4).

### Implementation for US4

- [X] T084 [US4] Create `backend/src/services/password.service.ts` exporting
      `validatePolicy(password)` returning per-rule failures rather than a boolean — the caller needs
      to name the failing rule (FR-022); `hash(password)` at bcrypt cost 12, unchanged from Phase 0;
      `isReused(userId, password)` comparing against the most recent `PASSWORD_HISTORY_SIZE` hashes;
      and `recordHistory(userId, hash, { transaction })` which **prunes** entries beyond the window
      so the table stays bounded and an old hash does not outlive its purpose (research.md D9).

- [X] T085 [US4] Extend `backend/src/services/auth.service.ts` login with lockout: increment
      `failed_login_attempts` on failure, set `locked_until` at the threshold, refuse while locked
      **even with the correct password**, and reset the counter on success (FR-026–FR-029).

- [X] T086 [US4] In `backend/src/services/auth.service.ts`, ensure the locked and inactive paths run
      a **bcrypt compare against the dummy hash** before returning, exactly as Phase 0's unknown-account path does. Skipping the hash
      would make those paths detectably faster and reintroduce the enumeration leak through timing
      (FR-030, rule 4). All four paths return the identical `invalidCredentials()`.

- [X] T087 [US4] Add `changePassword(userId, currentPassword, newPassword)` to
      `backend/src/services/auth.service.ts`: verify the current password, run policy and reuse
      checks, hash, clear `must_change_password`, record history, and write the audit entry — all in
      one transaction (rule 5).

- [X] T088 [US4] Add `resetPassword` to `backend/src/services/user.service.ts`: set the new hash,
      set `must_change_password`, reset the failure counter, clear any lock, record history, audit as
      `auth.password.reset`. The Administrator hands the password over out of band — there is no
      email until Phase 5 (spec Assumptions).

- [ ] T089 [P] [US4] Add US4 i18n keys to `frontend/src/locales/en.json` and `ar.json`: one message per policy rule, the
      change-password screen, and the unlock action. The generic sign-in failure message is
      unchanged and shared by all four failure paths — **do not add a "locked" message** (rule 4).

- [ ] T090 [US4] Execute quickstart **V5** and record the result. Confirm explicitly that the
      response after lockout is identical to a wrong password and **does not say the account is
      locked**, then confirm Administrator unlock grants immediate access.

**Checkpoint**: account security is enforced and the Phase 0 no-enumeration guarantee still holds.

---

## Phase 7: User Story 5 — Administration Area Is Navigable and Bilingual (Priority: P3)

**Goal**: The administration area is complete, works identically in Arabic and English, and is fully
operable from the keyboard.

**Independent Test**: quickstart **V6**, **V7**, **V8**. Navigate every admin screen in both
languages using only the keyboard.

**Maps to**: FR-042–FR-048 · SC-009, SC-010 · Constitution Principles I and IV

- [ ] T091 [US5] Create `frontend/src/views/admin/SettingsShellView.vue` with three sections —
      categories, templates, channel settings — each present, navigable, and showing an empty state
      saying plainly it is populated in a later phase (FR-043). **Not an error, not a blank panel,
      and not a "coming soon" that reads like a bug.**

- [ ] T092 [US5] Add the `settings:view` route to `frontend/src/router/index.ts` and its navigation
      entry to `frontend/src/layouts/AdminLayout.vue`, and confirm the administration
      area is not offered at all to a user holding none of its permissions (FR-042).

- [ ] T093 [P] [US5] Create `frontend/tests/locales/parity.test.ts` (quickstart **A13**,
      research.md D14) asserting `ar.json` and `en.json` hold identical key sets and no value is an
      empty string. This replaces Phase 0's manual `node -e` check, which worked at 14 keys and will
      not at ~140.

- [ ] T094 [P] [US5] Create `frontend/tests/components/admin/` component tests for `DataTable`
      (renders a real `<table>` with `scope="col"`, `aria-busy` while loading, empty state when no
      rows), `ConfirmDialog` (focus trapped, Escape dismisses, focus returned), and `FormField`
      (`aria-describedby` and `aria-invalid` wired on error).

- [ ] T095 [US5] Execute quickstart **V6** in a browser and record the result: every admin screen in
      Arabic with mirrored layout, every label, header, filter, status word, action name, empty
      state, and **validation message** translated. Trigger a validation error in each form —
      **error paths are where hardcoded strings hide.**

- [ ] T096 [US5] Execute quickstart **V7** in a browser and record the result: every control on
      every admin screen reachable and operable by keyboard, the deactivation dialog opening and
      dismissing with focus trapped and returned, and focus moving to the first invalid field on a
      failed submit. Repeat in Arabic — focus order must follow RTL visual order and the focus ring
      must be visible in both directions.

- [ ] T097 [US5] Execute quickstart **V8** and confirm each configuration section reads as
      intentional rather than broken.

**Checkpoint**: the constitution's per-phase Definition-of-done gate clauses 2 and 4 are satisfied.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T098 **Layering audit** (Constitution Principle III, quickstart **V9**). Confirm and record:
      `grep -rn "from '.*models" backend/src | grep -v "backend/src/services\|backend/src/models"`
      → empty; `grep -rn "fetch(" frontend/src/components frontend/src/views frontend/src/layouts`
      → empty. Then confirm by inspection that **no permission decision is made outside
      `authorization.service`** — `requirePermission` translates an answer, it does not compute one
      (rule 1).

- [ ] T099 [P] **Physical-utility audit** (Principle I). `grep -rnE "\b(ml|mr|pl|pr)-[0-9a-z]|\btext-(left|right)\b|\b(left|right)-[0-9]" frontend/src frontend/index.html`
      → must return nothing. Replace any hit with its logical equivalent (rule 7).

- [ ] T100 [P] **Scope audit** (rule 10). Confirm no MFA column, flow, or setting exists; no role
      create/rename/delete route or column exists; no per-user permission override exists; and
      `users` carries no `department_id` or `last_login_at`. These were ruled out by decision, and
      finding one means something was built that nobody asked for.

- [ ] T101 Add the four new environment variables to the root `README.md`, and extend its "where do
      I add a backend endpoint" section with the authorization step — a new protected route needs a
      catalog entry, a `requirePermission`, and a grant decision, or the matrix test T056 will fail
      it. That failure is the feature; the README should say so.

- [ ] T102 Run `npm run format` then `npm run lint` at the root and resolve every finding. Both must
      exit 0.

- [ ] T103 Run `npm test` and confirm all of quickstart **A1**–**A14** pass. Record the counts.
      **A1, A6, and A7 are the ones that matter most** — A1 is the Definition of done's second
      clause made mechanical, A6 protects the Phase 0 guarantee, and A7 is what closes the Phase 0
      audit deviation with evidence.

- [ ] T104 **Full quickstart run from a clean state**: `docker compose down -v`, delete
      `node_modules`, then execute quickstart Setup end to end, then walk **V1**–**V9**. Fix
      `quickstart.md` if any step is undocumented or out of order — the document is a deliverable,
      not notes.

- [ ] T105 Verify the constitution's per-phase Definition-of-done gate explicitly and record each:
      (1) all tasks marked done; (2) works in Arabic and English; (3) server-side permission checks
      verified, not just UI hiding; (4) screens pass basic WCAG 2.1 AA checks; (5) PLAN.md's Phase 1
      Definition of done satisfied and traceable to merged code.

- [ ] T106 Update `specs/002-phase-1-security-administration/checklists/requirements.md` if any
      accepted exception changed, and confirm plan.md's Complexity Tracking entries still describe
      what was built — particularly the two accepted costs (a locked account being indistinguishable
      from an unknown one, and authentication-path audit writes not being transactional). If either
      turned out differently in practice, the plan must say so rather than remaining aspirational.

- [ ] T107 Record carry-forwards for Phase 2 in
      `specs/002-phase-1-security-administration/checklists/requirements.md`: this phase's permission catalog is the pattern every
      later module extends, and **`data.exported` / `record.deleted` audit actions exist with no
      callers** — Phase 2 is the first phase that will have real records to delete, so it must wire
      them rather than inventing its own shape.

- [ ] T108 Commit all remaining work on `002-phase-1-security-administration`. Open a pull request
      against `main` (now the repository default branch). Do **not** merge until the user confirms
      the Definition-of-done gate in `.specify/memory/constitution.md` is met.

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 Setup (T001–T009)** — no dependencies; must be first.
- **Phase 2 Foundational (T010–T040)** — depends on Phase 1. **Blocks all five user stories.**
  Within it: T016 depends on T011–T015; models T017–T022 depend on the migrations; seeders
  T023–T026 depend on the models; T027 depends on T010 and T017–T018; T029–T031 depend on T028.
- **Phase 3 US1 (T041–T055)** — depends on Phase 2.
- **Phase 4 US2 (T056–T068)** — depends on Phase 2. T056's matrix test needs US1's routes to exist
  to assert against, so in practice run US1 first.
- **Phase 5 US3 (T069–T080)** — depends on Phase 2. T074 adds audit calls to paths built in Phases
  3–4, so it must follow them.
- **Phase 6 US4 (T081–T090)** — depends on Phase 2 only. Its backend half is independent of US1–US3.
- **Phase 7 US5 (T091–T097)** — depends on all earlier screens existing to audit them.
- **Phase 8 Polish (T098–T108)** — depends on everything.

### Critical path

T001 → T010 → T011–T015 → T016 → T021 → T027 → T029 → T030 → T044 → T046 → T056

Everything else hangs off that spine. T056 is the terminus because the matrix test is what proves
the Definition of done's second clause.

### Parallel opportunities

| Group | Tasks | Why safe |
|---|---|---|
| Test helpers | T004, T005, T006 | Three distinct new files |
| Models | T017, T018, T019, T020 | Separate files; T021–T022 must follow |
| US1 tests | T041, T042, T043 | Separate test files, all failing until implementation |
| US1 frontend services/stores | T048, T049 | Distinct files, no backend dependency |
| US2 tests | T057, T058, T059, T060 | Separate files |
| US3 tests | T070, T071, T072 | Separate files |
| US4 tests | T081, T082 | Separate files; T083 is worth doing alone and carefully |
| Locale additions | T054, T067, T079, T089 | Same two files — **NOT parallel with each other**, but each is parallel with its story's code |
| Polish audits | T099, T100 | Read-only inspection of different concerns |

**Note on locale files**: every story adds keys to the same two files. Those tasks are marked `[P]`
relative to their own story's code, not relative to each other. Two agents editing `en.json`
simultaneously will conflict.

### Cross-story parallelism

Once Phase 2 is done, US1, US2's roles work, and US4's backend can proceed simultaneously. US3's
T074 is the one genuine cross-story dependency — it instruments paths the other stories build.

---

## Implementation Strategy

### MVP first

1. **Phase 1 Setup** — tests can run.
2. **Phase 2 Foundational** — schema, permission mechanism, admin plumbing. **Blocking.**
3. **Phase 3 US1** — an Administrator can create users and assign roles.
4. **STOP and validate V1.** That is half of PLAN.md's Definition of done and a genuinely useful
   increment: the system supports more than one person.

### Incremental delivery

1. Setup + Foundational → mechanism ready
2. + US1 → Administrator creates users, assigns roles (**clause 1**, MVP)
3. + US2 → enforcement proven server-side (**clause 2** — and the matrix test that keeps it true)
4. + US3 → audit trail visible (**clause 3**; Phase 0's deviation closes here)
5. + US4 → password policy and lockout
6. + US5 → bilingual, accessible admin area
7. + Polish → audits, docs, full quickstart run

### Suggested MVP scope

**Phases 1–3 (T001–T055).** That yields a working multi-user system with real roles — the
prerequisite for every phase from 2 onward, since Phase 2's customer records need an owner.

---

## Notes

- **Tests are required this phase**, reversing Phase 0's decision. If you find yourself wanting to
  skip one, note that T056 and T083 are the two that would hurt most to lose: one proves the
  Definition of done, the other protects a security guarantee that is invisible when working and
  catastrophic when broken.
- **The audit-logging deviation from Phase 0 closes here.** It was recorded as time-boxed and must
  not be carried into Phase 2. T069 is the evidence.
- **Two accepted costs are deliberate, not oversights** — a locked account is indistinguishable from
  an unknown one (users cannot self-diagnose), and authentication-path audit writes are not
  transactional (a failed sign-in cannot be un-failed). Both are argued in plan.md Complexity
  Tracking. Do not "fix" either without revisiting that reasoning.
- Commit after each task or logical group. Stop at any checkpoint to validate a story on its own.
- Avoid: adding dependencies not named in research.md, adding columns or endpoints ruled out in
  Clarifications, and speculative abstraction for phases that do not exist yet.
