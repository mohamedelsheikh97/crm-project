# API Contract: Administration (Phase 1)

**Feature**: `002-phase-1-security-administration` | **Date**: 2026-08-26

Base path **`/api`**, unversioned, as established in Phase 0 (FR-020 of that phase). All bodies are
`application/json` and all errors use the Phase 0 envelope. Every endpoint below is subject to
[authorization.md](./authorization.md) — the permission named in each section is enforced
server-side before the action runs.

`password_hash` and password history MUST NOT appear in any response.

---

## Auth additions

### `GET /api/auth/me` — extended

Phase 0 returned `{ id, email }`. It now carries what the interface needs to render correctly.

**Success — `200 OK`**

```json
{
  "id": 1,
  "email": "admin@crm.local",
  "fullName": "Admin",
  "role": { "key": "admin", "nameKey": "role.name.admin" },
  "permissions": ["users:view", "users:create", "roles:view", "audit:view", "settings:view"],
  "mustChangePassword": false
}
```

`permissions` is the resolved key set for the caller's role (research.md D13). Reachable while
`must_change_password` is set, so the frontend can read the flag and route accordingly.

---

### `POST /api/auth/change-password`

The signed-in user changes their own password. Requires authentication; requires no permission.

**Request**

```json
{ "currentPassword": "…", "newPassword": "…" }
```

**Success — `204 No Content`**. Clears `must_change_password`, writes a `password_history` entry,
and records `auth.password.changed`.

| Status | Code | Condition |
|---|---|---|
| `400` | `VALIDATION_ERROR` | `newPassword` fails policy — `details` names the specific rule (FR-022) |
| `400` | `VALIDATION_ERROR` | `newPassword` matches one of the last N passwords (FR-023) |
| `401` | `UNAUTHENTICATED` | `currentPassword` is wrong (FR-024) |

The current-password failure is `401` rather than `400`: it is a failed credential check, not a
malformed request.

---

## Users

### `GET /api/admin/users` — `users:view`

Query: `page` (default 1), `pageSize` (default 25, **max 100**), `search` (matches name or email),
`roleKey`, `isActive`.

**Success — `200 OK`**

```json
{
  "items": [
    {
      "id": 2,
      "email": "agent@crm.local",
      "fullName": "Support Agent",
      "role": { "key": "agent", "nameKey": "role.name.agent" },
      "isActive": true,
      "isLocked": false,
      "mustChangePassword": false,
      "createdAt": "2026-08-26T09:00:00.000Z",
      "version": 0
    }
  ],
  "page": 1,
  "pageSize": 25,
  "total": 2
}
```

`isLocked` is derived from `locked_until`, not stored. `version` is returned because every update
must echo it back (research.md D11).

### `GET /api/admin/users/:id` — `users:view`

`200` with the same object shape. `404 NOT_FOUND` if absent — and per
[authorization.md](./authorization.md), a caller lacking `users:view` gets `403` whether or not the
user exists.

### `POST /api/admin/users` — `users:create`

```json
{
  "email": "agent@crm.local",
  "fullName": "Support Agent",
  "roleKey": "agent",
  "initialPassword": "…"
}
```

**Success — `201 Created`** with the user object. Sets `must_change_password` to `true` (FR-010),
writes a `password_history` entry, and records `user.created`.

| Status | Code | Condition |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Malformed email, missing name, unknown `roleKey`, or `initialPassword` fails policy |
| `409` | `CONFLICT` | Email already exists — reported on the `email` field (FR-003) |

### `PATCH /api/admin/users/:id` — `users:update`

```json
{ "fullName": "…", "roleKey": "supervisor", "version": 0 }
```

`version` is required. A mismatch returns `409 CONFLICT` rather than overwriting (FR-011 edge case).
A role change records `user.role.changed` carrying both previous and new values (FR-034).

| Status | Code | Condition |
|---|---|---|
| `403` | `FORBIDDEN` | The caller is changing their own role away from administrative access (FR-008) |
| `409` | `CONFLICT` | Stale `version`, or the change would leave zero active Administrators (FR-009) |

### `POST /api/admin/users/:id/deactivate` — `users:deactivate`

**Success — `204 No Content`**. The user's sessions stop being honoured on their next request
(FR-007). Records `user.deactivated`.

| Status | Code | Condition |
|---|---|---|
| `403` | `FORBIDDEN` | The caller is deactivating their own account (FR-008) |
| `409` | `CONFLICT` | This is the last active Administrator (FR-009) |

### `POST /api/admin/users/:id/reactivate` — `users:deactivate`

