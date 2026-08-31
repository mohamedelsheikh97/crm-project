# Contract: The Automation Engine

**Feature**: `007-phase-6-sla-automation` | **Date**: 2026-08-31

This is the closed catalog (research D9) and the execution contract (D10). The catalog is the whole of
FR-058's bounded authority: a rule can do nothing that is not listed here, enforced at write time, so
the executor may trust its input.

`backend/src/automation/catalog.ts` is the single declaration. The API that lists the catalog to the
builder screen, the validator that accepts a rule, and the executor that runs one all read the same
constant. Nothing holds a second copy.

---

## Triggers

| `trigger_key` | Emitted by | Event payload |
| --- | --- | --- |
| `ticket.created` | `ticket.service.create`, `intake.service.accept` | `{ ticketId, actorUserId }` |
| `ticket.status_changed` | `ticket-lifecycle.service.transition` | `{ ticketId, from, to, actorUserId }` |
| `ticket.priority_changed` | `ticket.service.update` | `{ ticketId, from, to, actorUserId }` |
| `ticket.assigned` | `ticket.service.assign` | `{ ticketId, assigneeUserId, actorUserId }` |
| `ticket.unassigned` | `ticket.service.assign` | `{ ticketId, actorUserId }` |
| `message.received` | `intake.service.accept` | `{ ticketId, messageId, channel }` |
| `sla.at_risk` | `sla-escalation.service` | `{ ticketId, target: 'response' \| 'resolution' }` |
| `sla.breached` | `sla-escalation.service` | `{ ticketId, target: 'response' \| 'resolution' }` |

FR-056 names six trigger classes; these eight cover them, splitting assignment into assigned and
unassigned because a rule reacting to work being taken away is a different rule.

**Emission is an explicit service call, never a Sequelize hook** (D10):

```ts
// Inside the service, AFTER the mutation, INSIDE the transaction:
automation.emit({ trigger: 'ticket.priority_changed', ticketId, from, to, actorUserId }, transaction);
```

`emit` registers a `transaction.afterCommit` callback. It writes nothing and evaluates nothing
synchronously. This is `notification-hub.ts`'s ordering rule applied to automation: **everything runs
after its transaction commits.** A rule that acted on a state which then rolled back is a lie no
query can fix.

---

## Conditions

Every condition is `{ field, operator, value }`. A rule fires only when **all** of them hold
(FR-059); there is no `or`, and the builder says so in words rather than leaving it to be inferred.

| `field` | Type | Operators | Values |
| --- | --- | --- | --- |
| `ticket.priority` | enum | `is`, `is_not`, `in` | `low \| normal \| high \| urgent` |
| `ticket.category` | enum | `is`, `is_not`, `in` | `general \| technical \| billing \| complaint` |
| `ticket.status` | enum | `is`, `is_not`, `in` | the six lifecycle statuses |
| `ticket.source` | enum | `is`, `is_not`, `in` | `manual \| email \| whatsapp \| sms \| chat \| form` |
| `ticket.has_assignee` | boolean | `is` | `true \| false` |
| `ticket.sla_state` | enum | `is`, `is_not` | `none \| on_track \| at_risk \| breached` |
| `customer.is_provisional` | boolean | `is` | `true \| false` |
| `message.channel` | enum | `is`, `in` | the five channels |

`customer.is_provisional` is included because Phase 5 created the concept and a rule that routes an
unverified sender differently is the obvious first use of it. `message.channel` is only evaluable on
a `message.received` trigger; the validator refuses it on any other, with
`automation.error.conditionNotAvailableForTrigger` — a rule that can never fire is a configuration bug
that should be caught at save time.

**No free-text, no regex, no numeric comparison on elapsed time.** FR-054 asks for a screen, not a
syntax, and elapsed-time conditions are what `sla.at_risk` and `sla.breached` triggers already express
correctly.

---

## Actions

Every action executes **through the service a person's request would call** (research D8), with an
actor whose `id` is null. Every guard those services already enforce therefore applies to automation
without a second code path.

| `action` | Params | Executes through | Inherited guards |
| --- | --- | --- | --- |
| `set_priority` | `{ priority }` | `ticket.service.update` | merged-ticket refusal; history; audit |
| `set_category` | `{ category }` | `ticket.service.update` | same |
| `change_status` | `{ status }` | `ticket-lifecycle.service.transition` | **`TRANSITIONS`** — an undeclared edge is refused, and the run is recorded as `failed` with the reason |
| `assign_to_user` | `{ userId }` | `ticket.service.assign` | active user; role holds `tickets:view`; not already assigned by a human (FR-049) |
| `apply_assignment_strategy` | `{}` | `assignment.service.autoAssign` | the whole of FR-045–FR-053 |
| `notify_users` | `{ userIds }` or `{ roleId }` | `alert.service.dispatch` | recipient dedup; ceiling; transport independence |
| `send_customer_message` | `{ bodyKey, templateId? }` | `message.service.send` | **opt-out; automated-mail detection; reply window; per-conversation rate limit; replyable-channel check** |

`send_customer_message` takes a **template id or a locale key, never a raw body**. Two reasons, both
load-bearing: FR-080 requires the recipient's language to be chosen at delivery, and a raw body stored
in a rule is a machine that sends the same English sentence to every customer forever. Phase 4's
reply-template library is the intended source, which is exactly the "Phase 5 adds channels as new
insertion targets" promise Phase 4 Clarifications Q2 made, now collected.

**Not in the catalog, deliberately:**

- **`create_task`** — Phase 4 Clarifications Q3 made tasks personal; a rule cannot create one for
  someone else.
- **`close_ticket`, `reopen_ticket`** — reachable via `change_status` and therefore already governed
  by the lifecycle's `tickets:close` / `tickets:reopen` edges. A dedicated action would invite a
  bypass.
