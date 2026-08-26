# Data Model: Phase 1 — Security & Administration Foundations

**Feature**: `002-phase-1-security-administration` | **Date**: 2026-08-26

Derived from the spec's Key Entities. Phase 1 adds **four tables** and extends `users`. Everything
here is additive to the Phase 0 schema; nothing is dropped or renamed.

Per Clarifications Q1 no MFA column is added, and per Q2 no role-management columns are added.

---

## Changes to `users`

Phase 0 created this table with five columns and deferred a named list to Phase 1. Those deferrals
are honoured selectively: the columns this phase's requirements actually need are added, and the
rest stay deferred rather than being added speculatively.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `full_name` | `VARCHAR(255)` | NOT NULL | Display name (FR-001). Backfilled from the email local-part for the Phase 0 account |
| `role_id` | `INTEGER UNSIGNED` | NOT NULL, FK → `roles.id` | Exactly one role per user (FR-004) |
| `is_active` | `BOOLEAN` | NOT NULL, default `true` | Deactivation instead of deletion (FR-006, FR-007) |
| `must_change_password` | `BOOLEAN` | NOT NULL, default `false` | Set on creation and on Administrator reset (FR-010, research.md D10) |
| `failed_login_attempts` | `INTEGER UNSIGNED` | NOT NULL, default `0` | Consecutive failures; reset on success (FR-029) |
| `locked_until` | `DATETIME` | NULL | Null means not locked (FR-026–FR-028) |
| `version` | `INTEGER UNSIGNED` | NOT NULL, default `0` | Optimistic locking (research.md D11) |

**Still deferred, and not added here**: `mfa_secret` (Clarifications Q1 — out of scope, and adding
the column would be the speculative schema the constitution prohibits), `department_id` (PLAN.md
places departments in Phase 12), `last_login_at` (the audit log answers "when did they last sign in"
without a denormalised column; adding one would create two sources of truth).

**Indexes added**: `role_id`, and `is_active` for the default active-users listing.

**Migration ordering note**: `role_id` is `NOT NULL` with a foreign key, so the roles seeder must run
before the column is made non-nullable. The migration adds it nullable, backfills every existing row
to the Administrator role, then applies the constraint.

---

## New tables

### `roles`

Exactly three rows, seeded and permanent (FR-011, FR-021, research.md D3).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `INTEGER UNSIGNED` | PK, auto-increment | |
| `key` | `VARCHAR(50)` | **UNIQUE**, NOT NULL | `agent` \| `supervisor` \| `admin` — the stable identifier code refers to |
| `name_key` | `VARCHAR(100)` | NOT NULL | i18n key for the display name, e.g. `role.name.agent`. Never a literal label (Constitution Principle I) |
| `description_key` | `VARCHAR(100)` | NOT NULL | i18n key for the roles screen |
| `created_at` / `updated_at` | `DATETIME` | NOT NULL | |

**Seeded rows**: `agent`, `supervisor`, `admin`. No endpoint creates, renames, or deletes a role;
attempts are refused (FR-021).

---

### `role_permissions`

Which permission keys each role holds. The **grant** side of research.md D2 — the catalog itself
lives in code, not here.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `INTEGER UNSIGNED` | PK, auto-increment | |
| `role_id` | `INTEGER UNSIGNED` | NOT NULL, FK → `roles.id`, `ON DELETE CASCADE` | |
| `permission_key` | `VARCHAR(100)` | NOT NULL | A `module:action` key from the catalog |
| `created_at` / `updated_at` | `DATETIME` | NOT NULL | |

**Indexes**: composite **UNIQUE** on `(role_id, permission_key)` — declared in the migration so a
duplicate grant is impossible even via direct SQL. Secondary index on `permission_key` to answer
"which roles grant this".

**Rows whose `permission_key` is not in the current catalog are ignored** when deciding access and
shown as stale in the roles screen. This is what lets a module be removed or renamed in a later
phase without invalidating the table (spec Edge Cases).

---

### `audit_logs`

