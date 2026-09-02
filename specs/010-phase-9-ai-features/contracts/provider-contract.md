# Contract: The AI Provider Boundary

**Feature**: `010-phase-9-ai-features` | **Date**: 2026-09-02

This is the contract Clarifications Q1 and FR-008a turn into code. It is the most important file in
this phase's design: everything else is a feature, this is the thing that must not be got wrong.

---

## The interface

`backend/src/ai/providers/types.ts`

```text
AiFeature   = 'summary' | 'draft' | 'classify' | 'assistant'
AiLocation  = 'external' | 'local'

AiRequest {
  feature:     AiFeature
  system:      string
  messages:    { role: 'user' | 'assistant', content: string }[]
  maxOutput:   number
  contentLang: 'ar' | 'en'          // D9 — what the model writes, not what the reader sees
}

AiResult {
  text:         string
  inputTokens:  number | null
  outputTokens: number | null
}

AiProvider {
  readonly location: AiLocation
  complete(request: AiRequest): Promise<AiResult>
}
```

**What is deliberately absent.** No model id, no temperature, no provider name, no streaming handle, no
tool definitions. Those are implementation concerns. A service that could set them would be a service
that could change where and how content is processed — and the caller is exactly who must not decide
that.

`similar-ticket.service.ts` implements none of this. It makes no model call (D8).

---

## The two factories

| Module                | Exports              | May be imported by                                    |
| --------------------- | -------------------- | ------------------------------------------------------ |
| `external-factory.ts` | `externalProvider()` | `ai-summary`, `ai-draft`, `ai-classify` services only   |
| `local-factory.ts`    | `localProvider()`    | `assistant.service.ts` only                             |

**`assistant.service.ts` must never import `external-factory.ts`.** This is enforced three ways, and
the redundancy is intentional — FR-008a asks for impossible, not discouraged:

1. **Lint** — `no-restricted-imports` in `eslint.config.js`, scoped by path pattern.
2. **Test** — `backend/tests/ai/egress.test.ts` reads the assistant service's transitive import graph
   from source and fails if `external` appears anywhere in it. Not a mock; a static read.
3. **Runtime** — the shared adapter path asserts `provider.location === 'local'` for
   `feature === 'assistant'` and throws before any network call.

Layer 3 alone would satisfy a careless reading of the requirement. It is the weakest of the three,
because it is the one a refactor can delete while the tests stay green — which is why it is not the
only one.

---

## Egress rules

| Rule                                                          | Enforced by                                    | Verified by |
| ------------------------------------------------------------- | ---------------------------------------------- | ----------- |
| Assistant content never leaves controlled infrastructure       | Import boundary + runtime assertion            | SC-024a     |
| `AI_LOCAL_BASE_URL` resolves to a private address range        | `localProvider()` throws at construction       | SC-024a     |
| No credentials, tokens, or long digit sequences are transmitted | `ai/redact.ts`, in the shared path, both providers | SC-025  |
| Only the content the feature needs is sent                      | Prompt builders take typed inputs, never records | FR-009      |
| No attachment bytes or extracted text are ever sent             | No attachment reaches a prompt builder          | FR-013      |
| Every transmission is recorded                                  | Shared adapter path writes `ai_invocations`    | SC-024      |
| No transmitted or returned text is stored                       | Frozen-column test on `ai_invocations`         | SC-024b     |

**Redaction runs for the local provider too.** "Controlled infrastructure" is a boundary, not a licence
to relax: the spec's own edge case — a customer pasting a card number into chat — travels the local
path, and a card number should not be in a log or a model context regardless of who owns the hardware.

---

## Startup refusal

`env.ts` refuses to start when:

- `AI_ENABLED=true` and no processing location is configured for an enabled feature.
- `AI_ASSISTANT_ENABLED=true` and `AI_LOCAL_BASE_URL` is unset.
- `AI_LOCAL_BASE_URL` is set to a non-private address.
- `AI_EXTERNAL_API_KEY` is absent while any staff-facing feature is enabled.

This is Phase 8's pattern, and its reasoning transfers exactly: a misconfiguration that works perfectly
until somebody notices is worse than one that stops the process. An assistant silently answering
customers through an external provider is precisely that kind of misconfiguration.

---

## Failure semantics

| Condition                              | `complete()` behaviour        | Caller behaviour                                       |
| -------------------------------------- | ----------------------------- | ------------------------------------------------------- |
| Feature disabled                        | Not called                    | Surface not offered (FR-002)                             |
| Budget exhausted                        | Not called                    | Record `refused_budget`; AI surface degrades only (FR-005, SC-027) |
| Provider unreachable / times out        | Throws typed error            | Record `failed`; surface reports failure plainly (FR-003) |
| Provider returns unusable output        | Throws typed error            | Same as above — never render a partial result as success |
| Assistant, grounding below floor        | **Not called** (D3 step 2)    | Record `refused_ungrounded`; locale refusal + escalation offer |
| Assistant, local processing unavailable | Construction throws           | Assistant disabled; Phase 8 ticket route stands (FR-008b, FR-042) |

**No failure mode falls back to the other provider.** FR-008b is explicit for the assistant, and the
reverse is equally forbidden by the import boundary. There is no code path from one to the other.

Retries are bounded (FR-006) and counted against the same ceiling as first attempts — an unbounded
retry on a paid call is a spending bug wearing a reliability costume.

---

## Timeouts

| Feature   | Timeout | Rationale                                              |
| --------- | ------- | ------------------------------------------------------- |
| summary   | 10s     | SC-003's ceiling; the panel reports failure after it.   |
| draft     | 15s     | Agent has explicitly asked and is waiting.              |
| classify  | 8s      | Off the request path entirely (D7); failure is silent.  |
| assistant | 20s     | Conversational; a slow local model is still preferable to a dead end. |

None of these sit on a synchronous user path (FR-004). The ticket opens, the message sends, the portal
loads — and the AI request is a separate call whose failure changes nothing else on the screen.
