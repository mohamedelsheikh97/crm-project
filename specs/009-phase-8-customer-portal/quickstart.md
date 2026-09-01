# Quickstart: Phase 8 — Customer Portal

**Feature**: `009-phase-8-customer-portal` | **Date**: 2026-09-01

How to prove the phase works, and — more importantly here than in any previous phase — how to try to
break it. Two of the seven scenarios below are attempts to see something you should not.

---

## Prerequisites

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

**Four new environment variables**, and the first two are required:

| Variable                     | Required | Default | Notes                                                  |
| ---------------------------- | -------- | ------- | ------------------------------------------------------ |
| `PORTAL_JWT_ACCESS_SECRET`   | **yes**  | —       | ≥32 chars, must differ from all three other secrets    |
| `PORTAL_JWT_REFRESH_SECRET`  | **yes**  | —       | ≥32 chars, must differ from all three other secrets    |
| `PORTAL_INVITE_TTL_HOURS`    | no       | 168     | Invitation lifetime (research open question 3)          |
| `PORTAL_RATE_PER_MINUTE`     | no       | 20      | Base allowance for the portal scopes (D11)              |

The application **refuses to start** if either secret is missing or duplicates another, following the
`env.ts` refinement Phase 1 added for the access/refresh pair. That refusal is deliberate: a portal
sharing the staff secret is the one misconfiguration in this phase that works perfectly until somebody
notices they can act as a staff user.

**No portal accounts are seeded.** There is no self-registration (FR-002a) and seeding a customer
credential would be seeding a way in. Every scenario below starts with a staff member issuing an
invitation, which is what a real deployment does.

**The seeder does add** the `portal:manage` grant to Administrator and Supervisor, and a
`channel_settings` row for the `portal` channel.

**Mail**: with `CHANNEL_EMAIL_PROVIDER=simulator`, invitation emails go to the simulator store rather
than to a mailbox. Read the token from there.

---

## Run the automated suite

```bash
npm test
npm test -- backend/tests/portal
```

**Three files carry this phase**, and they are the ones to read if anything below surprises you:

- `backend/tests/portal/realm.test.ts` — every portal endpoint refuses a staff token; every staff
  endpoint refuses a portal token. Iterates the declared endpoint list, not a sample (SC-002).
- `backend/tests/portal/scope.test.ts` — every portal read attempted against another customer's
  records, a colleague's records, and an unassociated ticket. All three must answer exactly as a
  nonexistent record does (SC-003, SC-028, SC-029).
- `backend/tests/portal/projection.test.ts` — the customer ticket view's key set, asserted by
  **equality** against a frozen list, on a fixture carrying internal notes, tasks, an assignee, SLA
  state, automation runs and a merge record (SC-008).

If you add a portal endpoint and the realm or scope test fails, the test is right.

---

## Scenario 1 — Invite somebody in (User Story 1)

1. Sign in as an Administrator. Open a customer with at least one **email** contact.
2. Portal access → invite that contact. Confirm.
3. Read the invitation from the mail simulator; open its link.
4. Set a password, choose Arabic, continue.

**What to look for**: the acceptance screen names the organisation and the address the invitation went
to **before** asking for a password. You have just been through the flow a customer will see cold, in
their inbox, unprompted — if it reads like phishing to you, it reads like phishing to them, and no test
will tell you that.

Then, three refusals to confirm by hand:

- Open the same link again → one message, not "already used".
- Set `PORTAL_INVITE_TTL_HOURS=0`, issue another, open it → the **same** message.
- Issue one, revoke it from the staff screen, open it → the same message again.

Three causes, one answer (FR-002c). If they differ, the token is an oracle for which invitations exist.

**Then try the thing that should not exist**: find any route that creates a portal account without a
token. There isn't one (FR-002a). `curl` the API for `register`, `signup`, `portal/accounts` — all 404.

---

## Scenario 2 — The realm boundary, by hand (SC-002)

The suite proves this exhaustively; do it once yourself, because it is the phase's central claim.

