# Contract: The Published Interface (`/api/v1`)

**Feature**: Phase 11 — Integrations | **Audience**: an integrator outside this organisation

This is the contract. Once an external system reads a shape described here, the shape is a promise —
so the rules about what may change, and how, come first.

---

## 1. Versioning

The version is a path segment: `/api/v1/...`.

- **A request without a version is not served.** There is no default. `/api/customers` is the
  system's own internal interface and requires a staff session, so a client credential presented
  there is refused — the absence of a version cannot be silently interpreted as "the newest one".
- **Every response carries `X-CRM-API-Version: 1`.** Redundant with the path by design: a response
  captured in a log or forwarded in a support ticket still says what produced it.
- **A withdrawn version answers `410 Gone`** with the currently available versions listed in the
  body. Never a redirect to another version, and never another version's shape under the old path.

### What may change inside a version

| Change                                          | Breaking? |
| ----------------------------------------------- | --------- |
| Adding a field to a response                    | No        |
| Adding an optional query parameter              | No        |
| Adding a new endpoint                           | No        |
| Adding a value to an enumerated field           | **Yes**   |
| Removing or renaming a field                    | **Yes**   |
| Changing a field's type or its meaning          | **Yes**   |
| Making an optional parameter required           | **Yes**   |
| Tightening validation on an existing parameter   | **Yes**   |

**Clients must tolerate unknown fields.** A client that fails on a field it does not recognise has
made every addition breaking, which defeats the purpose of the table above.

Adding an enum value is listed as breaking, which is stricter than many APIs. The reason is specific:
a client that switches on `status` and throws on an unrecognised value will break on a new ticket
status, and this system has added statuses before. Callers should not have to guess whether we
consider that our problem.

### Support window

A superseded version remains available for **at least 12 months** from the date its successor becomes
current. During that window the system can report which credentials are still using it (FR-004), so
nobody has to guess whether anyone would notice its removal.

---

## 2. Authentication

```http
GET /api/v1/customers HTTP/1.1
Authorization: Bearer crmc_a1b2c3d4.dGhpcyBpcyBub3QgYSByZWFsIHNlY3JldA
```

The bearer value is `<client_id>.<secret>`. The client identifier is the part before the first dot; it
is not secret and appears in audit records. The secret is 32 random bytes, base64url-encoded, shown
**once** at issuance and never retrievable afterwards.

- **Rotation.** During a rotation overlap (24 hours by default) the previous secret is still accepted,
  so a client can be updated without a failed request.
- **Revocation** takes effect on the next request.
- **Staff sessions are refused here.** `/api/v1` accepts client credentials only, and client
  credentials are accepted nowhere else. The realms do not overlap.

Missing, malformed, unknown and revoked credentials all answer `401` with the same body. A client
cannot use the refusal to learn whether an identifier exists.

---

## 3. Authority

A credential carries an explicit list of permissions, drawn from the same catalogue used for people —
`customers:view`, `tickets:view`, `reports:view`, `reports:view_agents`. There is no separate scope
vocabulary.

- Lacking the permission for an endpoint answers **`403`**, with a body naming the permission
  required. A `403` is never substituted with an empty list: "you may not see this" and "there is
  nothing here" are different answers and a client must be able to tell them apart.
- **Agent performance figures are absent, not withheld**, for a credential without
  `reports:view_agents` — `404`, matching the decision Phase 10 made for the same figures on screen.
- A credential cannot hold more authority than the administrator who issued it held at issuance.

---

## 4. Paging

Keyset paging. Every collection endpoint accepts:

| Parameter  | Type    | Notes                                                    |
| ---------- | ------- | -------------------------------------------------------- |
| `limit`    | integer | 1–200, default 50                                        |
| `cursor`   | string  | Opaque. Echo back exactly what `next_cursor` gave you    |
| `since`    | RFC 3339 timestamp | Records changed at or after this moment       |

