# Phase 0 Research: Phase 9 — AI Features

**Feature**: `010-phase-9-ai-features` | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

Twelve decisions. The phase has one genuinely hard problem and the rest is ordinary work made
unusually careful by the fact that the output cannot be checked.

The hard problem is a consequence of Clarifications Q1. Splitting egress by surface puts a frontier
model behind the low-risk internal features and a self-hostable model behind the customer-facing one —
which is the surface carrying FR-034 (never answer ungrounded), FR-035 (never disclose customer data)
and FR-039 (resist injection). **The safety requirements and the model capability run in opposite
directions.** D2 makes the boundary uncrossable, D3 moves the guarantees out of the model, and D4 says
what to do about the language gap that remains.

---

## D1 — One provider interface, two implementations, chosen at import time

**Decision.** `backend/src/ai/providers/types.ts` declares a single narrow interface:

```
complete(request: AiRequest): Promise<AiResult>
```

`AiRequest` carries a system prompt, an ordered message list, a max-output ceiling, and a feature tag.
It does **not** carry a model id, a temperature, or a provider name — those belong to the
implementation. Two implementations satisfy it: `external.ts` (Anthropic SDK) and `local.ts` (HTTP to
the controlled inference server).

**Rationale.** The codebase already answers this shape of question. `channels/types.ts` declares
`ChannelAdapter` and six implementations satisfy it, with `registry.ts` resolving one per channel — and
Phase 5's own comment explains why chat gets an adapter even though "there is no third party": entering
through the same door buys identity resolution, threading, and the ledger for free. The same logic
applies. One interface means the invocation record (D7), the budget check (D11), and the redaction pass
(D10) are written once and cannot be skipped by a feature that calls a provider directly.

The interface is deliberately narrower than either provider's API. Anything richer — streaming
handles, tool definitions, thinking configuration — would leak provider concepts into services and make
the two implementations diverge until only one of them really worked.

**Alternatives considered.** A single adapter parameterised by location: rejected under D2. A
per-feature adapter (five implementations): rejected as YAGNI under the constitution's Compliance
Review clause — the features differ in prompt and post-processing, not in transport.

---

## D2 — The egress boundary is a compile-time property, not a setting

**Decision.** Two factory modules, and nothing imports both:

- `external-factory.ts` exports `externalProvider()`. Imported **only** by `ai-summary.service.ts`,
  `ai-draft.service.ts`, and `ai-classify.service.ts`.
- `local-factory.ts` exports `localProvider()`. Imported **only** by `assistant.service.ts`.

`assistant.service.ts` never imports `external-factory.ts`, and a test asserts that — by reading the
module's import graph, not by mocking. An ESLint `no-restricted-imports` rule enforces it a second time
at lint, so the violation is caught before the test runs.

**Rationale.** FR-008a is unusually specific: it MUST NOT be possible to point the chatbot at an
external provider by editing a setting, and an attempt MUST fail closed. A `provider: 'external' |
'local'` config value satisfies the letter of "the boundary exists" and fails the requirement
completely — the boundary becomes a string in a settings table, one careless migration or one admin
screen away from sending customer chat to a third party, with nothing failing and no error raised.

This is the same reasoning Phase 7 recorded in its D7, and the argument is worth repeating because it
generalises: _the public surface's visibility is a LITERAL in the controller, never a request
parameter... threading it through "so the endpoint is reusable" is one signature change from serving
internal content to the internet, and the diff would look like good engineering._ Phase 8 applied it
again to `audience: 'customer'`. This is its third application, to the strongest boundary in the
system.

**What "fails closed" means concretely.** `localProvider()` throws at construction if
`AI_LOCAL_BASE_URL` is unset or points outside the configured allowlist of private address ranges.
`env.ts` refuses to start when `AI_ASSISTANT_ENABLED=true` and `AI_LOCAL_BASE_URL` is absent — the same
startup-refusal pattern Phase 8 used for its four JWT secrets, and for the same reason: a
misconfiguration that works perfectly until somebody notices is worse than one that stops the process.