- **`merge_tickets`, `link_tickets`** — merge is irreversible and identity-sensitive; not a thing to
  automate on a stranger's email.
- **`call_webhook`** — Phase 11.
- **`suggest_article`** — Phase 7. One catalog entry plus one executor branch when it lands.

---

## Execution contract

```
event committed
  │
  ├─ load enabled rules for trigger, ORDER BY run_order ASC          (FR-060)
  │
  └─ for each rule:
        ├─ if ctx.depth > AUTOMATION_MAX_DEPTH        → record suppressed, stop   (FR-062)
        ├─ if ctx.seen has "ruleId:ticketId"          → record suppressed, skip   (FR-063, FR-064)
        ├─ evaluate conditions (pure, no writes)
        │     └─ not all true                        → record no_match, next rule
        ├─ ctx.seen.add("ruleId:ticketId")
        └─ for each action, independently:
              ├─ success → note it
              └─ failure → note it, CONTINUE to the next action                  (FR-065)
              └─ any event the action emits runs at ctx.depth + 1
```

**`ExecutionContext`** is created once per originating event and passed down the cascade:

```ts
interface ExecutionContext {
  depth: number;                 // 0 for the originating event
  seen: Set<string>;             // "ruleId:ticketId"
  originTrigger: string;         // for the run record
}
```

`seen` is per originating event, not per rule and not global: FR-064 forbids a rule re-running on the
same ticket within one event's processing, and a global set would wrongly suppress the same rule
legitimately firing for a different event minutes later.

**Nothing propagates.** The whole `afterCommit` body is wrapped; a thrown error is caught, recorded as
`failed`, and logged. FR-071 is not a best effort — a customer's message or an agent's save must never
fail because a rule failed, and the enclosing transaction has already committed by the time any of
this runs, so there is nothing left to roll back.

**`AUTOMATION_MAX_DEPTH` defaults to 3.** Depth 0 is the originating event; three levels of cascade is
enough for "arrival sets priority, priority change triggers assignment, assignment notifies" and short
enough that a cycle is caught within a second.

---

## Rule validation, at write time

Rejections, all with i18n keys:

| Condition | Key |
| --- | --- |
| `trigger_key` not in the catalog | `automation.error.triggerUnknown` |
| condition field not in the catalog | `automation.error.conditionFieldUnknown` |
| operator not permitted for that field | `automation.error.operatorNotAllowed` |
| value not in the field's enumeration | `automation.error.valueInvalid` |
| condition field unavailable for the trigger | `automation.error.conditionNotAvailableForTrigger` |
| `actions_json` empty | `automation.error.actionRequired` |
| action not in the catalog | `automation.error.actionUnknown` |
| action params missing or wrong type | `automation.error.actionParamsInvalid` |
| `change_status` to a status unreachable from **any** status | `automation.error.statusUnreachable` |
| `send_customer_message` naming a deleted template | `automation.error.templateMissing` |

The `statusUnreachable` check is deliberately weak — it only rejects a status no edge in `TRANSITIONS`
reaches at all. Whether *this* ticket can reach it depends on its current status and is a runtime
question, answered by the lifecycle service and recorded as a `failed` run. Validating it harder at
save time would reject legitimate rules.

---

## Rules API — `/api/automation/rules`

Guard: `automation:manage`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/catalog` | The three catalogs, with i18n keys per entry — so the builder screen can never offer something the validator would refuse. |
| `GET` | `/` | All rules in `run_order`. |
| `POST` | `/` | Create. **Always created disabled** (FR-061, and so a rule must be tested before it fires). |
| `PATCH` | `/:id` | Edit. Requires `version`. |
| `POST` | `/:id/enable` · `/:id/disable` | FR-061. |
| `PUT` | `/order` | `{ ruleIds: [...] }` — the whole sequence, one transaction. |
| `POST` | `/:id/dry-run` | FR-066. |
| `DELETE` | `/:id` | Deletes the rule; `automation_runs` survives (FR-070). |

### Dry run

`POST /api/automation/rules/:id/dry-run` — or with an unsaved rule body, so a rule can be tested
before it is created.

```json
{
  "sampleSize": 50,
  "matched": [
    {
      "ticket": { "id": 1042, "reference": "TKT-1042", "subject": "Late delivery" },
      "wouldApply": [{ "action": "set_priority", "to": "high" }]
    }
  ],
  "unmatchedCount": 47
}
```

Evaluated over the 50 most recent non-merged tickets (research, open question 2). **Writes nothing**
— the condition evaluator is pure and separate from the action executor, which is what makes the
dry-run trustworthy rather than a simulation that might have side effects. Actions are *described*,
not executed, and the description is produced by the same catalog entry the executor reads, so a
dry-run cannot promise something the executor would do differently.

---

## Test obligations this contract creates

Named here so `/speckit-tasks` cannot omit them:

1. **Catalog validation is exhaustive.** A generated test iterates every catalog entry and asserts the
   validator accepts a well-formed rule using it — so an entry added without validator support fails
   here, in the manner of Phase 1's permission matrix.
2. **Cycle suppression terminates.** Two rules that trigger each other, and one that triggers itself,
   both terminate at the bound with a `suppressed` run recorded, and the process stays responsive
   (SC-011).
3. **Ordering is deterministic.** Two rules matching one event apply in `run_order`, verified by
   asserting the final state that only one order could produce.
4. **A failed action does not abort its siblings** (FR-065), and a failing rule does not fail its
   trigger (FR-071) — the latter asserted by the triggering request still returning `200`.
5. **The system actor cannot exceed a person's authority**: a rule assigning to a deactivated user
   fails, and a rule transitioning along an undeclared edge fails — both with a recorded reason, and
   neither by a bypass.