Append-only. No update or delete path exists anywhere in the application (FR-035, research.md D5).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `BIGINT UNSIGNED` | PK, auto-increment | `BIGINT` because this table grows without bound in this phase |
| `action` | `VARCHAR(100)` | NOT NULL | A stable machine-readable key, e.g. `auth.login.success`, `user.role.changed` |
| `actor_user_id` | `INTEGER UNSIGNED` | NULL, FK → `users.id` | Null when the actor is unauthenticated — a failed sign-in against an unknown identifier (FR-037) |
| `actor_email` | `VARCHAR(255)` | NULL | Captured at the time of the event, so the entry stays readable if the account is later renamed |
| `target_type` | `VARCHAR(50)` | NULL | e.g. `user`, `role` |
| `target_id` | `VARCHAR(100)` | NULL | String so it can hold non-integer identifiers later |
| `target_label` | `VARCHAR(255)` | NULL | Human-readable descriptor captured at the time |
| `outcome` | `ENUM('success','failure')` | NOT NULL | FR-033 |
| `ip_address` | `VARCHAR(45)` | NULL | Sized for IPv6 |
| `user_agent` | `VARCHAR(255)` | NULL | Truncated on write |
| `previous_value` | `JSON` | NULL | Set for role and permission changes (FR-034) |
| `new_value` | `JSON` | NULL | Set for role and permission changes (FR-034) |
| `metadata` | `JSON` | NULL | Action-specific detail, e.g. exported record count |
| `created_at` | `DATETIME` | NOT NULL | No `updated_at` — an append-only row is never updated |

**Indexes**: `created_at`; `actor_user_id`; `action`; composite `(created_at, action)` for the common
filtered-over-a-range view (research.md D12).

**Prohibited content (FR-036)**: no column may contain a password, a password hash, a token, or a
cookie value — in any field, including `previous_value`, `new_value`, and `metadata`. A password
change records **that** it happened, never what changed. The audit writer strips a deny-list of keys
before serialising, so a careless caller cannot leak a credential through `metadata`.

**Recorded actions (FR-032)**, at minimum:

| Key | Trigger |
|---|---|
| `auth.login.success` | Successful sign-in |
| `auth.login.failure` | Failed sign-in, including unknown identifiers |
| `auth.logout` | Sign-out |
| `auth.password.changed` | User changed their own password |
| `auth.password.reset` | Administrator reset another user's password |
| `auth.account.locked` | Lockout threshold reached |
| `auth.account.unlocked` | Administrator unlocked, or lockout expired |
| `user.created` | Account created |
| `user.updated` | Account details changed |
| `user.deactivated` / `user.reactivated` | Active state changed |
| `user.role.changed` | Role assignment changed — carries previous and new |
| `role.permissions.changed` | A role's grants changed — carries previous and new |
| `data.exported` | Any export — carries the record count in `metadata` |
| `record.deleted` | Any deletion |

The last two exist now with no callers, because the modules that export and delete arrive in later
phases. They are defined here so those phases record audit entries in the established shape rather
than inventing their own.

---

### `password_history`

Supports the reuse check and nothing more (FR-023, research.md D9).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `INTEGER UNSIGNED` | PK, auto-increment | |
| `user_id` | `INTEGER UNSIGNED` | NOT NULL, FK → `users.id`, `ON DELETE CASCADE` | |
| `password_hash` | `VARCHAR(255)` | NOT NULL | A previous bcrypt hash |
| `created_at` | `DATETIME` | NOT NULL | |

**Index**: `(user_id, created_at)` — the reuse check reads the most recent N for one user.

**Pruning**: on each write, entries beyond `PASSWORD_HISTORY_SIZE` for that user are deleted, so the
table stays bounded and an old hash does not outlive its purpose.

**Never exposed.** No endpoint returns any part of this table, and the model carries a `defaultScope`
excluding `password_hash` in the same way `users` does.

---

## Permission catalog (code, not schema)

Declared in `backend/src/auth/permissions.ts` as a typed constant. Keys are `module:action`.

