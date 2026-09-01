# Contract: Portal API

**Feature**: `009-phase-8-customer-portal` | **Date**: 2026-09-01

Every endpoint this phase adds, in one document, mirroring what `routes/public/index.ts` does in code.

Three groups: the **portal** surface (customer, new realm), the **staff** additions (existing realm,
`portal:manage`), and the **unauthenticated** additions (none — stated explicitly, because that is the
useful fact).

---

## The realm boundary

Portal endpoints are mounted under `/api/portal` by `routes/portal/index.ts`, which applies
`authenticate-portal` once. Nothing else in the application mounts a portal route, and
`portal/endpoints.ts` declares the whole list so the router and the realm/scope tests read the same
source (D10).

**Authentication.** `Authorization: Bearer <token>`, where the token was signed with
`PORTAL_JWT_ACCESS_SECRET` and carries `type: 'portal-access'` and `sub = portal_accounts.id`.

**Every failure is the same 401.** Absent header, wrong scheme, expired, bad signature, a **staff**
token, a portal refresh token, an account that is `withdrawn`, an account whose contact was removed, a
customer that is deactivated, and a `session_epoch` behind the account's — all indistinguishable
(FR-009, FR-013). The middleware is deliberately not told which.

**Per-request freshness.** The middleware loads the account, its contact, and the contact's customer on
every request. No permission or status claim is ever read from the token (D10) — the same reasoning
`middleware/authenticate.ts` gives for staff.

**What `authenticate-portal` puts on the request:**

```text
req.portal = {
  accountId:  number
  contactId:  number
  customerId: number
  language:   'ar' | 'en' | null
}
```

No role. No permissions. No staff user. A portal request cannot be evaluated against the staff
permission catalog (FR-014), and `requirePermission` is never mounted on a portal route.

---

## Portal: session

### `POST /api/portal/auth/login`

Rate limit: `portal-auth`, keyed by IP.

**Request**: `{ email, password }`

**200**: `{ accessToken, expiresIn }` + refresh token as an HttpOnly cookie, matching Phase 1's
staff login shape.

**401** for: unknown address, address with no portal account, wrong password, withdrawn account,
locked account, deactivated customer. **One response for all six** (FR-006, SC-006) — a portal that
distinguishes them is an address-enumeration oracle for the organisation's whole customer list.

Failed attempts increment `failed_login_attempts`; the configured threshold sets `locked_until`
(FR-005) and writes `portal.account.locked`. A successful sign-in resets the counter and writes
`portal.login.success`; a failure writes `portal.login.failure`.

### `POST /api/portal/auth/refresh`

Rate limit: `portal-auth`. Refresh cookie in, new access token out. Refused if the token's
`session_epoch` is behind the account's (FR-060).

### `POST /api/portal/auth/logout`

Idempotent. Clears the cookie, writes an audit entry when the actor is knowable.

### `POST /api/portal/auth/logout-all`

Increments `session_epoch`. The customer's own "sign out everywhere" (FR-007).

### `POST /api/portal/auth/change-password`

Authenticated. `{ currentPassword, newPassword }` (FR-007).

### `POST /api/portal/auth/forgot-password` · `POST /api/portal/auth/reset-password`

Rate limit: `portal-auth`. **`forgot-password` always returns 204**, whatever the address (FR-006).
Reset tokens follow the invitation mechanics of D3 — hashed, single-use, expiring — and are delivered
only to the contact's own recorded address.

### There is no registration endpoint

Stated here because its absence is a requirement, not an omission (FR-002a). No route creates a
`portal_accounts` row except `POST /api/portal/invitations/:token/accept`, and that one requires a
token nobody can mint.

---

## Portal: invitation acceptance (unauthenticated)

### `GET /api/portal/invitations/:token`

Rate limit: `portal-invite`, keyed by IP. Returns the minimum needed to render the acceptance screen:
`{ customerDisplayName, email }`. Nothing about tickets, and nothing that confirms other facts about
the record.

**404-equivalent** for expired, accepted, revoked, and nonexistent — one identical response (FR-002c).

