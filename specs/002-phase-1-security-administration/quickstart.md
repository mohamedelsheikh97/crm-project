# Quickstart: Phase 1 — Security & Administration Foundations

**Feature**: `002-phase-1-security-administration` | **Date**: 2026-08-26

How to bring Phase 1 up and prove it satisfies PLAN.md's Phase 1 Definition of done:

> An Administrator can create users, assign roles, and see an audit trail; permission checks are
> enforced server-side, not just hidden in the UI.

Unlike Phase 0, most of this is **automated**. A test framework lands in this phase (research.md
D8), so the V-checks below split into `npm test` and a smaller set of manual browser checks.

---

## Prerequisites

Phase 0's environment, unchanged: Node.js 22 LTS, npm 10+, Docker. See
[Phase 0 quickstart](../001-phase-0-foundation/quickstart.md).

---

## Setup

```bash
# From an existing Phase 0 environment
git checkout 002-phase-1-security-administration
npm install                # picks up vitest, supertest, @vue/test-utils, happy-dom

# New environment variables — append to your existing .env, or re-copy .env.example
#   PASSWORD_MIN_LENGTH=12
#   PASSWORD_HISTORY_SIZE=5
#   AUTH_MAX_FAILED_ATTEMPTS=5
#   AUTH_LOCKOUT_MINUTES=15
# All have defaults; startup fails only if a value is present and invalid.

docker compose up -d       # wait for healthy
npm run db:migrate         # roles, role_permissions, users columns, audit_logs, password_history
npm run db:seed            # three roles, default grants, admin@crm.local as an Administrator
npm run dev
```

**Expected**: the existing `admin@crm.local` / `ChangeMe123!` account still signs in and is now an
ordinary Administrator holding every permission through the role system (FR-049). Its Phase 0
password keeps working — the new policy applies at the next change, not retroactively (FR-050).

---

## Automated validation

```bash
npm test              # both workspaces
npm run test:coverage
```

| Check | Covers | What it asserts |
|---|---|---|
| **A1 — Permission matrix** | SC-003, FR-015 | Every catalog key × every role, driven through HTTP with no interface involved. Also asserts every `/api/admin` route requires a permission, and every catalog key is required by some route |
| **A2 — Inactive user** | FR-007, SC-011 | A deactivated user's existing token is refused on the next request, with `401` — not `403` |
| **A3 — Forced password change** | FR-010 | Every route except the three exempt ones returns `403 PASSWORD_CHANGE_REQUIRED` while the flag is set |
| **A4 — Password policy** | FR-022–FR-024 | Short passwords, reused passwords, and a wrong current password are each refused with the right code and the failing rule named |
| **A5 — Lockout** | FR-026–FR-029 | Lockout at the threshold; refused with the correct password while locked; automatic release after the period; counter reset on success |
| **A6 — No enumeration** | FR-030, SC-007 | Wrong password, unknown account, locked account, and inactive account produce **byte-identical** responses |
| **A7 — Audit coverage** | FR-032, SC-005 | Every action key in data-model.md is produced by exercising its trigger — the test enumerates the list, so an unrecorded event fails |
| **A8 — Audit content** | FR-036, SC-008 | No entry contains a password, hash, or token in any field, including `metadata` |
| **A9 — Audit immutability** | FR-035 | No write route exists on the audit resource at any path or method |
| **A10 — Last administrator** | FR-009, SC-012 | Deactivating, role-changing, or permission-stripping the last Administrator is refused by each path |
| **A11 — Optimistic locking** | FR-011 edge case | A stale `version` returns `409` and does not overwrite |
| **A12 — Paging cap** | FR-040, FR-048 | `pageSize=10000` is clamped to 100 |
| **A13 — Locale parity** | FR-044, SC-010 | `ar.json` and `en.json` key sets identical, no empty values |
| **A14 — Permission immediacy** | FR-017, SC-004 | A permission removed mid-session takes effect on the very next request |

**A1, A6, and A7 are the ones that matter most.** A1 is the Definition of done's second clause made
mechanical; A6 protects the guarantee Phase 0 established; A7 is what closes Phase 0's time-boxed
audit deviation with evidence rather than assertion.

---

## Manual validation

What a test cannot judge: whether it looks right, mirrors correctly, and is usable by keyboard.

### V1 — Administrator creates a user and assigns a role

_Definition of done clause 1 · User Story 1 · SC-001, SC-002_

Sign in as `admin@crm.local`, open **Administration → Users**, create a user with the Agent role.
Expect creation in under two minutes. Sign out, sign in as the new user, and confirm you are sent
straight to the change-password screen and cannot navigate away from it.

### V2 — Permission enforcement is visible and real

_Definition of done clause 2 · User Story 2 · SC-003_

