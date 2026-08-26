# Phase 1 Research: Security & Administration Foundations

**Feature**: `002-phase-1-security-administration` | **Date**: 2026-08-26

Resolves every unknown in the plan's Technical Context, plus the three risks the spec's quality
checklist flagged for planning. Decisions here are binding for implementation.

## Observed starting state

Recorded because it constrains several decisions below.

| Observation | Implication |
|---|---|
| `users` has exactly `id`, `email`, `password_hash`, `created_at`, `updated_at` | Every column this phase needs must be added by migration |
| Access token: HS256, 15 min, claims `sub`/`email`/`type`; refresh token 7 days, `httpOnly` cookie | Token lifetime is far longer than FR-007's 60-second deactivation window — decisive for D1 |
| `authenticate` middleware verifies the signature and sets `req.user = { id, email }` — no database read | Must be extended to load current user state |
| Phase 0 login already compares against a real dummy hash for unknown accounts | The timing-equalisation pattern exists and must be extended to cover lockout (D6) |
| `defaultScope` excludes `password_hash`; only `auth.service` uses `withPassword` | The pattern to follow for any new sensitive column |
| `app.ts` exports the Express app without calling `listen` | Directly testable with `supertest`, no refactor needed (D8) |
| No test framework, no `tests/` directory | Greenfield; nothing to migrate |
| Locale files hold 14 keys each, flat dot-namespaced, parity checked by a manual `node -e` one-liner | Parity should become an automated test as key count grows roughly tenfold |
| CI runs `npm ci`, lint, build — no test stage, by Phase 0's FR-016 | The prohibition was conditional on no framework existing; it now does |

---

## D1. Where authorization state lives

**Decision**: The access token continues to answer **only "who is this"**. It gains no role and no
permission claims. On every protected request, `authenticate` loads the user's current row — active
state, role, and forced-password-change flag — and `authorization.service` resolves the role's
permissions from the database. Authorization staleness is **zero**.

**Rationale**: FR-016 requires decisions against currently stored permissions rather than token
claims. FR-007 and FR-017 cap the propagation of deactivation and permission changes at 60 seconds.
Phase 0's token lives 15 minutes, so a claims-based design would let a deactivated user keep working
for up to fifteen minutes — a direct FR-007 failure, and precisely the "permission gap found in
Phase 8" that Constitution Principle II's rationale warns about. A primary-key lookup plus a small
indexed join is a few hundred microseconds against a local MySQL; it is not a bottleneck at this
phase's load, and it converts a bounded-staleness guarantee into an exact one.

**Alternatives considered**:

- *Role and permission claims in the access token*: no per-request query, and the obvious reading of
  Phase 0's note that claims "arrive in Phase 1". Rejected because it cannot satisfy FR-007 without
  shortening the token to 60 seconds, which would multiply refresh traffic roughly fifteenfold to
  buy a weaker guarantee than the one a lookup gives for free.
- *A short-TTL in-process cache of role → permissions*: saves the join. Rejected for now under the
  constitution's YAGNI rule — it introduces an invalidation problem to optimise a system with no
  measured load. The service boundary is drawn so this can be added later behind
  `authorization.service` without touching a single call site.
- *Token version / generation counter, invalidating tokens on any change*: workable, but it needs
  its own persisted counter and still requires a read to check it — the same query cost, more moving
  parts.

**Consequence to implement**: `authenticate` becomes asynchronous and database-backed. A user row
that is missing or inactive produces the same `401` as a bad token, so deactivation is indistinguishable
from an invalid session to the caller.

---

## D2. Permission model shape

**Decision**: The **catalog** of permissions is a typed constant in
`backend/src/auth/permissions.ts` — a flat list of `module:action` string keys with the module and
action parsed from the key. The **grants** are rows in `role_permissions(role_id, permission_key)`.
A seeder reconciles default grants; unknown keys found in the table are ignored at decision time and
surfaced in the roles screen as stale.

