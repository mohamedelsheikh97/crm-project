# Quickstart: Phase 9 — AI Features

**Feature**: `010-phase-9-ai-features` | **Date**: 2026-09-02

How to run Phase 9 and prove it works. Scenarios 1–3 cover PLAN.md's Definition of done. Scenarios 4–7
cover the properties that are easy to believe without checking — and the ones where being wrong is
expensive.

---

## Prerequisites

- Phases 0–8 running (`npm run dev`), MySQL 8.4, migrations and seeders applied
- **The constitution amendment merged.** Phase 9 must not be implemented before it — see
  [plan.md](./plan.md) Constitution Check
- Published knowledge base articles in both `ar` and `en` (Phase 7)
- A portal account with accepted invitation (Phase 8)
- A local inference server reachable on a private address

### Environment

```bash
AI_ENABLED=true

# Staff-facing — external provider permitted (Clarifications Q1)
AI_EXTERNAL_API_KEY=sk-ant-...
AI_SUMMARY_ENABLED=true
AI_DRAFT_ENABLED=true
AI_CLASSIFY_ENABLED=true
AI_SIMILAR_ENABLED=true          # no provider — Phase 7 index (D8)

# Customer-facing — controlled infrastructure ONLY
AI_ASSISTANT_ENABLED=true
AI_LOCAL_BASE_URL=http://127.0.0.1:8000/v1
AI_ASSISTANT_LANGS=en            # add 'ar' only after Scenario 7 passes (D4)
AI_ASSISTANT_GROUNDING_FLOOR=0.35

# Ceilings, per feature per day (D11)
AI_CEILING_SUMMARY=500
AI_CEILING_DRAFT=500
AI_CEILING_CLASSIFY=2000
AI_CEILING_ASSISTANT=2000
```

**Verify the startup refusals before anything else.** Each should stop the process with a named error:

```bash
# 1. Assistant on, no local URL
AI_ASSISTANT_ENABLED=true AI_LOCAL_BASE_URL= npm run dev --workspace backend

# 2. Local URL pointing at a public address
AI_LOCAL_BASE_URL=https://api.example.com/v1 npm run dev --workspace backend

# 3. Staff features on, no external key
AI_EXTERNAL_API_KEY= AI_SUMMARY_ENABLED=true npm run dev --workspace backend
```

If any of these **starts successfully, stop** — the egress boundary is not doing its job and no other
scenario is meaningful.

---

## Scenario 1 — An agent sees a usable summary (Definition of done, first half)

1. Create a ticket and add 20+ messages across email and chat, some inbound, some outbound. Add two
   internal notes.
2. Sign in as an agent with `tickets:view`. Open the ticket.
3. **The ticket renders immediately.** The summary panel shows a loading state, not a blocked page
   (FR-004, SC-023).
4. Within 10 seconds the summary appears with an AI-generated disclosure (FR-014).

**Expected**

- Covers the request, what has been done, what is outstanding
- **Contains nothing from either internal note** (FR-023 — check this specifically; it is the failure a
  reviewer skims past)
- Full thread still present below (FR-022)
- Panel shows the message count it covers

**Then**: add another message, reload. The summary is recomputed and reflects it — there is no stale
cached copy, because there is no cached copy (D7).

**Then**: sign in as a user without `tickets:view` on that ticket and request the summary directly:

```bash
curl -H "Authorization: Bearer $OTHER_AGENT" localhost:3000/api/tickets/$ID/ai/summary
```

Expect **404** — the same answer as for a ticket that does not exist (FR-020).

---

## Scenario 2 — A draft the agent sends as their own (Definition of done, second half)

1. On a ticket with an unanswered inbound message, click **Draft reply**.
2. Text appears **in the composer**, editable.
3. **Check the database**: `SELECT COUNT(*) FROM messages WHERE ticket_id = ?` — unchanged (FR-026).
4. Navigate away without sending. Return. No message exists; the customer received nothing.
5. Draft again, edit it, send.

**Expected**

- The sent message is the **edited** text, authored by the agent (FR-027)
- Indistinguishable in the timeline from a typed message — no AI marker on the sent message, because the
  agent sent it and owns it (FR-015)
- Cited articles were shown before sending and all exist, are published, and are visible to the agent
  (SC-007)

**Then**: as a user with `tickets:view` but **not** `messages:send` — the button is absent, and the
endpoint returns **403** if called directly (FR-028).

---

## Scenario 3 — The chatbot answers, then escalates (Definition of done, second half)

1. Sign in to the portal as a customer. Open the assistant.
2. Ask something a published English article answers.