### `POST /api/portal/invitations/:token/accept`

**Request**: `{ password, language? }` → creates the `portal_accounts` row, sets `accepted_at`, signs
the customer in, writes `portal.invitation.accepted`.

The token is consumed (FR-002b): a replay gets the same identical refusal as an expired one. The
account is bound to the invitation's `customer_contact_id` and to nothing the caller supplied.

---

## Portal: requests

### `GET /api/portal/tickets`

Rate limit: `portal-read`. Lists **this contact's** tickets (FR-026).

```text
{ items: [{ reference, subject, state, raisedAt, lastChangedAt }], page, pageSize, total }
```

`state` is a customer state from `portal/customer-status.ts` (D7), never the internal status. No id —
`reference` is the handle everywhere (FR-065).

Scope is applied inside the query by `portalScope` (D5). A ticket with
`requesting_contact_id IS NULL` is absent, as is a colleague's (FR-026f, FR-017).

### `GET /api/portal/tickets/:reference`

The frozen projection — see [visibility-contract.md](./visibility-contract.md) for the exact key set
and the fields that must never appear.

A reference belonging to another customer, to a colleague, to an unassociated ticket, or to nothing at
all returns the **same 404** (FR-017). A merged-away reference resolves to the survivor **only if this
contact is associated with the survivor** (FR-032, FR-026j).

### `POST /api/portal/tickets`

Rate limit: `portal-submit` (FR-025), separate from `portal-read` so a flood of submissions cannot
stop a customer reading.

**Request**: `{ subject, description, category?, priority? }`

`category` and `priority` are validated against Phase 3's taxonomy and **refused** if out of range,
never coerced (FR-023). `customer_id` and `requesting_contact_id` come from the session and are
ignored if supplied (FR-015, FR-026b). `source: 'portal'`, `status: INITIAL_STATUS`,
`created_by_user_id: NULL`.

**Accepts no files** (FR-022). A multipart body is refused by the router, not silently ignored.

**201**: `{ reference }`.

### `POST /api/portal/tickets/:reference/replies`

Rate limit: `portal-reply`.

**Request**: `{ body }` — text only, no attachments (FR-022).

Writes a `messages` row: `channel: 'portal'`, `direction: 'inbound'`, `sender_identity` = the
contact's address, `author_user_id: NULL`. Participates in response-clock and automation behaviour
like any other inbound message (FR-035).

**On a `resolved` ticket**: reopens it via the system actor, `resolved → open` only (D9).
**On a `closed` ticket**: `409` with a code the interface renders as "raise a new request" — and the
body is **not** stored, so nothing is accepted and discarded (FR-036). The interface does not offer the
reply box at all in this state, so the 409 is a guard, not the normal path.

### `GET /api/portal/tickets/:reference/attachments/:attachmentId`

Rate limit: `portal-read`. Streams a message attachment (FR-033).

**This endpoint is new to the codebase, not a re-scoping** (D15). The service resolves session,
ticket, and attachment **together** — never `findByPk(attachmentId)` — and refuses anything outside
this contact's own correspondence, including internal files on a visible ticket and any file on a
colleague's ticket. Headers follow Phase 2's download controller: `Content-Disposition: attachment`,
`X-Content-Type-Options: nosniff`, storage directory never served.

---

## Portal: help content

### `GET /api/portal/kb/categories` · `GET /api/portal/kb/articles/:slug` · `GET /api/portal/kb/search`

Rate limits: `portal-read` for the first two, `portal-search` for search (FR-045).

These call **Phase 7's existing services** with `audience: 'customer'` and `status: 'published'` as
literals, exactly as `controllers/public/kb.controller.ts` does. Results are identical to the public
help centre's for the same query and language (FR-039). No parameter on any of these routes can widen
audience or lifecycle (FR-040).

By slug, never by id (FR-065) — Phase 7's rule, unchanged.

### `GET /api/portal/kb/suggestions?text=…`

