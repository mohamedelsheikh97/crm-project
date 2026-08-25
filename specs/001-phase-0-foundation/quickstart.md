# Quickstart: Phase 0 — Project Foundation

**Feature**: `001-phase-0-foundation` | **Date**: 2026-08-25

How to bring the foundation up and prove it satisfies PLAN.md's Phase 0 Definition of done.
Target: **under 10 minutes** from a clean clone (SC-001).

---

## Prerequisites

| Requirement | Verified version on this machine |
|---|---|
| Node.js 22 LTS | v22.17.1 |
| npm 10+ | 10.9.2 |
| Docker (for MySQL) | 29.6.2 |

No local MySQL install is needed — the database runs in a container (research.md D3).

---

## Setup

```bash
# 1. Environment file
cp .env.example .env
#    Then set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET to two DIFFERENT
#    random strings of at least 32 characters. Startup fails if they match.

# 2. Database
docker compose up -d
docker compose ps          # wait for the mysql service to report healthy

# 3. Dependencies (single install for both workspaces)
npm install

# 4. Schema and seed data
npm run db:migrate
npm run db:seed

# 5. Run both apps
npm run dev
```

Expected: backend on `http://localhost:3000`, frontend on `http://localhost:5173`.

---

## Validation

Each scenario maps to a spec acceptance scenario or success criterion. All checks are manual —
no automated test suite exists in this phase by decision (spec Clarifications, Q2).

### V1 — Both apps run locally

*Definition of done clause 1 · User Story 1 · SC-001*

```bash
curl http://localhost:3000/api/health
# Expect: {"status":"ok","database":"connected"}
```

Open `http://localhost:5173` — the app shell renders with no console errors.

### V2 — Startup fails loudly on a missing dependency

*User Story 1, Scenarios 2 and 3 · FR-005, FR-017*

```bash
docker compose stop
npm run dev:backend
# Expect: process exits with a message naming the database. It must not
# start in a half-broken state.
docker compose start

# Now remove a required variable from .env (e.g. JWT_ACCESS_SECRET) and retry.
# Expect: exit listing the missing variable by name. Restore it afterwards.
```

### V3 — Login returns both tokens

*Definition of done clause 2 · User Story 2, Scenario 1 · FR-002*

```bash
curl -i -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@crm.local","password":"ChangeMe123!"}'
```

Expect `200` with `accessToken` and `expiresIn: 900`, plus a `Set-Cookie: crm_refresh=...`
carrying `HttpOnly` and `SameSite=Strict`. Confirm no `password_hash` anywhere in the body.

### V4 — Protected route accepts a valid access token

*User Story 2, Scenario 2 · FR-003*

```bash
curl http://localhost:3000/api/auth/me -H "Authorization: Bearer <accessToken>"
# Expect: 200 {"id":1,"email":"admin@crm.local"}

curl -i http://localhost:3000/api/auth/me
# Expect: 401 UNAUTHENTICATED (no header)
```

### V5 — Bad credentials do not leak which field was wrong

*User Story 2, Scenario 7 · contracts/auth-api.md*

```bash
curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@crm.local","password":"wrong"}'

curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"nobody@crm.local","password":"wrong"}'
```

Both MUST return an identical `401` / `INVALID_CREDENTIALS` body. Any difference is an account
enumeration defect.

### V6 — Tampered and wrong-type tokens are rejected

*User Story 2, Scenarios 3–4 · Edge Cases*

```bash
# Flip the last character of a valid access token
curl -i http://localhost:3000/api/auth/me -H "Authorization: Bearer <tampered>"
# Expect: 401

# Present the refresh token where an access token belongs
curl -i http://localhost:3000/api/auth/me -H "Authorization: Bearer <refreshToken>"
# Expect: 401 — token types are not interchangeable
```

To check access-token expiry (Scenario 3), temporarily shorten the access lifetime to ~5s,
restart, and retry after it lapses.

### V7 — Refresh issues a new access token

*User Story 2, Scenarios 5–6 · FR-018*

```bash
curl -i -X POST http://localhost:3000/api/auth/refresh \
  -H 'Cookie: crm_refresh=<refreshToken>'
# Expect: 200 with a new accessToken

curl -i -X POST http://localhost:3000/api/auth/refresh
# Expect: 401 (no cookie)
```

### V8 — Language switch flips direction

*Definition of done clause 3 · User Story 3 · SC-003, SC-008*

In the browser at `http://localhost:5173`:

1. Confirm `<html lang="en" dir="ltr">` in DevTools.
2. Activate the language toggle. The layout mirrors to RTL and text becomes Arabic **without a
   page reload**, within about 1 second.
3. Confirm `<html lang="ar" dir="rtl">`.
4. Toggle back and confirm the reverse.

### V9 — Language choice survives reload with no flash

*User Story 3, Scenario 3 · FR-012, SC-004*

Switch to Arabic, then hard-reload. The app returns in Arabic/RTL, and there is **no visible
flash of LTR** during load.

### V10 — Shell is keyboard operable

*FR-024 · SC-007*

Using only <kbd>Tab</kbd>, <kbd>Shift</kbd>+<kbd>Tab</kbd>, <kbd>Enter</kbd>, and
<kbd>Space</kbd>: reach the language toggle, confirm a clearly visible focus indicator, activate
it, and confirm the language changes. Repeat in Arabic — focus order must follow RTL visual order.

### V11 — Database loss degrades rather than crashes

*Edge Cases*

```bash
docker compose stop
curl -i http://localhost:3000/api/health
# Expect: 503 {"status":"degraded","database":"disconnected"}
# The process must still be running.
docker compose start
```

### V12 — Layering and lint hold

*FR-004, FR-015 · Constitution Principle III*

```bash
npm run lint
```

Then confirm by inspection:

- No business logic in `backend/src/routes/` — routes only delegate to controllers.
- Only `backend/src/services/` touches models.
- No component under `frontend/src/components/` or `frontend/src/views/` calls `fetch`
  directly; all traffic goes through `frontend/src/services/`.
- No physical-direction Tailwind utilities (`ml-*`, `pl-*`, `text-left`) anywhere.

### V13 — CI reports pass/fail

*User Story 4 · FR-016, SC-005*

> **Blocked.** The repository currently has no commits and no remote (research.md D12), so this
> cannot be verified yet. Once a remote exists and a branch is pushed, confirm the workflow runs
> `npm ci`, lint, and build for both workspaces and reports a result within 5 minutes. Then push a
> deliberate syntax error and confirm it **fails** rather than silently passing.

---

## Definition-of-done coverage

| PLAN.md Phase 0 clause | Validated by |
|---|---|
| Both apps run locally | V1, V2 |
| Log in against a seeded test account, receive a valid JWT | V3, V4, V7 |
| Switching language flips layout direction | V8, V9 |

Supporting checks beyond the stated clauses: V5, V6 (security), V10 (accessibility), V11
(resilience), V12 (constitution compliance), V13 (CI — blocked).

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Backend exits naming the database | Container not healthy yet — `docker compose ps`, wait, retry |
| Backend exits naming a variable | `.env` incomplete; compare with `.env.example` |
| Startup rejects the JWT secrets | The two secrets are identical, or shorter than 32 characters |
| Login succeeds but refresh returns 401 | Cookie not sent — the frontend must use `credentials: 'include'`; check `CORS_ORIGIN` is the exact frontend origin, never `*` |
| Arabic renders but layout stays LTR | A physical Tailwind utility is in use, or `dir` is not on `<html>` |
| Brief LTR flash before Arabic appears | Locale is being read after mount instead of synchronously before it |
