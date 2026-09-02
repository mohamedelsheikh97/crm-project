# Contract: Webhook Notifications

**Feature**: Phase 11 — Integrations | **Audience**: whoever writes the receiving endpoint

Three properties of this contract will surprise somebody, so they are stated before anything else.

1. **Payloads carry identifiers, not records.** You will get "ticket 421 was resolved", not the
   ticket. Fetch it through the published interface.
2. **Delivery is at-least-once.** You will occasionally receive the same event twice. Deduplicate on
   `event_id`.
3. **Order is not guaranteed.** Event B can arrive before event A. Order by `occurred_at` yourself.

All three are deliberate, and each is argued where it appears below.

---

## 1. The payload

```http
POST /your/endpoint HTTP/1.1
Content-Type: application/json
X-CRM-Event: ticket.resolved
X-CRM-Event-Id: 5f3a9c10-6b2e-4a11-9f8d-2c1b7e4a0d33
X-CRM-Signature: t=1788451920,v1=8f3c...e21a
User-Agent: CRM-Support-Webhooks/1
```

```json
{
  "event_id": "5f3a9c10-6b2e-4a11-9f8d-2c1b7e4a0d33",
  "event_type": "ticket.resolved",
  "occurred_at": "2026-09-02T14:12:00.482Z",
  "api_version": "1",
  "subject": {
    "type": "ticket",
    "id": 421,
    "url": "https://crm.example.com/api/v1/tickets/421"
  }
}
```

That is the whole payload. There is no `data` object.

### Why there is no record content

A notification goes to an address a person typed into a form. If that address is wrong, taken over,
or logged by an intermediary, a payload containing customer names and ticket bodies is a data
disclosure — while a payload containing an identifier is an inconvenience.

Sending an identifier means the authority check happens **when you read**, against your credential,
by the same code that checks it for everyone else. Sending the record would mean this system deciding
at push time what your credential covers, on the one surface where nobody is watching the result.

There is a second reason, and it is about truth rather than security. Because delivery is
at-least-once and unordered, a record embedded in a payload can reach you *after* the record has
changed again — and you would have no way to know. An identifier is never stale: reading it gives you
the record as it is now.

**The cost is yours and we acknowledge it:** one read per event. When catching up after an outage,
use the published interface's `since` parameter instead of reading each event individually — see the
published API contract, section 4.

### Event types

| `event_type`       | Fires when                                            | `subject.type` |
| ------------------ | ----------------------------------------------------- | -------------- |
| `ticket.created`   | A ticket is raised through any channel                | `ticket`       |
| `ticket.resolved`  | A ticket enters a resolved or closed state            | `ticket`       |
| `customer.created` | A customer record is created                          | `customer`     |

A subscription receives only the types it asked for. New types may be added; a subscription not
asking for them is unaffected, which is why adding one is not a breaking change.

**`ticket.resolved` fires on the transition, not on the state.** A ticket resolved, reopened and
resolved again produces two events with different `event_id`s and different `occurred_at`s. That is
correct — it happened twice.

---

## 2. Verifying the signature

```
X-CRM-Signature: t=1788451920,v1=8f3c...e21a
```

`v1` is the HMAC-SHA256, hex-encoded, of the string `<t>.<raw request body>`, keyed with your
subscription's signing secret.

```js
const [tPart, ...vParts] = header.split(',');
const timestamp = tPart.slice(2);
const signed = `${timestamp}.${rawBody}`;
const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');

const ok = vParts
  .map((part) => part.slice(3))
  .some((given) => crypto.timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex')));

if (!ok) return reject();
if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return reject();
```

Four things matter here and each one is a way people get this wrong:

- **Use the raw body bytes, not a re-serialised object.** Parse-then-stringify will not reproduce the
  same string — key order and number formatting both vary — and your signature will never match.
- **The timestamp is inside the signed material.** That is what makes the tolerance meaningful: a
  replayed request cannot have its timestamp updated without invalidating the signature. Reject
  anything outside **5 minutes**.
- **Compare in constant time.** A naive `===` on a signature is a timing oracle.
- **There may be more than one `v1=` value.** During a secret rotation both the old and new secrets
  are used, so accept the request if *any* of them verifies. That is what lets you redeploy with the
  new secret without dropping notifications in between.

Your signing secret is shown **once**, when the subscription is created. We store its hash; we cannot
tell you what it was.

---

## 3. What your endpoint must do

**Answer `2xx` quickly.** Anything else is a failure.

Acknowledge first, process afterwards. If you do the work before responding, a slow database on your
side becomes a delivery timeout on ours, and you get a retry for an event you already handled.