`204`. Records `user.reactivated`. Deliberately shares the `users:deactivate` permission — the
ability to change an account's active state is one capability, not two.

### `POST /api/admin/users/:id/reset-password` — `users:reset_password`

```json
{ "newPassword": "…" }
```

`204`. Sets `must_change_password`, resets the failure counter, clears any lock, writes a history
entry, records `auth.password.reset`. The Administrator hands the password over out of band — there
is no email delivery until Phase 5.

### `POST /api/admin/users/:id/unlock` — `users:update`

`204`. Clears `locked_until` and the failure counter (FR-028). Records `auth.account.unlocked`.
Idempotent: unlocking an unlocked account succeeds.

---

## Roles

Read and permission-editing only. There is deliberately **no** `POST` or `DELETE` — the role set is
fixed (FR-021, Clarifications Q2). A request to create or delete a role returns `404`, because the
route does not exist.

### `GET /api/admin/roles` — `roles:view`

```json
{
  "items": [
    {
      "id": 3,
      "key": "admin",
      "nameKey": "role.name.admin",
      "descriptionKey": "role.description.admin",
      "permissions": ["users:view", "users:create", "…"],
      "userCount": 1,
      "version": 0
    }
  ]
}
```

Not paged — there are three rows and always will be.

### `GET /api/admin/permissions` — `roles:view`

The catalog, for rendering the permission grid (FR-014).

```json
{
  "modules": [
    {
      "key": "users",
      "nameKey": "permission.module.users",
      "actions": [
        { "key": "users:view", "nameKey": "permission.action.users.view" },
        { "key": "users:create", "nameKey": "permission.action.users.create" }
      ]
    }
  ]
}
```

Served from the code catalog, so the screen can never offer a permission nothing enforces.

### `PUT /api/admin/roles/:id/permissions` — `roles:update_permissions`

```json
{ "permissions": ["users:view", "audit:view"], "version": 0 }
```

Replaces the role's grants wholesale. Records `role.permissions.changed` with both previous and new
sets (FR-034). Effective immediately for every holder of the role — there is no propagation delay
(research.md D1).

| Status | Code | Condition |
|---|---|---|
| `400` | `VALIDATION_ERROR` | A key is not in the catalog |
| `403` | `FORBIDDEN` | The change would strip the caller's own administrative access (FR-008) |
| `409` | `CONFLICT` | Stale `version`, or the change would leave no role holding `roles:update_permissions` or `users:update` (FR-018) |

That last condition is what prevents the system being locked out of its own administration. It is
checked against the resulting state of *all* roles, not just the one being edited.

---

## Audit log

### `GET /api/admin/audit` — `audit:view`

Query: `page`, `pageSize` (max 100), `from`, `to` (ISO timestamps), `actorUserId`, `action`,
`outcome`. Always ordered most recent first (FR-039).

```json
{
  "items": [
    {
      "id": 1042,
      "action": "user.role.changed",
      "actor": { "id": 1, "email": "admin@crm.local" },
      "target": { "type": "user", "id": "2", "label": "agent@crm.local" },
      "outcome": "success",
      "ipAddress": "127.0.0.1",
      "previousValue": { "roleKey": "agent" },
      "newValue": { "roleKey": "supervisor" },
      "metadata": null,
      "createdAt": "2026-08-26T09:15:00.000Z"
    }
  ],
  "page": 1,
  "pageSize": 25,
  "total": 1042
}
```

`actor` is `null` for events with no authenticated actor — a failed sign-in against an unknown
identifier (FR-037). `actorEmail` is preserved on the row so the entry stays readable regardless.

**There is no `POST`, `PATCH`, or `DELETE` on this resource, at any path.** Append-only is enforced
by the absence of a write path, not by a check inside one (FR-035).

### `GET /api/admin/audit/actions` — `audit:view`

The distinct action keys, for populating the filter without a full scan.

---

## Cross-cutting

**Paging** — every list response carries `{ items, page, pageSize, total }`. `pageSize` is capped
server-side at 100; a larger request is clamped, not rejected. A default alone would not stop a
caller asking for everything (FR-040, FR-048).

**Optimistic locking** — `PATCH` and `PUT` require the `version` the caller last read. Mismatch is
`409 CONFLICT` with a message saying the record changed.

**Audit coupling** — for every state-changing endpoint above, the audit insert runs in the same
transaction as the change. If the audit write fails, the change rolls back and the caller gets a
`500` (research.md D4). There is no path where the action succeeds unrecorded.

**Timestamps** — ISO 8601 UTC in all responses.

**No credential ever leaves** — `password_hash`, password history, and token values appear in no
response body, no error message, and no audit field (FR-036).