```json
{
  "data": [ ... ],
  "paging": {
    "next_cursor": "eyJ1IjoiMjAyNi0wOS0wMlQxNDoxMjowMFoiLCJpIjo0MjF9",
    "has_more": true
  }
}
```

- **The cursor is opaque.** It encodes an ordering position and its contents are not part of the
  contract. Construct one and it will break.
- **`has_more: false` means the page is the last one**, and `next_cursor` is absent. Do not infer the
  end from a short page: a page may be short and still have more.
- **Ordering is by last-modified time, ascending, with the record identifier as tiebreaker.** This is
  what makes paging stable while records are being written: a record created mid-traversal appears at
  the end rather than shifting the pages behind it.
- **`since` and `cursor` together**: `since` sets the floor and `cursor` continues within it. Passing
  a `cursor` from a different `since` is refused rather than silently reinterpreted.

### Reconciling after an outage

Store the highest last-modified timestamp you have processed. On reconnection, request with
`since=<that timestamp>` and page to the end. This returns records changed while you were away —
including records created long ago whose fields changed — without reading the collection.

The overlap is deliberate: `since` is inclusive, so you will re-receive the boundary record. Records
are idempotent to re-process by identifier, which is cheaper than the alternative of an exclusive
bound that can skip a record written in the same second.

---

## 5. Errors

One shape, and it is the same shape this system uses internally.

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "This credential does not hold reports:view.",
    "details": [{ "field": "permission", "message": "reports:view" }]
  }
}
```

| Status | `code`                | Means                                                     |
| ------ | --------------------- | --------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`    | A parameter is malformed. `details` names each field       |
| 401    | `UNAUTHENTICATED`     | Credential missing, malformed, unknown, expired or revoked |
| 403    | `FORBIDDEN`           | Authenticated, but the credential lacks the permission     |
| 404    | `NOT_FOUND`           | No such record — **or** the record is outside this credential's reach |
| 409    | `CONFLICT`            | Reserved. No version-1 read endpoint returns it            |
| 410    | `GONE`                | This interface version has been withdrawn                 |
| 413    | `PAYLOAD_TOO_LARGE`   | The requested range is too large to serve                 |
| 429    | `RATE_LIMITED`        | Too many requests. `Retry-After` states when              |
| 500    | `INTERNAL_ERROR`      | Our fault. No detail, deliberately                        |

**`code` is the contract; `message` is for a human reading a log.** Branch on `code`. The message
wording may change without a version bump, and it is English regardless of any `Accept-Language` —
a machine consumer has no language, and making behaviour depend on a header would be worse than a
fixed one.

**`404` deliberately conflates "does not exist" with "not yours".** Distinguishing them would let a
client enumerate identifiers to learn which records exist outside its reach.

**`500` carries no detail and no stack trace**, on either interface.

---

## 6. Rate limiting