| Module | Actions | Notes |
|---|---|---|
| `users` | `view`, `create`, `update`, `deactivate`, `reset_password` | Administration of accounts |
| `roles` | `view`, `update_permissions` | No `create`/`delete` — the set is fixed (FR-021) |
| `audit` | `view` | Reading the audit log (FR-038) |
| `settings` | `view` | The configuration shell (FR-043) |

Twelve keys today. Later phases add modules (`customers:*`, `tickets:*`, …) by extending this
constant and adding a seeder line — no migration.

**Default grants seeded per role**:

| Role | Grants |
|---|---|
| `admin` | All catalog keys |
| `supervisor` | `audit:view`, `settings:view`, `users:view` |
| `agent` | None of the above — Agents administer nothing in this phase |

**Protected grants (FR-018)**: `users:*` and `roles:update_permissions` may not be removed from
every role simultaneously. The role service refuses any change that would leave no role holding
`roles:update_permissions` or `users:update`, which is what prevents the system being locked out of
its own administration.

---

## Entity relationships

```text
roles 1 ──── * users                    (users.role_id, NOT NULL)
roles 1 ──── * role_permissions         (cascade on role delete — unreachable, roles are fixed)
users 1 ──── * password_history         (cascade on user delete — unreachable, users deactivate)
users 1 ──── * audit_logs               (actor_user_id, NULLABLE — unauthenticated events)
```

Users are deactivated rather than deleted (FR-006), so the cascades above exist for schema
correctness rather than as expected paths. This is deliberate: an audit entry must never lose its
actor.

---

## Migration from Phase 0

Applied in this order, as separate migrations so each is independently reversible:

1. Create `roles`; seed the three rows.
2. Create `role_permissions`; seed the default grants above.
3. Add `users` columns as nullable; backfill (`full_name` from the email local-part, `role_id` to
   `admin`, `is_active` true, counters zero); apply `NOT NULL` and the foreign key.
4. Create `audit_logs`.
5. Create `password_history`.

**The Phase 0 seeded account** (`admin@crm.local`) becomes an ordinary Administrator — a real row
with `role_id` pointing at `admin`, holding no privilege outside the role system (FR-049). Its
`must_change_password` is **not** set by the migration, so an existing development environment keeps
working; the seeder that creates it fresh does set it.

**Existing passwords are not invalidated** by the new policy (FR-050). `PASSWORD_MIN_LENGTH` applies
at the next password change; the Phase 0 seed password remains usable until changed.

---

## Configuration added

Extends the frozen config object Phase 0 established. Validated by the same zod schema at startup,
so a bad value fails fast rather than at first use (research.md D7).

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PASSWORD_MIN_LENGTH` | no | `12` | Minimum characters (FR-022) |
| `PASSWORD_HISTORY_SIZE` | no | `5` | How many previous passwords are refused (FR-023) |
| `AUTH_MAX_FAILED_ATTEMPTS` | no | `5` | Consecutive failures before lockout (FR-026) |
| `AUTH_LOCKOUT_MINUTES` | no | `15` | Lockout duration (FR-026, FR-028) |

Each must be a positive integer; `PASSWORD_MIN_LENGTH` is additionally floored at 8 so the policy
cannot be configured below the level Phase 0 recorded as its service-layer minimum.

---

## State transitions

### User account

```text
active ──deactivated by admin──> inactive      (sessions stop being honoured within 60s)
inactive ──reactivated by admin──> active
active ──N consecutive failures──> locked      (locked_until set; audit entry written)
locked ──lockout period elapses──> active      (no admin action needed)
locked ──admin unlock──> active                (audit entry written)
any ──admin resets password──> must_change_password
must_change_password ──user sets new password──> normal
```

A locked account and an inactive account both refuse sign-in, but they are distinct: lockout is
temporary and self-clearing, deactivation is deliberate and permanent until reversed. **Neither is
distinguishable from the outside** — both produce the same response as a wrong password (FR-030,
research.md D6).

### Role permissions

```text
granted ──admin removes──> not granted         (effective immediately for every holder of the role)
not granted ──admin adds──> granted            (effective immediately)
```

There is no propagation delay to model. Because authorization reads current state on every request
(research.md D1), the 60-second budget FR-017 allows is spent at zero.