| Your response          | We do                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| `2xx`                  | Mark delivered. Done                                               |
| `408`, `429`           | Retry on the schedule below                                        |
| Other `4xx`            | **Stop.** Permanent — retrying a `404` for 21 hours helps nobody   |
| `5xx`                  | Retry on the schedule below                                        |
| Timeout (10s), refused connection, TLS failure | Retry                              |
| `3xx` redirect         | **Fail.** We do not follow redirects — see section 6               |

### Requirements on your endpoint

- **HTTPS.** Plain HTTP is refused at subscription time.
- **Publicly routable.** A private, loopback or link-local address is refused — see section 6.
- **Respond within 10 seconds.**
- **Be idempotent on `event_id`.** This is not advice; see section 4.

---

## 4. At-least-once, and why you must deduplicate

You will sometimes receive the same `event_id` twice. The commonest cause is mundane: your endpoint
processed the event and then your `2xx` was lost in transit, so from here it looks like a failure and
gets retried.

Exactly-once delivery is not something a sender can provide. It requires the receiver to participate
— deduplicate on an identifier, or make processing idempotent — so pretending otherwise would only
mean you discovered the requirement in production. Hence the `event_id`, which is stable across every
retry and across an administrator's manual re-send.

**Store processed `event_id`s and drop repeats.** A `2xx` for an event you have already handled is the
correct response.

---

## 5. Order is not guaranteed

Guaranteeing order would mean one slow receiver holding up every later event for every subscription.
Instead:

- `occurred_at` has **millisecond** precision. Two events for the same ticket within one second are
  ordinary — a status change that fires an automation rule, for instance — and second precision would
  make ordering impossible in exactly that case.
- Order by `occurred_at` when it matters.
- Because payloads carry identifiers, an out-of-order event still leads you to the current record.
  This is the design paying for itself: with embedded snapshots, a late-arriving old event could
  overwrite newer data in your system, and you would have no way to detect it.

---

## 6. The address rules, and what they are protecting against

A subscription address must resolve to a **publicly routable** host. Refused at subscription time and
**re-checked at delivery**:

- loopback (`127.0.0.0/8`, `::1`, `localhost`)
- private ranges (`10/8`, `172.16/12`, `192.168/16`)
- link-local, including `169.254.169.254`
- `.internal` and `.local` names

Without this, a subscription is a way to make this server issue requests inside its own network and
report the responses to whoever configured the subscription — a cloud metadata endpoint being the
usual target.

**Re-checking at delivery is not redundant.** A hostname that resolved publicly when saved can be
repointed at `127.0.0.1` afterwards. A save-time check alone does not see that.

**Redirects are not followed** for the same reason: a public endpoint answering `302
http://169.254.169.254/` would otherwise walk the guard straight past itself. A redirect is recorded
as a failure with that reason, so an administrator can see it rather than wondering why delivery
stopped.

> **A note for anyone maintaining this system.** This rule is the *inverse* of the one in Phase 9,
> where the customer-facing AI processor must be on a private address and a public one is refused.
> Both rules classify a host; they require opposite answers. They share a classifier
> (`lib/net-address.ts`) but deliberately not an assertion — `assertPubliclyRoutable()` here,
> `assertControlledInfrastructure()` there — because a shared `checkHost()` is exactly the helper
> somebody would call with the wrong expectation.

---

## 7. Retries

| Attempt | After   |
| ------- | ------- |
| 1       | Immediately (next sweep, within ~60s) |
| 2       | 1 minute |
| 3       | 5 minutes |
| 4       | 30 minutes |
| 5       | 2 hours |
| 6       | 6 hours |
| 7       | 12 hours |

Roughly 21 hours in total, which is chosen to span a night: an outage starting in the evening is
recovered by morning without anybody being paged.

After the last attempt the event is **abandoned but retained**, and appears in the administration
overview with its reason. It is never discarded — an event that vanished when delivery gave up is the
failure nobody notices. An administrator can re-send it once your endpoint is fixed, and the re-send
carries the original `event_id`.

**Events survive a restart of this system.** They are rows, and due-ness is a column, so a process
that stops holds nothing in memory that matters.

---

## 8. Managing a subscription

Subscriptions are created by an administrator of this system, not through the interface. Each belongs
to an API credential, which is what makes FR-037 checkable: a notification is only delivered if the
owning credential's authority covers the record. This matters more than it sounds — a notification
saying "ticket 421 changed" tells you that ticket 421 exists, so the notification itself is a
disclosure.

| Property         | Notes                                                        |
| ---------------- | ------------------------------------------------------------ |
| Address          | HTTPS, publicly routable                                     |
| Events           | Which types you want                                         |
| Signing secret   | Shown once at creation; rotatable with a 24-hour overlap     |
| Health           | `healthy` / `degraded` / `failing` / `unknown`, from recent deliveries |

When your endpoint has been failing, the subscription is marked and visible to an administrator
without them reading individual delivery records — because a webhook integration that quietly stopped
working is the failure mode this whole section exists to make loud.