**Rationale**: FR-012 requires the model to absorb new modules as later phases add them. A module
appears because code was written, not because an Administrator asked for it — so the catalog belongs
with the code and ships with it. Grants are genuinely data: an Administrator changes them at runtime,
so they belong in a table. Splitting on that line means Phases 2–12 add a module by adding catalog
entries and a seeder line, with no schema change and no risk that stored rows describe permissions
the code never checks.

**Alternatives considered**:

- *A `permissions` table joined to roles*: fully normalised, and lets the catalog change without a
  deploy — which is not a capability anyone wants, since a permission with no code enforcing it is a
  lie. Every new module in nine later phases would need a migration plus a seeder, and drift between
  table rows and the strings the code checks would be invisible until someone tested it.
- *A JSON column of permission keys on `roles`*: fewest tables. Rejected because "which roles grant
  `customers:delete`?" becomes a full scan with string matching, and there is no integrity
  constraint tying a grant to a role.

**Consequence to implement**: the catalog is the single source of truth for both the enforcement
check and the roles screen, which is also what makes the SC-003 matrix test generable (D8).

---

## D3. Role storage

**Decision**: A `roles` table with exactly three seeded rows — `agent`, `supervisor`, `admin` — each
carrying a stable string key and an i18n key for its display name. `users.role_id` is a non-null
foreign key. **No create, rename, or delete endpoint exists.**

**Rationale**: FR-021 fixes the set at three, but they still need identity: `role_permissions` joins
on a role id, and FR-014 requires editing each role's grants. A table gives that with referential
integrity. Display names must be translatable (Constitution Principle I), so the table stores a key
rather than a label.

**Alternatives considered**:

- *An enum column on `users`*: no join, but nothing to hang `role_permissions` off, and adding the
  fourth role later would mean a schema migration rather than a row.
- *Roles as another code constant like the permission catalog*: consistent with D2, but roles are
  the thing whose grants Administrators edit, so they must be addressable in the database anyway.

**Note**: this shape does not make custom roles easy by accident — it makes them a small additive
change *if* the decision is ever revisited, at no extra cost today.

---

## D4. Audit write semantics

**Decision**: Split by whether the audited event is part of a state change.

- **State-changing events** (user created, updated, deactivated, role assigned, role permissions
  changed, password changed or reset, record deleted, data exported) — the audit insert runs **inside
  the same database transaction** as the change it records. If the audit write fails, the whole
  transaction rolls back and the caller receives an error.
- **Authentication-path events** (successful sign-in, failed sign-in, sign-out, account locked,
  account unlocked by expiry) — written directly. A failure here logs at `error` level with the full
  event payload and increments a counter surfaced by the health endpoint. It does **not** roll back
  the authentication outcome.

**Rationale**: FR-041 forbids discarding an audit entry silently. For state changes the transaction
makes "it happened but was not recorded" unrepresentable, which is the strongest available guarantee
and costs nothing since the write is already in a transaction. Authentication events cannot honestly
be made transactional — a failed sign-in has already failed, and rolling back would not un-attempt
it. Pretending otherwise would be a worse answer than surfacing the failure loudly.

**Alternatives considered**:

- *Best-effort logging for everything*: one code path, and the common pattern. Rejected: it is
  exactly the silent gap FR-041 prohibits.
- *An outbox table with a background drainer*: survives database-level audit failures and decouples
  latency. Rejected as disproportionate — it adds a worker process and an at-least-once delivery
  problem to a phase with no measured throughput concern. Worth revisiting if audit volume becomes a
  write bottleneck.
- *Refusing the sign-in when its audit write fails*: consistent-sounding, but it converts an audit
  outage into a total authentication outage, including for the Administrator who would need to fix
  it.

---

## D5. Append-only enforcement for the audit log

**Decision**: Enforced at the application layer — the model exposes no update or destroy path, no
service method mutates an entry, and no endpoint accepts one. Documented as a deployment
recommendation: in any shared environment, grant the application's database user `INSERT` and
`SELECT` on `audit_logs` and withhold `UPDATE` and `DELETE`.