As the Agent, confirm the administration area is absent from navigation. Then paste
`http://localhost:5173/admin/users` into the address bar: the guard redirects. Then call the
endpoint directly, bypassing the interface entirely:

```bash
curl -i http://localhost:3000/api/admin/users -H "Authorization: Bearer <agent access token>"
# Expect: 403 FORBIDDEN
```

The third check is the one that matters. The first two are the interface being polite; this one is
the server refusing.

### V3 — Permission change takes effect without signing out

_User Story 2, Scenario 3 · SC-004_

With a Supervisor signed in and viewing the audit log, remove `audit:view` from the Supervisor role
as an Administrator. The Supervisor's next request is refused — no sign-out, no wait.

### V4 — Audit trail is legible

_Definition of done clause 3 · User Story 3 · SC-006_

Open **Administration → Audit log**. Confirm the sign-ins, the user creation, and the role change
from V1–V3 all appear with actor, target, timestamp, and outcome. Filter to one person over a date
range and locate their actions in under a minute. Confirm action names are translated, not raw keys
like `user.role.changed`. Confirm there is no edit or delete control anywhere on the screen.

### V5 — Lockout, from the user's side

_User Story 4 · SC-007_

Fail sign-in five times against a real account. Confirm the response is identical to a wrong password
— **it does not say the account is locked**. This is deliberate (research.md D6): telling an
anonymous caller that an account is locked confirms the account exists. Then unlock it as an
Administrator and confirm immediate access.

### V6 — Every admin screen in Arabic

_Constitution Principle I · FR-044, FR-045 · SC-010_

Switch to Arabic and visit users list, user form, roles, audit log, and settings shell. Confirm every
label, table header, filter, status word, action name, empty state, and validation message is
Arabic; the layout mirrors; and no raw key appears. Trigger a validation error in each form and
confirm the message is translated too — error paths are where hardcoded strings hide.

### V7 — Every admin screen by keyboard

_Constitution Principle IV · FR-046, FR-047 · SC-009_

Using only <kbd>Tab</kbd>, <kbd>Shift</kbd>+<kbd>Tab</kbd>, <kbd>Enter</kbd>, <kbd>Space</kbd>, and
<kbd>Escape</kbd>: reach every control on every admin screen, open and dismiss the deactivation
dialog with focus trapped and returned, and submit a form with a validation error confirming focus
moves to the first invalid field. Repeat in Arabic — focus order must follow RTL visual order, and
the focus ring must be visible in both directions.

### V8 — Settings shell reads as intentional

_FR-043_

Open each of the three configuration sections. Each should say plainly that it is populated in a
later phase. A blank panel or an error is a failure of this check.

### V9 — Layering holds

_Constitution Principle III · FR-051_

```bash
npm run lint
grep -rn "from '.*models" backend/src | grep -v "backend/src/services\|backend/src/models"   # empty
grep -rn "fetch(" frontend/src/components frontend/src/views frontend/src/layouts            # empty
grep -rnE "\b(ml|mr|pl|pr)-[0-9a-z]|\btext-(left|right)\b" frontend/src                      # empty
```

Then confirm by inspection that no permission decision is made outside `authorization.service` —
`requirePermission` translates an answer, it does not compute one.

---

## Definition-of-done coverage

| PLAN.md Phase 1 clause | Validated by |
|---|---|
| "An Administrator can create users, assign roles" | V1, A10 |
| "and see an audit trail" | V4, A7, A8, A9 |
| "permission checks are enforced server-side, not just hidden in the UI" | V2, V3, A1, A2, A14 |

Constitution Definition-of-done gate (per phase):

| Gate clause | Validated by |
|---|---|
| All `/speckit-tasks` tasks marked done | tasks.md |
| Works in both Arabic (RTL) and English (LTR) | V6, V7, A13 |
| Server-side permission checks verified, not just UI hiding | V2, A1 |
| Screens pass basic WCAG 2.1 AA checks | V7 |
| PLAN.md Definition of done satisfied and traceable to merged code | the table above |

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Migration fails on `users.role_id` NOT NULL | The roles seeder has not run; migrations must be applied in the documented order (data-model.md) |
| Everyone gets `403` after seeding | Default grants were not seeded, or the catalog key in the route does not match the seeded key — the matrix test A1 pinpoints which |
| A permission change appears not to take effect | It does take effect on the next request. If the interface still shows the old state, the frontend has not refreshed `/auth/me` — the server is not stale (research.md D1) |
| A user cannot sign in and the message says the password is wrong | They may be locked or deactivated. All three responses are identical by design (FR-030). Check the users list or the audit log |
| A new route returns `403` for everyone including Administrators | Its permission key is not in the catalog, so nothing grants it. Add it to `permissions.ts` and to the seeder |
| Matrix test A1 fails after adding a route | Intentional. Either the route is missing `requirePermission`, or its key has no grant decision. Both are defects the test is designed to catch |