Pre-submission deflection (FR-041). Phase 7's suggestion path with the customer's draft as the query.
Returns at most a handful; an empty result is a normal answer (FR-044) and never blocks submission
(FR-042).

---

## Portal: satisfaction

### `POST /api/portal/tickets/:reference/satisfaction`

**Request**: `{ score, comment? }` — `score` validated against the declared scale (D8), `comment`
optional, no files.

**201** on first submission. **409 `already_recorded`** on any subsequent one, surfaced from the unique
index rather than from a preceding read (FR-049).

**422** if the ticket is not `resolved` or `closed` (FR-047). **404** if this contact is not the
ticket's requester (FR-055) — the same 404 as a nonexistent reference.

Creates nothing when not called: no invitation record, no reminder, no effect on the ticket, its SLA
record, or any automation outcome (FR-051).

---

## Portal: profile

### `GET /api/portal/me`

`{ displayName, email, language }`. The contact's own address and its customer's display name.

### `PATCH /api/portal/me/language`

The only mutable field a customer has (FR-064). **Not** their name, address, contacts, or the email
their account is keyed to — Phase 2 owns customer data, and letting a customer change their own key
would let them move their identity.

---

## Staff additions (existing realm, `portal:manage`)

Mounted on the existing authenticated routers, with `requirePermission('portal:manage')` (FR-058,
FR-059).

| Endpoint                                                    | Purpose                                                         |
| ----------------------------------------------------------- | --------------------------------------------------------------- |
| `GET /api/customers/:id/portal-access`                      | Per contact: has account / invitation outstanding / locked out (FR-056) |
| `POST /api/customers/:id/contacts/:contactId/portal-invitations` | Issue an invitation (FR-002, FR-002f)                       |
| `DELETE /api/portal-invitations/:invitationId`               | Revoke an outstanding invitation                                |
| `POST /api/portal-accounts/:accountId/withdraw`              | Withdraw access; increments `session_epoch` (FR-060)            |
| `POST /api/portal-accounts/:accountId/restore`               | Restore a withdrawn account                                     |
| `POST /api/portal-accounts/:accountId/unlock`                | Release a lockout (FR-057)                                      |
| `POST /api/portal-accounts/:accountId/reset-credential`      | Send a reset; never reveals or sets a secret (FR-057)           |
| `PATCH /api/tickets/:id/requesting-contact`                  | Associate a ticket with a contact on **its own** customer (FR-026h, FR-057a) |

`PATCH /api/tickets/:id/requesting-contact` refuses a contact belonging to any other customer — an
association across customers is a cross-customer disclosure, and the FK cannot express the constraint.

Existing staff ticket responses gain `requestingContact` (FR-026i) so an agent can see who is able to
read the conversation in the portal.

Issuing an invitation to a **provisional** customer record is permitted and returns a warning field the
interface surfaces (FR-002f, research open question 2). The rule lives in the service, not the screen.

---

## Unauthenticated additions: none

Phase 8 adds **no** route to `routes/public/index.ts`. The three surfaces reachable without a session
remain Phase 5's webhooks and forms plus Phase 7's help centre.

The portal's own unauthenticated endpoints — login, refresh, forgot/reset password, and the two
invitation routes — live in the portal router and are individually marked, rather than being moved into
the public file. That keeps `routes/public/index.ts` meaning what its comment says it means: the
surface reachable by someone with **no** credential and no invitation. An invitation token is a
credential.

---

## Error shapes

Reuses `errors/app-error.ts` unchanged. Three codes are new:

| Code                  | Status | Used for                                                        |
| --------------------- | ------ | --------------------------------------------------------------- |
| `invitation_invalid`  | 404    | Expired, accepted, revoked, or nonexistent — all four (FR-002c)  |
| `ticket_settled`      | 409    | A reply attempted on a `closed` ticket (FR-036)                 |
| `already_recorded`    | 409    | A second satisfaction submission (FR-049)                       |

Everything else reuses existing codes. In particular there is **no** new "not yours" code: not-yours is
`not_found` (FR-017), and adding a distinct code would undo the property the 404 exists to provide.