**Rationale**: FR-035 requires that no application screen or interface offers editing or deletion.
Application-layer enforcement satisfies that literally and keeps local development on a single
database user. A database grant is the only thing that would also stop someone with direct SQL
access, but that is an operational control rather than a code one, and forcing a second database user
into `docker-compose.yml` would work against Phase 0's SC-001 setup-time target.

**Alternatives considered**:

- *A database trigger rejecting `UPDATE`/`DELETE`*: enforces regardless of the caller. Rejected as
  the sole mechanism because MySQL triggers are invisible to the ORM and to code review — a
  maintainer would not know why a delete silently failed. Recorded as a reasonable production
  hardening step alongside the grant.
- *Hash-chaining each entry to its predecessor*: makes tampering detectable rather than merely
  disallowed. Genuinely valuable for a compliance posture, but no requirement asks for tamper
  *evidence*, and it introduces an ordering dependency on every insert. Deferred.

---

## D6. Lockout, and the enumeration guarantee

**Decision**: Failed attempts increment `users.failed_login_attempts`. On reaching the configured
threshold, `users.locked_until` is set to now plus the configured duration. While locked, sign-in is
refused **even with the correct password**, and the response is byte-identical to the response for a
wrong password and for an account that does not exist. The locked path performs a dummy bcrypt
compare so its timing matches the others. A successful sign-in resets the counter and clears the
lock.

**Rationale**: FR-027 and FR-030 together. Phase 0 established that a wrong password and an unknown
account are indistinguishable; lockout adds a third state, and if that state announced itself the
login form would become an account-existence oracle — the exact leak lockout exists to close. The
dummy compare matters because skipping the hash on a locked account would make it detectably faster.

**Alternatives considered**:

- *Return a distinct "account is locked" response*: friendlier, and what many products do. Rejected
  under FR-030. **The cost is real and is accepted deliberately**: a legitimate locked-out user
  cannot self-diagnose and must wait or contact an Administrator. The right fix is to notify the
  account owner out of band once email exists in Phase 5 — not to weaken the response.
- *Rate-limiting by source address instead of locking the account*: resists distributed guessing
  better and never locks a real user out. Rejected as a *replacement* because Constitution Principle
  II names account lockout specifically. Worth adding alongside lockout in a later hardening pass.

---

## D7. Policy configuration

**Decision**: Password policy and lockout parameters are environment variables, validated by the
existing zod schema in `backend/src/config/env.ts`: `PASSWORD_MIN_LENGTH` (default 12),
`PASSWORD_HISTORY_SIZE` (default 5), `AUTH_MAX_FAILED_ATTEMPTS` (default 5),
`AUTH_LOCKOUT_MINUTES` (default 15). All are added to `.env.example` with the same commentary style
Phase 0 used.

**Rationale**: FR-026 requires the threshold and duration be configurable without a code change, and
the constitution states the threshold is established in this phase. Environment variables satisfy
that with machinery Phase 0 already built and validates at startup. A settings *table* would be the
better long-term home, but Phase 1's system-configuration area is explicitly an empty shell
(FR-043) — a table with no screen to edit it is strictly worse than an environment variable, since
it is neither editable at runtime nor validated at startup.

**Alternatives considered**:

- *A `settings` table read at runtime*: editable without a restart, and where these values belong
  once the configuration screens gain content. Rejected for this phase because building the table
  without the screen delivers no capability the environment variables do not.
- *Hardcoded constants*: violates FR-026 outright.

**Consequence**: changing a threshold requires a restart. Acceptable and documented.

---

## D8. Test framework

**Decision**: **Vitest 4** configured at the repository root with one project per workspace.
Backend integration tests drive the exported Express app through **supertest 7** against a dedicated
`crm_support_test` schema with migrations applied and truncation between tests. Frontend component
tests use **`@vue/test-utils` 2** with **`happy-dom`**. Root scripts: `test`, `test:watch`,
`test:coverage`. CI gains a `npm test` step.