**Alternatives considered.** Runtime assertion inside the shared adapter (`if feature === 'assistant'
&& location === 'external' throw`): rejected because it is a check that can be deleted in a refactor
that looks like tidying. Network-level egress rules: complementary and recommended operationally, but
not something this codebase can assert in a test.

---

## D3 — The chatbot's guarantees live in context construction, not in the prompt

**Decision.** The assistant turn is built in four steps, and only step 3 involves a model:

1. **Retrieve.** Call Phase 7's `kb-search.service.search({ query, lang, audience: 'customer',
   limit: 5 })`. The `audience` argument is a literal in the assistant service, exactly as Phase 7's
   public controller passes it.
2. **Gate.** If the top hit's score is below `AI_ASSISTANT_GROUNDING_FLOOR`, **do not call the model at
   all**. Return the "I cannot answer this — shall I raise a request?" response, which is locale text,
   not generated.
3. **Generate.** Call the local provider with a system prompt and the retrieved article excerpts as the
   only corpus. No ticket data, no customer record, no conversation from any other session.
4. **Verify.** Check the response cites at least one of the article ids supplied. If it cites nothing,
   or cites an id that was not supplied, discard the generation and fall back to step 2's refusal.

**Rationale.** FR-033 through FR-035 are requirements about what the model must never do, and a
self-hostable model is precisely the kind that will sometimes do them anyway when asked cleverly. Every
one of those requirements can be restated as a property of the context instead:

| Requirement                                | As a prompt instruction     | As a property of context             |
| ------------------------------------------ | --------------------------- | ------------------------------------ |
| FR-033 answer only from published content   | "Only use these articles"   | Only published articles are retrieved |
| FR-035 never reveal customer data           | "Never discuss accounts"    | No customer data is ever in context   |
| FR-034 decline when not covered             | "Say you don't know"        | Step 2 refuses before the model runs  |

The middle column is a request. The right column is a fact. Step 2 is the one that matters most: **the
most common failure — a fluent answer to a question the knowledge base does not cover — is prevented by
not making the call.** It also happens to be the cheapest possible implementation of that requirement.

Step 4 exists because the model can still paraphrase an article into something it does not say. Citation
verification does not catch that, and nothing cheap does; SC-016 is a human review criterion for a
reason. What step 4 does catch is the fabricated reference, which is the failure a customer could act on.

**Alternatives considered.** A larger prompt with stronger instructions: rejected — it is the
right-hand column pretending to be the left. A second model call to grade the first (LLM-as-judge):
rejected for this phase; it doubles cost and latency on the surface that can least afford both, and the
grader is the same weak model.

---

## D4 — The local model is an OpenAI-compatible inference server, and Arabic gates enablement

**Decision.** The controlled processor is any OpenAI-compatible chat-completions server (vLLM, Ollama,
llama.cpp, TGI) reached over HTTP on a private address. `local.ts` speaks that wire format with `fetch`
and adds no dependency. The specific model and server are an **operational choice recorded in
deployment configuration**, not a code dependency — swapping it is an env var.

**The chatbot is enabled per language, and Arabic must pass its own gate.** `AI_ASSISTANT_LANGS` lists
the languages the assistant will answer in. A language not listed falls through to the FR-042 route:
the customer raises a ticket the Phase 8 way.

**Rationale.** Two facts drove this. First, committing the code to one inference stack would put an
operational decision in a TypeScript import; the OpenAI-compatible shape is what every self-hosted
server already exposes, so targeting it costs nothing and keeps the choice where it belongs.

Second, and more important: **small open-weights models are substantially weaker in Arabic than in
English**, and Constitution Principle I is non-negotiable about both languages working. This phase
cannot fix that. What it can do is refuse to ship a surface that is worse in Arabic than no surface at
all — an assistant that answers Arabic customers confusingly is worse for them than one that politely
routes them to a person. So Arabic enablement is a decision made against SC-016 and SC-019 measured in
Arabic, and the code makes shipping English-only a supported configuration rather than an accident.

This is the one place in the phase where the honest answer is "this may not be good enough, and here is
how we will know". Recording it as a gate is the alternative to discovering it from customers.

**Alternatives considered.** Requiring a specific model in the constitution amendment: rejected —
pins an operational choice to a governance document. Running the assistant English-only by decision:
rejected as premature; measure first, and Arabic may well pass.

---

## D5 — The assistant conversation is its own record, not a `messages` row

**Decision.** Two new tables, `assistant_conversations` and `assistant_messages`. A conversation
belongs to either a `portal_accounts.id` (signed-in, Phase 8 realm) or an anonymous chat session token,
never both, and never to a `users.id`. On escalation it gains a `ticket_id` — set exactly once, which is
what makes FR-036c idempotent by construction rather than by a check.

**Rationale.** Writing assistant turns into `messages` was the tempting reuse and it is wrong on three
counts, all of which are already written down in this repository.

Phase 5 kept the timeline **correspondence-only** and stated in writing that this is what would make it
safe for Phase 8 to build a customer window on. Phase 8's spec then relied on exactly that. A
pre-ticket exchange with a bot is not correspondence with the organisation, and putting it in
`messages` would retroactively break the property two phases were built on.

Second, `messages` rows require a `ticket_id`. An assistant conversation exists precisely in the window
**before** there is a ticket, and most conversations never produce one — SC-015 targets 30% deflection,
which means the majority are resolved and thrown away. Modelling them as ticket messages would need a
provisional ticket per question, which is the opposite of deflection.

Third, `messages` carries a `channel` and a delivery state. An assistant turn has neither in any
meaningful sense.

**On escalation**, the conversation is rendered into the ticket's opening description and the
conversation row is linked to the ticket. FR-036b's "which part is the bot's" is then structural: the
bot's words are in the description, marked; everything after is ordinary Phase 5 correspondence.

**Alternatives considered.** A `messages.is_assistant` flag: rejected — it is the "hiding is a control"
pattern Principle II refuses. Storing conversations only in memory: rejected — FR-043 requires
retrieval, and a bot's statements in the organisation's name must outlive a process restart.

---

## D6 — Retention: the conversation is content, the invocation is metadata

**Decision.** Two records with deliberately different rules, and the difference is documented at both
sites.

- `assistant_messages` **stores text**, because FR-043 requires it: this is what the organisation said
  to a customer, retained on the same basis Phase 5 retains outbound messages.
- `ai_invocations` **stores no text at all** — feature, subject reference, requester, timestamp,
  outcome, token counts, processing location. Never a prompt, never a completion.

**Rationale.** Clarifications Q3 chose metadata-only, and read carelessly that contradicts FR-043. The
reconciliation is FR-065a's: what is retained is retained because of what it *is*, not because AI
produced it. A chatbot answer sent to a customer is a statement by the organisation. A prompt assembled
to produce an internal summary is a working artefact with no independent existence.

The practical consequence is the one worth stating: **when an agent reports that a summary was wrong,
there will be no record of what the model was shown.** That is the accepted cost. It is accepted
because the alternative is a table containing every ticket thread in the system, in plaintext, with its
own lifetime and its own access control, sitting outside every protection Phases 2, 5 and 8 built around
the original — and because a summary can be regenerated from a thread that has not gone anywhere.

**Alternatives considered.** A short TTL on full content (24h): rejected as the worst of both — still a
second copy, still needs deletion tooling, and rarely still present when a problem is reported.

---

## D7 — Summaries are computed on read and never stored; delivery is poll-then-render

**Decision.** `GET /api/tickets/:id/ai/summary` computes on demand and returns the text without
persisting it. The ticket detail response does **not** embed a summary and does not wait for one; the
panel requests it after the ticket renders.

**Rationale.** FR-004 forbids AI work on the ticket-open path, and FR-065b forbids storing the result,
so the only remaining shape is a separate request the client makes after render. This is the pattern
Phase 7 established for suggestions and recorded the reason for: _a stored suggestion goes stale the
moment an article is archived, and nothing notices._ A stored summary is worse — it goes stale on the
next inbound message, and a stale summary of a live ticket is actively misleading in a way an empty
panel is not. Recomputation also disposes of FR-018's staleness problem entirely: a summary computed
now cannot be older than the thread.

The cost is a model call per view. D11's per-feature ceilings bound it, and the summary panel is
collapsed by default on tickets under the message-count threshold, so short tickets never spend
anything.

**Alternatives considered.** A job queue with stored results: rejected in Complexity Tracking — real
infrastructure for a one-request-deep need, and it reintroduces both staleness and storage.
Server-Sent Events: deferred; the hub exists (`lib/notification-hub.ts`) but polling one endpoint is
simpler and the wait is seconds.

---

## D8 — Similar tickets use Phase 7's index and make no model call

**Decision.** `similar-ticket.service.ts` reuses the Phase 7 normalisation pipeline and token-index
approach against ticket subjects and resolution text, scored with the same fraction-matched ranking, and
**filtered in the `WHERE` clause** by the viewer's ticket visibility. No provider is involved.

**Rationale.** This is the decision most likely to be questioned, so the argument is stated plainly:
every property FR-051 through FR-055 asks for is better served without a model.

| Property                         | Token index                          | Model call                                   |
| -------------------------------- | ------------------------------------ | -------------------------------------------- |
| FR-052 visibility scoping        | A `WHERE` clause; provably enforced  | Post-filtering results — the thing FR-016 of Phase 8 forbade |
| FR-053 computed on read          | One query                            | One paid call per ticket view                 |
| FR-054 says so when nothing fits | Score floor, same as Phase 7          | Model will produce something regardless       |
| Testability                      | Exact assertion on ids               | Structural assertion only                     |
| Cost                             | Zero                                 | Per view                                      |

Phase 7 already built and measured this machinery, including the Arabic normalisation rules that MySQL
`FULLTEXT` failed (its D1). Reaching for a model here would be spending money to make a working feature
worse and less verifiable. The spec places this under "AI Features" because PLAN.md does; the honest
implementation is retrieval.

**Alternatives considered.** Embeddings + vector search: rejected — new infrastructure, and it makes
FR-052's in-query scoping awkward (vector stores do not naturally accept the visibility predicate).
Revisit if SC-013's 70% is missed.

---

## D9 — Bilingual output: content language follows the source, interface language follows the reader

**Decision.** Two independent language decisions, named differently in code so they cannot be conflated:

- `contentLang` — the language of the material. Derived from the ticket's correspondence (the
  predominant language of inbound messages) or the customer's assistant message. Determines what the
  model writes.
- `uiLang` — the reader's `vue-i18n` locale. Determines labels, disclosures, empty states, errors.

A summary of an Arabic thread read by an English-interface agent is **Arabic content inside English
chrome**, with a control to request it in the other language (FR-024).

**Rationale.** FR-057 forbids silent translation, and the failure it guards against is subtle: an agent
reading a fluent English summary of an Arabic complaint has been handed a translation nobody labelled,
with the model's word choices standing in for the customer's. That is a different artefact from a
summary, and it is worse for being invisible.

Naming these separately matters more than it sounds. A single `lang` variable threaded through both
concerns is how the two silently become one — and the resulting bug (everything renders in the reader's
language, including the customer's words) looks like correct i18n to a reviewer who does not read
Arabic. Phase 7's D2 recorded the same class of hazard for its normalisation functions.

**Alternatives considered.** Always generating in the reader's language: violates FR-057. Always
generating in the source language with no option: fails FR-024.

---

## D10 — Redaction before egress, and faked providers in every test

**Decision.** `ai/redact.ts` runs over every outbound request in the shared adapter path — not per
feature — stripping content matching credential, token, and long-digit-sequence shapes, and replacing
it with a marker. It runs for **both** providers, local included.

Every test injects a fake provider at the adapter boundary. No test in the suite makes a network call
or depends on generated text.

**Rationale.** FR-010 and SC-025 require that no secret reaches AI processing. Placing redaction in the
shared path rather than in each feature is the same argument as D1: a new feature added in a later phase
gets the protection without its author remembering. It runs for the local provider too, because
"controlled infrastructure" is a boundary, not a reason to relax — and the customer pasting a card
number into chat (a spec edge case) is exactly the local path.

Faked providers are what make SC-022 achievable and the suite affordable. The tests that matter here
assert structure — that grounding held, that scoping refused, that the invocation was recorded, that
egress went to the right place — and none of those need a real model. The properties that do need one
are SC-002, SC-006, SC-010 and SC-016, which the spec already assigns to human review.

---

## D11 — Ceilings and rate limits reuse Phase 5's limiter; four new scopes

**Decision.** Four scopes through `lib/rate-limit.ts`: `ai-summary`, `ai-draft`, `ai-classify` (keyed by
user id via Phase 8's `rateLimitKeyed`), and `ai-assistant` (keyed by portal account id where signed in,
IP otherwise). Independently, `ai/budget.ts` enforces a **daily invocation ceiling per feature**, counted
from `ai_invocations`, refusing with a distinct error when exhausted.

**Rationale.** FR-005a requires that exhausting the customer-facing allowance cannot deny staff
features, which is the per-scope keying property Phase 5 built the limiter for and Phases 7 and 8 reused
without change. Phase 8 already added the keyed variant this needs.

Rate limiting and the budget are **separate mechanisms for separate failures** and collapsing them would
be wrong: a rate limit stops one principal hammering a surface within a minute; a ceiling stops the
organisation's monthly bill running away across all principals over a day. Either can be hit without the
other. The ceiling is counted from `ai_invocations` rather than an in-memory counter because it must
survive a restart — a spending limit that resets on deploy is not a limit.

FR-005's "make the refusal visible to an administrator" is satisfied by the invocation record carrying
the refusal as an outcome, so the admin view shows exhaustion without a separate mechanism.

---

## D12 — One permission key, `ai.*` audit actions, five flags in one declaration

**Decision.** One new key, `ai:manage`, gating configuration and the activity view. Using a feature is
gated by the underlying authority (FR-061): summarising requires `tickets:view` on that ticket, drafting
requires `messages:send`, accepting a proposal requires `tickets:update`.

New audit actions under `ai.*`: `ai.config.changed`, `ai.feature.enabled`, `ai.feature.disabled`,
`ai.ceiling.changed`, `ai.invocation.failed`, `ai.budget.exhausted`, `ai.summary.requested`,
`ai.draft.generated`, `ai.category.proposed`, `ai.category.accepted`, `ai.category.dismissed`,
`ai.assistant.escalated`.

The five feature flags are declared once in `ai/features.ts` and both the admin surface and every
service read that declaration.

**Rationale.** One key rather than five follows Phase 8's reasoning for `portal:manage` and Phase 6's
for `sla:manage`: the person who may turn the assistant on is the person who may turn summarisation
off, and splitting them produces a roles screen nobody can reason about. FR-060 requires only that it be
distinct from tickets, KB, and channels permissions — it is.

There is deliberately **no `ai:use` key**. A permission every role holds unconditionally cannot refuse
anything; it is noise on the roles screen and a matrix row that cannot fail. Phase 4 kept
`notifications:view` out for this reason, Phase 5 kept `timeline:view` out, Phase 6 kept `sla:view` out.
FR-061 already binds usage to real authority.

One declaration for the flags is what makes FR-002's independence testable: a test iterates
`ai/features.ts`, disables each in turn, and asserts the other four still work.

---

## Open questions

1. **The grounding floor** (`AI_ASSISTANT_GROUNDING_FLOOR`). Too low and the assistant answers from
   weak matches, which is FR-034's failure. Too high and it escalates everything, which makes SC-015's
   30% deflection unreachable. **Every test passes at either extreme.** This is the same hazard Phase 7
   flagged for its suggestion floor and it wants tuning against real questions before enablement.
2. **Whether an accepted category proposal should re-trigger Phase 6 automation.** Accepting sets a
   category, and Phase 6 rules keyed on category were written expecting a human's value at creation
   time. Nothing in the spec asks for re-evaluation and nothing forbids it; left as-is (no re-trigger)
   and recorded so it is a decision.
3. **Whether the assistant should be offered to anonymous chat visitors at all in this phase**, or only
   to signed-in portal customers. FR-033 says both surfaces; D5 supports both. The anonymous case has no
   rate-limit key better than IP and no identity to attribute the conversation to, which is a weaker
   position. Implemented for both, with the flag allowing portal-only operation.
4. **Cost per resolved ticket is unmeasured.** D11 bounds spend but nothing here predicts it. The first
   month of real numbers should be checked against the ceilings before they are raised.