Per credential: **600 requests per 5 minutes** by default.

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 42
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 0
```

`429` is distinguishable from `403` by design (FR-011): one means slow down, the other means you
never had access, and a client that confuses them either gives up when it should retry or hammers
when it should stop.

Subscribing to notifications is the way to avoid the limit. A client polling every minute for changes
is the load this interface will otherwise mostly serve.

---

## 7. Endpoints

All are `GET`. **The interface is read-only in version 1** — no `POST`, `PUT`, `PATCH` or `DELETE` is
mounted, and a test asserts that. Widening it is an additive change in a later version, not a quiet
addition to this one.

### Customers — requires `customers:view`

| Endpoint                       | Returns                                            |
| ------------------------------ | -------------------------------------------------- |
| `GET /api/v1/customers`        | Paged customer summaries. `since`, `cursor`, `limit` |
| `GET /api/v1/customers/{id}`   | One customer with its contacts                     |

### Tickets — requires `tickets:view`

| Endpoint                        | Returns                                                     |
| ------------------------------- | ----------------------------------------------------------- |
| `GET /api/v1/tickets`           | Paged ticket summaries. Also filters by `status`, `category`, `priority`, `customer_id` |
| `GET /api/v1/tickets/{id}`      | One ticket, including its SLA outcome as recorded            |
| `GET /api/v1/tickets/{id}/messages` | Paged correspondence on the ticket                      |

**A merged ticket is returned normally, with `merged_into_ticket_id` set.** Not an error, and never
a copy of the survivor.

This corrects an earlier draft of this contract, which specified `409`. The reasoning behind that was
sound — a client receiving a duplicate of the survivor would count the same work twice, and nothing
would correct it — but the conclusion did not follow. Returning the requested ticket with its pointer
is not a duplicate of anything: the client sees the ticket it asked for, sees that it was absorbed,
and has the survivor's identifier in a field rather than buried in an error's details.

It is also what the screens do, and FR-010 requires the two surfaces to tell the same story about a
merge. `409` would have introduced exactly the divergence it was meant to prevent.

Merged tickets appear in the **collection** too, unlike the internal working list which excludes them
(a queue full of redirects is not a queue). A synchronising client must learn that a ticket it holds
was absorbed; hiding the row would leave its copy open forever.

### Reporting — requires `reports:view`

| Endpoint                        | Returns                                                    |
| ------------------------------- | ---------------------------------------------------------- |
| `GET /api/v1/reports/volume`    | Volume figures for a period                                |
| `GET /api/v1/reports/sla`       | Response and resolution compliance                         |
| `GET /api/v1/reports/csat`      | Satisfaction distribution and response rate                |
| `GET /api/v1/reports/agents`    | Per-agent figures — **also requires `reports:view_agents`** |

**Reporting responses carry Phase 10's full envelope**, unchanged:

```json
{
  "value": 0.9166666666666666,
  "count": 24,
  "total": 26,
  "excluded": [{ "reason": "no_policy", "count": 2 }],
  "suppressed": false,
  "period": { "from": "2026-02-01T00:00:00.000Z", "to": "2026-02-28T23:59:59.999Z", "timeZone": "UTC" },
  "filters": { "channel": "email" },
  "computed_at": "2026-09-02T14:12:00.000Z",
  "reflects_current_state": true
}
```

Every field is there for a reason established in Phase 10 and all of them survive the trip:

- **`count` and `total` travel with `value`.** A rate without its denominator reads identically at
  2-of-3 and 6,700-of-10,000.
- **`suppressed: true` means `value` is `null`** — not `0`. Zero is a claim; null is an absence. A
  client that renders them the same way reintroduces exactly the problem the floor exists to prevent.
- **`excluded` states what was left out**, so a figure narrower than the table is explained rather
  than merely smaller.
- **`reflects_current_state: true`** says the figures describe records as they are now, not as they
  were during the period. Recategorising a ticket today changes last month's numbers. A client
  storing these figures should store this flag with them.

### Metadata

| Endpoint                    | Returns                                                   |
| --------------------------- | --------------------------------------------------------- |
| `GET /api/v1/openapi.json`  | The machine-readable description of everything above      |
| `GET /api/v1/whoami`        | This credential's name and its permissions                |

`whoami` exists because the first question an integrator debugging a `403` has is "what do I actually
have?", and the alternative is asking us.

---

## 8. Field naming

Responses use `snake_case`. The internal interface uses `camelCase`, and the difference is not an
oversight: the published shape must be able to hold still while the internal one changes, and sharing
a serialisation would make every internal rename a breaking API change. The presenter layer is where
the translation happens, and it is the only place.

Timestamps are RFC 3339 with a `Z` offset. Identifiers are integers, matching the internal ones —
opaque public identifiers were considered and rejected as a change with no benefit while the internal
identifiers are already exposed on the screens.

---

## 9. What a client must not depend on

- The contents or format of a `cursor`.
- The wording of a `message`.
- Field ordering in a JSON object.
- The absence of fields not documented here — additions are expected.
- Ordering of a collection beyond what section 4 states.
- The integer range or density of identifiers.
