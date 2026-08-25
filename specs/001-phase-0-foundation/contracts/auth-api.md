# API Contract: Authentication (Phase 0)

**Feature**: `001-phase-0-foundation` | **Date**: 2026-08-25

Base path: **`/api`** — unversioned in this phase per FR-020. No version segment until Phase 11.

All request and response bodies are `application/json`. All error responses share the envelope
defined at the end of this document (FR-007).

---

## `POST /api/auth/login`

Authenticates a user and issues both tokens. Implements FR-002.

**Request**

```json
{
  "email": "admin@crm.local",
  "password": "ChangeMe123!"
}
```

**Success — `200 OK`**

```json
{
  "accessToken": "<jwt>",
  "expiresIn": 900,
  "user": { "id": 1, "email": "admin@crm.local" }
}
```

Also sets the refresh cookie:

```http
Set-Cookie: crm_refresh=<jwt>; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=604800
```

`Secure` is appended whenever `NODE_ENV !== "development"`.

**Failures**

| Status | Condition | Notes |
|---|---|---|
| `400` | Missing or malformed `email`/`password` | Validation error, field names listed |
| `401` | No such user, **or** wrong password | Identical response for both — no account enumeration (User Story 2, Scenario 7) |

`password_hash` MUST NOT appear in any response.

---

## `POST /api/auth/refresh`

Exchanges a valid refresh token for a new access token. Implements FR-018.

**Request**: no body. Reads the `crm_refresh` cookie, so the caller MUST send
`credentials: 'include'`.

**Success — `200 OK`**

```json
{
  "accessToken": "<jwt>",
  "expiresIn": 900
}
```

**Failures**

| Status | Condition |
|---|---|
| `401` | Cookie absent |
| `401` | Refresh token expired (older than 7 days) — user must log in again |
| `401` | Signature invalid or tampered |
| `401` | Token has `type: "access"` instead of `"refresh"` — token-type confusion rejected |

A new refresh cookie is **not** issued here; the 7-day window is absolute, not sliding. This
bounds the damage from a stolen refresh token and is why SC-002a speaks of 7 days of *inactivity*.

---

## `POST /api/auth/logout`

Clears the refresh cookie.

**Success — `204 No Content`**, with:

```http
Set-Cookie: crm_refresh=; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=0
```

Always succeeds, including when no cookie was present — logout must be idempotent. Because
refresh tokens are not persisted in this phase, this clears the client's cookie but cannot
invalidate a copy already exfiltrated; true revocation lands in Phase 1 (see data-model.md).

---

## `GET /api/auth/me`

The protected reference route proving that access-token middleware works. Implements FR-003 and
serves as User Story 2's "protected test route".

**Request**

```http
Authorization: Bearer <accessToken>
```

**Success — `200 OK`**

```json
{ "id": 1, "email": "admin@crm.local" }
```

**Failures**

| Status | Condition |
|---|---|
| `401` | `Authorization` header absent or not `Bearer <token>` |
| `401` | Access token expired (older than 15 minutes) |
| `401` | Signature invalid or tampered |
| `401` | Token has `type: "refresh"` instead of `"access"` |

---

## `GET /api/health`

Unauthenticated liveness and dependency check. Supports User Story 1 and the Edge Case covering
a database connection lost while running.

**Success — `200 OK`**

```json
{ "status": "ok", "database": "connected" }
```

**Degraded — `503 Service Unavailable`**

```json
{ "status": "degraded", "database": "disconnected" }
```

Returning `503` rather than crashing is what the edge case requires.

---

## Error envelope

Every non-2xx response from the centralised error middleware uses one shape (FR-007):

```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Email or password is incorrect.",
    "details": []
  }
}
```

- `code` — stable, machine-readable; safe for the frontend to branch on.
- `message` — human-readable, safe to display. Localisation of these strings is a later-phase concern.
- `details` — per-field validation errors; empty for non-validation failures.

**Stack traces MUST NEVER appear in a response body** in any environment (FR-007). Unhandled
errors log at `error` level server-side and return a generic `500` with code `INTERNAL_ERROR`.

**Codes used in this phase**: `VALIDATION_ERROR` (400), `INVALID_CREDENTIALS` (401),
`UNAUTHENTICATED` (401), `NOT_FOUND` (404), `INTERNAL_ERROR` (500).

---

## Cross-cutting requirements

**CORS** — Credentialed requests forbid wildcard origins, so the server MUST echo the explicit
`CORS_ORIGIN` value and set `Access-Control-Allow-Credentials: true`. A `CORS_ORIGIN` of `*` MUST
be rejected at startup (see data-model.md).

**Request logging** — Every request logs method, path, status, and duration as JSON (FR-008), with
`password`, `authorization`, and `cookie` redacted.

**Route layering** — Each route delegates to a controller, which delegates to a service, which is
the only layer touching models (FR-004, Constitution Principle III). No business logic in route
handlers or models.