**Rationale**: Phase 0 shipped no framework by explicit user decision and recorded standing one up
as a Phase 1 recommendation; its plan flagged the gap as a real risk precisely because this phase
delivers RBAC. SC-003 is the forcing function — it requires every role × action combination verified
through a path that bypasses the interface, which is impractical by hand and would decay as Phases
2–12 add modules. Vitest is the natural choice against the installed Vite 8 (it declares support for
it), needs no separate transform pipeline for the TypeScript already in use, and covers both
workspaces with one tool. `app.ts` already exports the app without calling `listen`, so supertest
needs no production-code refactor.

**The matrix test is generated, not written**: it iterates the permission catalog from D2 crossed
with the three roles and asserts each endpoint's allow/deny outcome against the expected grant. A
module added in Phase 4 without a corresponding grant decision fails the suite rather than passing
silently. This is what makes SC-003 hold over time rather than on the day it was written.

**Alternatives considered**:

- *Jest + ts-jest*: the incumbent default, but it needs its own transform configuration for
  TypeScript ESM and duplicates the transform pipeline Vite already provides for the frontend.
- *Node's built-in test runner*: zero dependencies, and adequate for the backend. Rejected because
  the frontend still needs a component-testing story, and two runners is a worse outcome than one.
- *Deferring tests again to Phase 2*: rejected. The gap is already one phase old, and the code that
  most needs testing is the code being written now.

---

## D9. Password hashing and history

**Decision**: bcrypt at cost 12, unchanged from Phase 0. A `password_history` table stores the
previous hashes per user; on change, the candidate is compared against the most recent
`PASSWORD_HISTORY_SIZE` entries with `bcrypt.compare` and rejected on any match. Entries beyond the
window are pruned on write.

**Rationale**: FR-023 and FR-025. Reuse can only be checked by comparing against stored hashes —
there is no other way that does not involve storing something reversible. Pruning bounds the table
and limits how long an old hash survives.

**Alternatives considered**:

- *Argon2id*: stronger, and Phase 0's research recorded it as revisitable. Rejected again for the
  same reason — native build friction on the Windows development machine — and because changing the
  algorithm mid-project needs a rehash-on-login migration path that deserves its own decision rather
  than riding along with this phase.
- *Storing only the current hash and skipping reuse checks*: violates FR-023.

---

## D10. Forced password change

**Decision**: A `must_change_password` boolean on `users`, set when an Administrator creates a user
or resets a password. While set, `require-password-change` middleware refuses every authenticated
request except `GET /api/auth/me`, `POST /api/auth/change-password`, and `POST /api/auth/logout`,
returning `403` with a distinct code `PASSWORD_CHANGE_REQUIRED` so the frontend can route to the
change screen rather than guess.

**Rationale**: FR-010 requires the user reach no other screen first. Enforcing it server-side rather
than by frontend routing is the same principle as FR-015 — a router guard alone would be bypassable
by calling the backend directly. The distinct error code is what lets the interface respond
correctly without inspecting a message string.

**Alternatives considered**:

- *A one-time token issued at creation*: avoids the flag, but invents a second credential type for a
  single flow and complicates the Administrator handover.
- *Frontend-only enforcement via a router guard*: rejected outright — it is the "hidden in the UI"
  failure the Definition of done names.

---

## D11. Concurrent edits

**Decision**: Optimistic locking via Sequelize's `version` option on `users`, `roles`, and
`role_permissions` writes. A stale write affects zero rows and returns `409 CONFLICT` with a message
telling the caller the record changed.

**Rationale**: the spec's edge case requires that two Administrators saving conflicting changes must
not silently lose one. Optimistic locking is the cheapest correct answer for a low-contention admin
screen, needs no lock lifetime management, and Sequelize supports it directly.

