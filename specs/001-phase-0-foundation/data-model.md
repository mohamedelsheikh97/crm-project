# Data Model: Phase 0 — Project Foundation

**Feature**: `001-phase-0-foundation` | **Date**: 2026-08-25

Derived from the spec's Key Entities section. Phase 0 creates exactly **one** table. Per FR-006b,
roles, permissions, lockout counters, and audit-log tables are deliberately excluded and belong
to Phase 1's migration.

---

## Persisted entities

### `users`

The account record used for authentication. This is the only table the baseline migration creates.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `INTEGER UNSIGNED` | PK, auto-increment | Surrogate key |
| `email` | `VARCHAR(255)` | **UNIQUE**, NOT NULL | Login identifier (FR-006a) |
| `password_hash` | `VARCHAR(255)` | NOT NULL | bcrypt cost 12; never returned by any endpoint |
| `created_at` | `DATETIME` | NOT NULL | Sequelize `timestamps` |
| `updated_at` | `DATETIME` | NOT NULL | Sequelize `timestamps` |

**Validation rules**

- `email` MUST be normalised to lowercase before insert and before lookup, so `A@x.com` and
  `a@x.com` cannot both exist. Without this, the unique index is case-sensitively bypassable.
- `email` MUST match a standard email shape; rejected at the service layer before reaching the model.
- `password_hash` MUST NEVER be selected into an API response. Enforce with a `defaultScope`
  that excludes it, so forgetting to exclude it is not the failure mode.
- Minimum password length of 8 characters applies at the service layer on write. Full password
  policy (complexity, history, expiry) is Phase 1 per PLAN.md.

**Indexes**

- Unique index on `email` — created by the migration, not just declared on the model, so the
  guarantee holds against direct SQL writes (FR-006a).

**Relationships**

None in this phase. Phase 1 adds the role/permission associations; Phase 2 attaches customers.

**Explicitly deferred to Phase 1** (do not add now): `role_id`, `is_active`,
`failed_login_attempts`, `locked_until`, `last_login_at`, `mfa_secret`, `department_id`.

---

### Seed data

One development-only row, inserted by a seeder and referenced by `quickstart.md`:

| Field | Value |
|---|---|
| `email` | `admin@crm.local` |
| password | `ChangeMe123!` (hashed at seed time, never stored in plaintext) |

The seeder MUST be idempotent — re-running it must not create a duplicate or fail. The plaintext
password appears only in the seeder source and the quickstart guide, and this account MUST NOT be
created in any non-development environment.

---

## Non-persisted entities

These are runtime objects, not tables. Phase 0 stores no session state server-side (FR-006b, D5).

### Access Token

JWT, HS256, signed with `JWT_ACCESS_SECRET`, **15-minute** lifetime.

| Claim | Value |
|---|---|
| `sub` | `users.id` |
| `email` | User's email |
| `type` | `"access"` — rejected by the refresh endpoint |
| `iat` / `exp` | Issued-at / expiry (15 min) |

Transport: JSON response body; held in a non-persisted Pinia store on the client (D6). Carries no
role or permission claims — those arrive in Phase 1.

### Refresh Token

JWT, HS256, signed with a **separate** `JWT_REFRESH_SECRET`, **7-day** lifetime.

| Claim | Value |
|---|---|
| `sub` | `users.id` |
| `type` | `"refresh"` — rejected by protected-route middleware |
| `iat` / `exp` | Issued-at / expiry (7 days) |

Transport: `httpOnly`, `SameSite=Strict` cookie named `crm_refresh`, `Secure` when not in
development, `Path=/api/auth`.

**Why two secrets and a `type` claim**: either alone would allow token-type confusion. Distinct
secrets make cross-use cryptographically impossible; the `type` claim makes the rejection explicit
and testable, matching the spec's edge case on swapping the two token types.

Not persisted, therefore **not revocable** in this phase. Server-side revocation arrives in Phase 1.

### Application Configuration

Frozen object produced by validating `process.env` against a zod schema at startup (D8, FR-017).

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | yes | `development` \| `production` \| `test` |
| `PORT` | yes | Backend listen port |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | yes | MySQL connection |
| `JWT_ACCESS_SECRET` | yes | Min 32 chars; distinct from refresh secret |
| `JWT_REFRESH_SECRET` | yes | Min 32 chars; distinct from access secret |
| `CORS_ORIGIN` | yes | Explicit frontend origin; `*` MUST be rejected because credentialed CORS forbids wildcards |
| `LOG_LEVEL` | no | Defaults to `info` |

Frontend reads only `VITE_API_BASE_URL`, its single backend base path (FR-021).

The schema MUST assert that `JWT_ACCESS_SECRET !== JWT_REFRESH_SECRET`; equal secrets would
silently defeat the token-type separation above.

### Locale File

Flat-namespaced JSON per language at `frontend/src/locales/{ar,en}.json`. Keys are dot-namespaced
(`nav.home`, `auth.login.submit`). Both files MUST hold identical key sets; a key present in one
and missing from the other renders the raw key to the user. Fallback locale is `en` (D11, FR-010).

---

## State transitions

No entity in this phase has a lifecycle. The only meaningful runtime transition is the
authentication state the frontend store tracks:

```text
anonymous ──login success──> authenticated (access token in memory)
authenticated ──access token expires──> refreshing
refreshing ──refresh valid──> authenticated
refreshing ──refresh invalid/expired──> anonymous (re-login required)
authenticated ──logout──> anonymous (store cleared, refresh cookie cleared)
```

The `refreshing` state must be single-flight: concurrent requests hitting expiry share one refresh
call rather than each starting their own (D6).
