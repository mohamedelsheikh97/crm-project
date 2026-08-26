# Contract: Authorization Enforcement (Phase 1)

**Feature**: `002-phase-1-security-administration` | **Date**: 2026-08-26

This is the contract every later phase inherits. Phases 2–12 add modules; each one adds catalog
entries and applies the middleware described here. Nothing below is optional for a protected route.

---

## The rule

> **Every protected action verifies its permission on the server before the action is performed.**
> Hiding or disabling an interface control is never the only barrier.

FR-015 and PLAN.md's Definition of done both say this. It is the single thing this phase exists to
guarantee.

---

## Permission keys

Format: `module:action`, lowercase, underscore-separated within a segment.

```text
users:view            users:create           users:update
users:deactivate      users:reset_password
roles:view            roles:update_permissions
audit:view
settings:view
```

Declared in `backend/src/auth/permissions.ts` as a typed constant — the single source of truth for
enforcement, for the roles screen, and for the generated matrix test. A key that is not in the
catalog grants nothing, even if a row for it exists in `role_permissions`.

**Adding a module in a later phase**: extend the catalog constant, add default grants to the seeder,
and apply `requirePermission` to the new routes. No migration. The matrix test picks the new keys up
automatically and will fail until the grant decision is explicit — which is the point.

---

## Request pipeline

Order is fixed. Each stage assumes the previous one ran.

| # | Stage | Responsibility | Failure |
|---|---|---|---|
| 1 | `authenticate` | Verify the access token signature and type; load the user's **current** row | `401 UNAUTHENTICATED` |
| 2 | active check (within `authenticate`) | Reject a missing or inactive user | `401 UNAUTHENTICATED` — identical to stage 1, so deactivation is indistinguishable from an invalid session |
| 3 | `requirePasswordChange` | If `must_change_password`, allow only the three exempt routes | `403 PASSWORD_CHANGE_REQUIRED` |
| 4 | `requirePermission(key)` | Ask `authorization.service` whether the user's role grants `key` | `403 FORBIDDEN` |
| 5 | controller → service | Perform the action | per endpoint |

**Stage 1 reads the database.** The token carries `sub`, `email`, and `type` and nothing about
authorization (research.md D1). This is what makes FR-007 and FR-017 exact rather than bounded — a
deactivation or a permission change takes effect on the very next request.

**Stage 4 decides nothing itself.** The middleware calls
`authorization.service.roleHasPermission(roleId, key)` and translates the answer into a response.
Keeping the decision in a service is what satisfies Constitution Principle III, and it is what lets
D1's caching decision be revisited later without touching a call site.

---

## Exempt routes

Only these three are reachable while `must_change_password` is set:

```text
GET  /api/auth/me
POST /api/auth/change-password
POST /api/auth/logout
```

Unauthenticated routes are unaffected: `GET /api/health`, `POST /api/auth/login`,
`POST /api/auth/refresh`.

---

## Failure responses

All use the Phase 0 error envelope: `{ "error": { "code", "message", "details" } }`.

| Status | Code | When |
|---|---|---|
| `401` | `UNAUTHENTICATED` | No token, malformed token, expired, bad signature, wrong token type, **user not found**, **user inactive** |
| `403` | `PASSWORD_CHANGE_REQUIRED` | Authenticated, but must change password first |
| `403` | `FORBIDDEN` | Authenticated and permitted to be here, but the role lacks the required permission |
| `404` | `NOT_FOUND` | The resource does not exist **and** the caller had permission to look |
| `409` | `CONFLICT` | Optimistic-lock failure — the record changed since it was read |

### Two rules that are easy to get wrong

**FR-019 — a permission failure must not disclose existence.** When a caller lacks the permission to
view a resource, the response is `403` regardless of whether the target exists. `404` is returned
**only** when the caller was permitted to look and the thing genuinely is not there. Deciding
permission before existence is what makes this hold; reversing the order leaks through the status
code.

**Deactivation returns `401`, not `403`.** A deactivated user is not "authenticated but forbidden" —
their session is void. Returning `403` would confirm that a valid session existed, and would send
the frontend down a permission-error path rather than back to sign-in.

---

## Frontend obligations

The interface hides or disables what the user cannot do (FR-020) — **in addition to**, never instead
of, the server check.

- `GET /api/auth/me` returns the caller's role and resolved permission key set (research.md D13).
- The auth store holds that set; `usePermissions().can(key)` reads it.
- Route guards on `/admin/*` check `can(...)` for a first-line redirect. **A guard is a convenience,
  not a control** — the endpoint behind every guarded screen enforces the same permission.
- A `403 FORBIDDEN` reaching the client is a real error, not an expected state to swallow silently:
  it means the interface offered something the server refused, which is a defect worth surfacing.

---

## What the matrix test asserts (SC-003)

Generated from the catalog crossed with the three roles, so it cannot fall behind as modules are
added:

1. For every `(role, permission key)` pair, a request to an endpoint requiring that key returns a
   non-`403` status when the role holds it and `403` when it does not.
2. Every route registered under `/api/admin` requires at least one permission — a route with no
   `requirePermission` fails the suite.
3. Every catalog key is required by at least one route — a key nothing enforces is dead and fails.
4. An inactive user receives `401` on every protected route.
5. A user with `must_change_password` receives `403 PASSWORD_CHANGE_REQUIRED` on every route except
   the three exempt ones.

Assertions 2 and 3 are the ones that keep this honest over time. A Phase 6 developer who adds a route
and forgets the middleware gets a failing build, not a silent hole.