**Expected**: a grounded answer citing the article **by slug and title, never by id** (FR-065 of
Phase 8), with an AI disclosure.

3. Ask something no published content covers.

**Expected**: it says it cannot answer and offers to raise a request (FR-034). **Check
`ai_invocations`** — there is a row with `outcome = 'refused_ungrounded'`, and it was written
*without a model call* (D3 step 2).

4. Accept the offer.

**Expected**

- A ticket exists, carrying the conversation, marked as assistant dialogue (FR-036a, FR-036b)
- It appears in the customer's own request list under Phase 8 scoping
- `tickets.assistant_conversation_id` is set; category is the **default** — the classifier did not and
  could not set one (Clarifications Q2)

5. **Keep typing after escalation.**

**Expected**: the same ticket reference comes back. `SELECT COUNT(*) FROM tickets WHERE
assistant_conversation_id = ?` returns **1** (FR-036c, enforced by `UNIQUE`).

6. Say "I want to talk to a person" in a fresh conversation.

**Expected**: escalation within one exchange, with no further answering attempts (SC-018).

---

## Scenario 4 — Nothing writes a category

The single most important check in the phase, because a failure here reaches Phase 6's SLA and
automation and looks like their bug.

1. Submit a new ticket by email with clearly billing-related content.
2. Open it as an agent.

**Expected**

- A **proposal banner**, visibly a suggestion rather than a value
- `tickets.category` is still the default — confirm in the database, not in the UI
- Phase 6 automation rules keyed on category behaved as if the ticket were uncategorised

3. Dismiss the proposal. Reload.

**Expected**: no proposal is offered again (FR-047).

4. On another ticket, accept the proposal.

**Expected**: category changes, audit records it as **that agent's** decision, ticket history shows a
human change (FR-045a).

5. On a third ticket, set the category by hand **first**, then let classification run.

**Expected**: no proposal is offered against the human's decision (FR-049).

**Then, the assertion that matters most:**

```sql
-- Every category change must have a human behind it.
SELECT * FROM ticket_history
WHERE field = 'category' AND changed_by_user_id IS NULL;
```

Expect **zero rows** (SC-012).

---

## Scenario 5 — Egress went where it should

1. Run through Scenarios 1–3, then:

```sql
SELECT feature, location, COUNT(*) FROM ai_invocations GROUP BY feature, location;
```

**Expected**: `assistant` appears with `location = 'local'` and **never** `external`. Any other pairing
is a defect that stops the phase (SC-024a).

2. Confirm nothing was stored:

```sql
SHOW COLUMNS FROM ai_invocations;
```

**Expected**: no column holds prompt or completion text (SC-024b). The frozen-column test asserts this,
but look once by hand — it is the kind of thing a migration adds back "temporarily for debugging".

3. **Redaction.** Send a portal assistant message containing a card-shaped number and an `sk-`-prefixed
   string. Confirm at the adapter boundary (test fake, or local server logs) that both were replaced
   before transmission (SC-025) — including on the **local** path.

---

## Scenario 6 — Switch it off

1. Disable each feature in turn through `PATCH /api/admin/ai/config`.

**Expected**: that surface disappears within one page load; the other four keep working (FR-002,
SC-021).

2. Set `AI_ENABLED=false` and restart. Then run the full pre-Phase-9 suite:

```bash
npm test
```

**Expected**: the complete Phase 0–8 suite passes unchanged (SC-022). This is the assertion behind "if
the AI capability is switched off, the product is Phase 8".

3. Stop the local inference server with the assistant enabled.

**Expected**: the assistant is unavailable and the portal offers the Phase 8 ticket route. **It does not
fall back to the external provider** (FR-008b) — confirm no `assistant` row appears with
`location = 'external'`.

4. Set `AI_CEILING_SUMMARY=1`, request two summaries.

**Expected**: the second is refused with `ai_budget_exhausted`, recorded as `refused_budget`, visible in
the admin activity view — and **ticket, message, and portal operations are unaffected** (SC-027).

5. As a non-administrator, `PATCH /api/admin/ai/config`.

**Expected**: refused server-side, not merely hidden (FR-060, Principle II).

---

## Scenario 7 — Bilingual, and the Arabic gate

**This scenario decides whether the assistant ships in Arabic at all** (D4). It is a judgement, not a
pass/fail script.

1. Ticket with predominantly Arabic correspondence, agent with **English** interface. Request a summary.

**Expected**: summary in **Arabic**, interface chrome in English (FR-057, D9). An English summary here
is a silent translation and a defect.