**Alternatives considered**:

- *Last-write-wins*: the default, and silently loses the first write — which the edge case names.
- *Pessimistic row locks held across the edit*: correct but needs lock expiry and a release path for
  an Administrator who closes the tab.

---

## D12. Paging and audit log indexing

**Decision**: Offset paging with `page` and `pageSize` query parameters, `pageSize` capped at 100 and
defaulting to 25, responses carrying `{ items, page, pageSize, total }`. `audit_logs` is indexed on
`created_at`, on `actor_user_id`, and on `action`, with a composite on `(created_at, action)` for the
common filtered-by-type-over-a-range view.

**Rationale**: FR-039, FR-040, and FR-048. Capping `pageSize` server-side is what actually prevents
a caller from requesting the entire log; a default alone does not. Indexes match the four filters
FR-039 names.

**Alternatives considered**:

- *Keyset (cursor) paging*: materially better deep in a large table, and the right answer if the
  audit log grows into millions of rows. Rejected for now because the audit viewer is filtered and
  recent-first in practice, and offset paging with a capped size keeps the contract simple. Recorded
  as the first thing to change if the viewer slows.
- *Unbounded responses with client-side paging*: violates FR-040 directly.

---

## D13. Frontend permission surfacing

**Decision**: `GET /api/auth/me` is extended to return the caller's role and their resolved
permission key set. The auth store holds it; a `usePermissions()` composable exposes `can(key)` for
hiding or disabling controls. **Every such control's endpoint independently enforces the same
permission server-side.**

**Rationale**: FR-020 requires the interface to hide unavailable actions, and FR-015 requires that
this never be the only barrier. Returning the resolved set — rather than the role name plus a
client-side copy of the grant table — keeps a single source of truth on the server and means a
permission change is reflected as soon as the client refreshes its session state.

**Alternatives considered**:

- *Return the role name and let the frontend hold the permission matrix*: duplicates the grant table
  into the client bundle, where it goes stale the moment an Administrator edits a role.
- *Ask the server per control*: exact, but chatty and pointless given the set is small.

---

## D14. Locale key parity as a test

**Decision**: Replace Phase 0's manual `node -e` parity one-liner with a Vitest test asserting that
`ar.json` and `en.json` hold identical key sets, and that no value is an empty string.

**Rationale**: this phase adds roughly 120 keys per locale against Phase 0's 14. A manual check that
must be remembered will be forgotten, and FR-044 and SC-010 make parity a hard requirement — a key
present in one file and missing from the other renders a raw key to a user. Automating it is nearly
free once D8 exists.

**Alternatives considered**:

- *An ESLint rule*: no natural place to express a cross-file invariant.
- *Keeping the manual check*: it worked at 14 keys and will not at 140.

---

## Resolved-unknowns summary

| Technical Context item | Resolution |
|---|---|
| Authorization state location | Database per request; token stays claim-free (D1) |
| Permission model shape | Catalog in code, grants in `role_permissions` (D2) |
| Role storage | Three seeded rows in a `roles` table, no CRUD (D3) |
| Audit write failure semantics | Transactional for state changes; loud failure on auth paths (D4) |
| Append-only enforcement | Application layer, with a documented production grant (D5) |
| Lockout and enumeration | Locked responses identical to unknown-account responses (D6) |
| Policy configuration | Environment variables validated at startup (D7) |
| Test framework | Vitest 4 + supertest + `@vue/test-utils`; generated permission matrix (D8) |
| Password hashing and reuse | bcrypt 12 unchanged; `password_history` table (D9) |
| Forced password change | `must_change_password` flag enforced by middleware (D10) |
| Concurrent edits | Optimistic locking, `409` on conflict (D11) |
| Paging and indexing | Capped offset paging; indexes on all filtered columns (D12) |
| Frontend permission surfacing | `/auth/me` returns the resolved key set (D13) |
| Locale key parity | Automated test replaces the manual check (D14) |