```bash
# Staff token → a portal endpoint
curl -i -H "Authorization: Bearer $STAFF_TOKEN"  localhost:3000/api/portal/tickets
# Portal token → a staff endpoint
curl -i -H "Authorization: Bearer $PORTAL_TOKEN" localhost:3000/api/tickets
curl -i -H "Authorization: Bearer $PORTAL_TOKEN" localhost:3000/api/admin/users
```

All three: **401**, identical to sending no header at all.

**What to look for**: the portal token's subject is a `portal_accounts.id`. Pick one that equals a real
`users.id` — with a small dataset, most of them will. Before D1, that request would have resolved to
that staff user. Now it fails at signature verification, before any claim is read.

---

## Scenario 3 — Raise and track a request (User Stories 2 and 3)

1. In the portal: new request. Start typing a description matching a published article — help content
   appears beside the form.
2. **Ignore it** and submit anyway. Note the reference.
3. As an agent, open the queue: the ticket is there, ordinary, `source: portal`, assignable,
   transitionable, under SLA policy.
4. Back in the portal: the request is listed with a customer state.

**What to look for**:

- Submitting took exactly one action whether or not an article was offered (FR-042).
- The form has **no upload control**, and says instead how to send a file (FR-022a). Not a disabled
  button.
- The agent's view shows the **requesting contact** — who can see this in the portal.
- The portal shows `received`, not `new`; move it to `escalated` as an agent and the portal still says
  `in_progress` (FR-028). If a customer can tell they have been escalated, D7 has leaked.

---

## Scenario 4 — Try to see a colleague's request (SC-028) — the important one

Set up: one customer record, **two** email contacts, both invited and accepted. Contact A raises a
request; contact B signs in.

Then, as B, try every way in:

```bash
curl -H "Authorization: Bearer $B_TOKEN" localhost:3000/api/portal/tickets                       # A's absent
curl -H "Authorization: Bearer $B_TOKEN" localhost:3000/api/portal/tickets/TKT-0000XX            # 404
curl -H "Authorization: Bearer $B_TOKEN" localhost:3000/api/portal/tickets/TKT-0000XX/replies -d …  # 404
curl -H "Authorization: Bearer $B_TOKEN" localhost:3000/api/portal/tickets/TKT-0000XX/satisfaction -d …  # 404
curl -H "Authorization: Bearer $B_TOKEN" localhost:3000/api/portal/tickets/TKT-0000XX/attachments/1  # 404
```

**What to look for**: every answer is identical to a reference that has never existed. Not 403. Not a
different message. Not a different response time you can measure. A distinguishable answer tells B that
A raised something, which on a company record is the disclosure Clarifications Q2 exists to prevent.

Then the same set against a ticket on a **different customer**, and against a ticket with
`requesting_contact_id IS NULL`. Same answers.

**And the one the tests cannot do**: try to learn something by inference. Do counts change? Do
timestamps appear anywhere? Does a rate-limit response differ for a real reference versus a fabricated
one? Spend ten minutes trying to find out whether a colleague's ticket exists.

---

## Scenario 5 — The conversation, and what is not in it (User Story 4, SC-008)

Set up a ticket for a portal customer carrying, on the agent side: an internal note, a task, a mention,
an assignee, an SLA policy with a breached target, an automation run, and email correspondence in both
directions with an attachment.

Open it in the portal.

**What to look for**: the correspondence is complete across channels, and **nothing else is in the
response**. Read the raw JSON, not the rendered page — the point of FR-031 is that internal content is
absent, not hidden.

Then download the attachment. Then try:

- The attachment id of an internal, agent-uploaded file on the same ticket → refused.
- Any attachment id from another ticket → 404.

**Note**: this download endpoint is new to the codebase (research D15). Agents still cannot download a
message attachment anywhere in the application — that is Phase 5's gap, recorded, not fixed here.

---

## Scenario 6 — Reply, reopen, and the closed boundary (User Story 5, D9)

1. Resolve the ticket as an agent. In the portal, reply.
2. The ticket is **open** again on the agent side, and the reply is in their timeline as an inbound
   message on the `portal` channel.
3. Reply again as the agent, on the portal channel. The customer sees it.
4. Now **close** the ticket as a Supervisor. In the portal: there is **no reply box** — only "raise a new
   request".

**What to look for**:

- Reopening happened with no staff action and no permission grant to the customer, and the ticket's
  history attributes it to the system, not to a person.
- Step 3 proves the portal is answerable in place. Without D6's replyable channel, a portal-submitted
  ticket would have had no reply path at all.
- The agent's message shows as `read` once the customer's portal has returned it — the one channel here
  that can know that truthfully.
- On the closed ticket, nothing you type is accepted and then discarded, because nothing is offered
  (FR-036).
- Reopening restarted SLA response behaviour. Confirm that is what the operations team expects.

---

## Scenario 7 — Rate the resolution, then the empty portal (User Story 7, SC-021)

1. Resolve the ticket. In the portal, rate it and add a comment. Submit.
2. Submit again — "already recorded", and the first score stands.
3. As an agent, see the score and comment with its date on the ticket.
4. Reopen and re-resolve the ticket: **no second rating is offered** (FR-054).
5. Now invite a contact on a customer whose tickets all predate the association, and sign in.

**What to look for at step 5**: an empty request list that reads as **normal** — "you have no open
requests", a clear way to raise one, and a quiet line for somebody who expected history. This is the
visible cost of D4's fail-closed rule and it will be the first support call about the portal. If it
looks like an error, fix the copy before shipping.

Then run the deterministic backfill's condition by hand against one of those tickets: its earliest
inbound `sender_identity_normalised` versus the record's `customer_contacts.value_normalised`. If they
match and exactly one contact matches, migration 5 should have associated it. If two contacts hold the
same address, it should have declined (FR-026g) — declining is correct.

---

## Manual passes the automated suite does not cover

Owed to this phase's Definition of done, not optional:

- **Inference hunting** (Scenario 4's last paragraph). The tests prove specific reads are refused; only
  a person trying to learn something can find the fact that leaks by counting.
- **The invitation, read cold**, in Arabic and English. Legitimacy is a judgement no test makes.
- **Does `pending` mean "awaiting you"?** (research open question 1.) Every test passes under either
  mapping; only somebody who runs support knows. One word, one file.
- **The empty portal reads as normal** (Scenario 7 step 5).
- **Arabic RTL, whole-conversation**: a thread containing Latin file names and technical terms, read
  end to end. Not a label — a body of mixed-direction text.
- **Screen reader**: the request list, the conversation's heading structure, and the rating control as a
  radio group rather than a row of icons.
- **An actual phone.** The portal is the first mobile-first surface in this project and the only one
  whose users are holding a phone by default. Include the reply box with a keyboard covering half the
  screen.
- **Greyscale**: open and settled requests distinguishable without colour.

---

## Troubleshooting

**The server refuses to start, complaining about secrets.** Correct. Set
`PORTAL_JWT_ACCESS_SECRET` and `PORTAL_JWT_REFRESH_SECRET`, both ≥32 characters, both different from
`JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`.

**A portal token gets a 401 on every portal endpoint.** Check `type` is `portal-access` and that it was
signed with the portal secret. A staff token behaves exactly this way — which is the design.

**A customer's own ticket is missing from their list.** Check `tickets.requesting_contact_id`. `NULL` is
invisible by design (FR-026f); associate it from the ticket screen, or check whether the backfill
declined because two contacts share the address.

**A customer sees no tickets at all after accepting an invitation.** Almost certainly the same thing,
for their whole history. This is expected, not a bug — see Scenario 7 step 5.

**A withdrawal did not take effect.** Access tokens are refused within 15 minutes by the per-request
freshness read, immediately in practice; refresh tokens are refused by `session_epoch`. If a refresh
still works, the epoch was not incremented.

**An agent cannot reply to a portal-submitted ticket.** Check `portal` is in `REPLYABLE_CHANNELS` and
that its `channel_settings` row is enabled. Without both, `conversationFor` returns `null` and the
composer has nothing to offer — the failure D6 exists to prevent.

**A second satisfaction submission returned 500 rather than 409.** The unique index fired and the
service did not translate the constraint violation. Fix the translation, not the index.

**The portal renders with staff navigation.** `meta.portalShell` is missing from the route, so `App.vue`
fell through to `DefaultLayout`.