2. Use the control to request the other language (FR-024).
3. Draft a reply on that ticket — the draft is in Arabic (FR-030).
4. Switch the interface to Arabic. Confirm every new surface renders RTL with no per-component
   overrides, and that disclosures and empty states are translated, not English (FR-059, SC-026).

**The Arabic assistant gate** — with `AI_ASSISTANT_LANGS=ar` on a staging system:

- Ask 20 Arabic questions the KB answers. How many are answered correctly and idiomatically?
- Ask 10 Arabic questions it does not cover. Does it refuse, or invent? (SC-016)
- Run the adversarial set in Arabic. Does it hold? (SC-019, SC-020)

**Enable Arabic only if the answers are good.** An assistant that answers Arabic customers confusingly
is worse for them than one that routes them to a person — English-only is a supported configuration
precisely so this can be an honest decision rather than a forced one.

---

## Automated suites

```bash
npm test                                    # everything
npx vitest run backend/tests/ai             # egress, redaction, budget, invocation records
npx vitest run backend/tests/assistant      # grounding, injection, escalation, scoping
npx vitest run backend/tests/similar        # deterministic ids, visibility scoping
```

**No test makes a network call or depends on generated text** (D10). Providers are faked at the adapter
boundary; assertions are structural — where egress went, what entered the context, what was refused,
what was recorded.

> **Run the suite alone.** The backend suite shares one `crm_support_test` schema with
> `fileParallelism: false`. A second concurrent run leaves open transactions and produces 401/403
> failures across unrelated files — see the note in `backend/tests/helpers/database.ts`.

---

## Manual passes that stay open

These cannot be automated, and closing them quietly would be worse than leaving them listed:

- **SC-002** — do agents judge summaries accurate enough to act on? Sample 20 long tickets.
- **SC-006** — are at least half of drafts actually sent? Measure over a fortnight of real use.
- **SC-010** — are 80% of category proposals accepted? Read from `ai_category_proposals`.
- **SC-016 / SC-019 / SC-020** — adversarial review of chatbot answers, in both languages.
- **The grounding floor** (research open question 1) — too low invents, too high never deflects, and
  **every test passes at either extreme**. Tune against real questions before enablement.
- **WCAG 2.1 AA** on all new surfaces in both languages, including streamed text in live regions.

---

## Implementation notes (added 2026-09-02, after the build)

Three things differ from what this guide assumed when it was written, and it is
easier to record them here than to let the next person rediscover them.

**Feature toggles and ceilings live in the database, not only in the
environment.** The `AI_*_ENABLED` and `AI_CEILING_*` variables seed a single
`ai_settings` row on first use; after that **Admin → AI features** owns them, so
SC-021's "within one page load" is achievable and FR-062's audit entry exists.
`AI_ENABLED` stays in the environment and overrides everything — it is the "is
this phase deployed" switch that SC-022 leans on, and no row can turn a feature
on while it is false. Scenario 6 step 1 therefore uses the admin screen; step 2
still uses the environment variable.

**The anonymous chat assistant is not built.** T071 and T072 are deferred with
their reasoning in `tasks.md`: research open question 3 asks whether it should
exist at all, and the escalation service refuses a conversation with no
identified contact rather than guessing one. Scenario 3 covers the portal
assistant, which is what PLAN.md's Definition of done requires. There is no
`/api/public/assistant/*` route to test.

**Scenario 5's egress query works, with one addition.** Also check that the
`assistant` rows never carry `location = 'external'`:

```sql
SELECT feature, location, outcome, COUNT(*)
FROM ai_invocations GROUP BY feature, location, outcome;
```

`refused_ungrounded` rows are the assistant declining *without* calling a model
(research D3 step 2) and are the numerator for SC-015's deflection rate. They
deliberately do not consume the daily ceiling — a customer asking unanswerable
questions must not be able to exhaust the budget without a single paid call.

### A defect this guide would have caught, and did

Running the app found something the test suite did not: the AI router was
mounted with a bare `router.use(aiRoutes)`, and because it applies
`authenticate`, every route registered after it inherited that — putting Phase
7's **public** knowledge base behind a token. It is fixed (ticket-scoped AI
routes now live inside the tickets router, and `/ai` is mounted on a prefix),
and `backend/tests/ai/disabled.test.ts` now asserts the public KB still answers
anonymously.

The lesson is worth carrying into T125: **curl the surfaces this phase did not
touch**, not only the ones it added. The regression was in Phase 7's routes, and
nothing in Phase 9's own tests looked there.
