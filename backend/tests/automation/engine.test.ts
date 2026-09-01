import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ACTIONS, CONDITION_FIELDS, TRIGGERS } from '../../src/automation/catalog.js';
import { cascade, newContext } from '../../src/automation/events.js';
import type { AutomationEvent } from '../../src/automation/events.js';
import { AutomationRule, AutomationRun, Ticket, User } from '../../src/models/index.js';
import * as automationService from '../../src/services/automation.service.js';
import * as engine from '../../src/services/automation-engine.service.js';
import { seedCustomer } from '../customers/helpers.js';
import { agentAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { seedTicket } from '../tickets/helpers.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestDatabase();
});

/**
 * The rule engine (FR-054-FR-071).
 *
 * The claim being tested throughout is NOT "rules work" but "a rule cannot do
 * something a person could not, cannot loop, and cannot break what triggered
 * it". Those three are what make a trigger-condition-action builder safe to
 * expose to a supervisor when one of its triggers is "a stranger sent an email".
 */

async function actorFor(): Promise<{
  id: number;
  email: string;
  fullName: string;
  roleId: number;
}> {
  const { user } = await agentAs('admin');
  return { id: user.id, email: user.email, fullName: user.full_name, roleId: user.role_id };
}

async function makeRule(
  definition: Record<string, unknown>,
  enable = true,
): Promise<AutomationRule> {
  const actor = await actorFor();
  const view = await automationService.createRule(definition, actor);

  if (enable) await automationService.setEnabled(view.id, true, actor);

  return (await AutomationRule.findByPk(view.id)) as AutomationRule;
}

async function subjectTicket(
  overrides: Partial<{
    priority: 'low' | 'normal' | 'high' | 'urgent';
    category: 'general' | 'billing';
  }> = {},
): Promise<Ticket> {
  const { user } = await agentAs('supervisor');

  return seedTicket({
    customer: await seedCustomer(),
    createdBy: user,
    assignee: user,
    status: 'open',
    priority: overrides.priority ?? 'normal',
    category: overrides.category ?? 'general',
  });
}

function creationEvent(ticketId: number): AutomationEvent {
  return { trigger: 'ticket.created', ticketId, actorUserId: null };
}

/**
 * FR-058's bounded authority, asserted GENERATIVELY.
 *
 * Iterating the catalog rather than listing entries by hand is the same
 * discipline Phase 1's permission matrix uses: an entry added without validator
 * support fails HERE, in the phase that added it, rather than shipping as a
 * rule nobody can save.
 */
describe('the catalog and the validator agree (FR-058)', () => {
  it('accepts a well-formed rule for every trigger', async () => {
    const actor = await actorFor();

    for (const trigger of TRIGGERS) {
      const view = await automationService.createRule(
        {
          name: `Rule for ${trigger.key}`,
          triggerKey: trigger.key,
          conditions: [],
          actions: [{ action: 'set_priority', params: { priority: 'high' } }],
        },
        actor,
      );

      expect(view.triggerKey).toBe(trigger.key);
    }
  });

  it('accepts a well-formed condition for every field', async () => {
    const actor = await actorFor();

    for (const field of CONDITION_FIELDS) {
      // A field restricted to one trigger must be tested against that trigger,
      // which is itself the FR-059 rule the validator enforces.
      const triggerKey = field.onlyForTriggers?.[0] ?? 'ticket.created';

      const view = await automationService.createRule(
        {
          name: `Condition ${field.key}`,
          triggerKey,
          conditions: [{ field: field.key, operator: field.operators[0], value: field.values[0] }],
          actions: [{ action: 'set_priority', params: { priority: 'high' } }],
        },
        actor,
      );

      expect(view.conditions).toHaveLength(1);
    }
  });

  it('accepts a well-formed rule for every action', async () => {
    const actor = await actorFor();
    const { user } = await agentAs('agent');

    const paramsFor: Record<string, Record<string, unknown>> = {
      set_priority: { priority: 'high' },
      set_category: { category: 'billing' },
      change_status: { status: 'pending' },
      assign_to_user: { userId: user.id },
      apply_assignment_strategy: {},
      notify_users: { userIds: [user.id] },
      send_customer_message: { bodyKey: 'automation.body.acknowledged' },
      // Phase 7. Any integer: the VALIDATOR only checks the shape, because an
      // article that exists when a rule is saved can be archived a month later
      // — "does this article exist" is not a fact a validator can settle. The
      // executor checks existence and records a FAILED run when it is gone
      // (FR-047), which is asserted in tests/knowledge/automation-action.test.ts.
      suggest_article: { articleId: 1 },
    };

    for (const action of ACTIONS) {
      const view = await automationService.createRule(
        {
          name: `Action ${action.key}`,
          triggerKey: 'ticket.created',
          conditions: [],
          actions: [{ action: action.key, params: paramsFor[action.key] ?? {} }],
        },
        actor,
      );

      expect(view.actions[0]?.action).toBe(action.key);
    }
  });
});

describe('the validator refuses what the catalog does not contain', () => {
  it('refuses an unknown trigger, field, operator, value and action', async () => {
    const actor = await actorFor();
    const base = {
      name: 'Bad',
      triggerKey: 'ticket.created',
      conditions: [],
      actions: [{ action: 'set_priority', params: { priority: 'high' } }],
    };

    const cases: Array<[string, Record<string, unknown>]> = [
      ['automation.error.triggerUnknown', { ...base, triggerKey: 'ticket.exploded' }],
      [
        'automation.error.conditionFieldUnknown',
        { ...base, conditions: [{ field: 'ticket.mood', operator: 'is', value: 'sad' }] },
      ],
      [
        'automation.error.operatorNotAllowed',
        { ...base, conditions: [{ field: 'ticket.priority', operator: 'matches', value: 'high' }] },
      ],
      [
        'automation.error.valueInvalid',
        {
          ...base,
          conditions: [{ field: 'ticket.priority', operator: 'is', value: 'catastrophic' }],
        },
      ],
      [
        'automation.error.actionUnknown',
        { ...base, actions: [{ action: 'delete_everything', params: {} }] },
      ],
      ['automation.error.actionRequired', { ...base, actions: [] }],
    ];

    for (const [message, definition] of cases) {
      await expect(automationService.createRule(definition, actor)).rejects.toMatchObject({
        details: expect.arrayContaining([expect.objectContaining({ message })]),
      });
    }
  });

  it('refuses a condition that could never be evaluated for its trigger', async () => {
    const actor = await actorFor();

    // `message.channel` has no meaning on `ticket.created`. A rule that can
    // NEVER fire is a configuration bug to catch at save time, not a silent
    // no-op to discover months later.
    await expect(
      automationService.createRule(
        {
          name: 'Impossible',
          triggerKey: 'ticket.created',
          conditions: [{ field: 'message.channel', operator: 'is', value: 'email' }],
          actions: [{ action: 'set_priority', params: { priority: 'high' } }],
        },
        actor,
      ),
    ).rejects.toMatchObject({
      details: expect.arrayContaining([
        expect.objectContaining({ message: 'automation.error.conditionNotAvailableForTrigger' }),
      ]),
    });
  });
});

describe('a rule fires only when every condition holds (FR-059)', () => {
  it('acts on a matching ticket and records the run', async () => {
    const rule = await makeRule({
      name: 'WhatsApp complaints to high',
      triggerKey: 'ticket.created',
      conditions: [{ field: 'ticket.category', operator: 'is', value: 'billing' }],
      actions: [{ action: 'set_priority', params: { priority: 'high' } }],
    });

    const ticket = await subjectTicket({ category: 'billing', priority: 'normal' });

    await engine.run(creationEvent(ticket.id), newContext('ticket.created'));

    expect((await Ticket.findByPk(ticket.id))?.priority).toBe('high');

    const runs = await AutomationRun.findAll({ where: { rule_id: rule.id } });

    expect(runs).toHaveLength(1);
    expect(runs[0]?.outcome).toBe('acted');
    // FR-070: readable even after the rule is gone.
    expect(runs[0]?.rule_name).toBe('WhatsApp complaints to high');
  });

  it('records a NON-MATCH rather than discarding it', async () => {
    const rule = await makeRule({
      name: 'Billing only',
      triggerKey: 'ticket.created',
      conditions: [{ field: 'ticket.category', operator: 'is', value: 'billing' }],
      actions: [{ action: 'set_priority', params: { priority: 'high' } }],
    });

    const ticket = await subjectTicket({ category: 'general', priority: 'normal' });

    await engine.run(creationEvent(ticket.id), newContext('ticket.created'));

    expect((await Ticket.findByPk(ticket.id))?.priority).toBe('normal');

    const runs = await AutomationRun.findAll({ where: { rule_id: rule.id } });

    // Visibly NOT an error (User Story 4 scenario 2). "The rule never ran" and
    // "the rule ran and did not match" look identical from an empty table.
    expect(runs).toHaveLength(1);
    expect(runs[0]?.outcome).toBe('no_match');
  });

  it('requires ALL conditions, not any', async () => {
    await makeRule({
      name: 'Both or nothing',
      triggerKey: 'ticket.created',
      conditions: [
        { field: 'ticket.category', operator: 'is', value: 'billing' },
        { field: 'ticket.priority', operator: 'is', value: 'urgent' },
      ],
      actions: [{ action: 'set_priority', params: { priority: 'high' } }],
    });

    // Category matches, priority does not.
    const ticket = await subjectTicket({ category: 'billing', priority: 'normal' });

    await engine.run(creationEvent(ticket.id), newContext('ticket.created'));

    expect((await Ticket.findByPk(ticket.id))?.priority).toBe('normal');
  });
});

describe('a disabled rule has no effect, and enabling is not retroactive (FR-061)', () => {
  it('does nothing while disabled and does not replay afterwards', async () => {
    const rule = await makeRule(
      {
        name: 'Disabled',
        triggerKey: 'ticket.created',
        conditions: [],
        actions: [{ action: 'set_priority', params: { priority: 'urgent' } }],
      },
      false,
    );

    const ticket = await subjectTicket({ priority: 'normal' });

    await engine.run(creationEvent(ticket.id), newContext('ticket.created'));

    expect((await Ticket.findByPk(ticket.id))?.priority).toBe('normal');
    expect(await AutomationRun.count({ where: { rule_id: rule.id } })).toBe(0);

    // Enabling it does NOT reach back for the event that already passed.
    await automationService.setEnabled(rule.id, true, await actorFor());

    expect((await Ticket.findByPk(ticket.id))?.priority).toBe('normal');
  });

  it('is created disabled, so a rule must be switched on deliberately', async () => {
    const view = await automationService.createRule(
      {
        name: 'Fresh',
        triggerKey: 'ticket.created',
        conditions: [],
        actions: [{ action: 'set_priority', params: { priority: 'high' } }],
      },
      await actorFor(),
    );

    expect(view.isEnabled).toBe(false);
  });
});

describe('ordering is defined and deterministic (FR-060)', () => {
  it('applies rules in run order, not in creation order', async () => {
    const actor = await actorFor();

    const first = await makeRule({
      name: 'First: high',
      triggerKey: 'ticket.created',
      conditions: [],
      actions: [{ action: 'set_priority', params: { priority: 'high' } }],
    });

    const second = await makeRule({
      name: 'Second: low',
      triggerKey: 'ticket.created',
      conditions: [],
      actions: [{ action: 'set_priority', params: { priority: 'low' } }],
    });

    const ticket = await subjectTicket({ priority: 'normal' });

    await engine.run(creationEvent(ticket.id), newContext('ticket.created'));

    // The LAST rule in run order wins, so the final state names the order —
    // which is the only way to assert ordering without inspecting internals.
    expect((await Ticket.findByPk(ticket.id))?.priority).toBe('low');

    // Reverse the order and the outcome reverses with it.
    await automationService.reorderRules([second.id, first.id], actor);

    const other = await subjectTicket({ priority: 'normal' });
    await engine.run(creationEvent(other.id), newContext('ticket.created'));

    expect((await Ticket.findByPk(other.id))?.priority).toBe('high');
  });
});

describe('execution is bounded (FR-062, FR-063, FR-064, SC-011)', () => {
  it('suppresses a rule that has already run on this ticket in this cascade', async () => {
    const rule = await makeRule({
      name: 'Self-triggering',
      triggerKey: 'ticket.priority_changed',
      conditions: [],
      actions: [{ action: 'set_priority', params: { priority: 'urgent' } }],
    });

    const ticket = await subjectTicket({ priority: 'normal' });
    const context = newContext('ticket.priority_changed');

    const event: AutomationEvent = {
      trigger: 'ticket.priority_changed',
      ticketId: ticket.id,
      actorUserId: null,
      from: 'normal',
      to: 'high',
    };

    // RUN INSIDE THE CASCADE STORE, which is how production reaches the engine:
    // `emit` captures the active context and re-enters it. Calling `run`
    // bare would give every nested emission a fresh context and quietly test
    // the opposite of what FR-063 asks for.
    await cascade.run(context, async () => {
      await engine.run(event, context);
      // The same rule, the same ticket, the same originating event.
      await engine.run(event, context);
    });

    const runs = await AutomationRun.findAll({
      where: { rule_id: rule.id },
      order: [['id', 'ASC']],
    });

    // EXACTLY ONE acts; every other run in the cascade is suppressed — including
    // the one caused by the rule's OWN action emitting `ticket.priority_changed`,
    // which is the case the AsyncLocalStorage context exists for and the one a
    // per-call context would have missed.
    //
    // Asserted as a SET rather than by position: a nested run records before
    // its parent does (the parent records after its actions finish), so row
    // order does not follow logical order and an index-based assertion would be
    // testing insertion timing rather than suppression.
    const acted = runs.filter((run) => run.outcome === 'acted');
    const suppressed = runs.filter((run) => run.outcome === 'suppressed');

    expect(acted).toHaveLength(1);
    expect(suppressed.length).toBeGreaterThanOrEqual(1);
    expect(acted.length + suppressed.length).toBe(runs.length);
    // Recorded with its reason, not silently swallowed.
    expect(suppressed[0]?.detail).toContain('alreadyRan');
  });

  it('suppresses beyond the depth bound and stays responsive', async () => {
    const rule = await makeRule({
      name: 'Deep',
      triggerKey: 'ticket.created',
      conditions: [],
      actions: [{ action: 'set_priority', params: { priority: 'urgent' } }],
    });

    const ticket = await subjectTicket({ priority: 'normal' });
    const deep = { ...newContext('ticket.created'), depth: 99 };

    await engine.run(creationEvent(ticket.id), deep);

    const runs = await AutomationRun.findAll({ where: { rule_id: rule.id } });

    expect(runs).toHaveLength(1);
    expect(runs[0]?.outcome).toBe('suppressed');
    expect(runs[0]?.detail).toContain('depthExceeded');
    // Nothing was applied.
    expect((await Ticket.findByPk(ticket.id))?.priority).toBe('normal');
  });

  it('terminates a mutually triggering pair', async () => {
    // A raises priority on status change; B changes status on priority change.
    await makeRule({
      name: 'A',
      triggerKey: 'ticket.status_changed',
      conditions: [],
      actions: [{ action: 'set_priority', params: { priority: 'urgent' } }],
    });

    await makeRule({
      name: 'B',
      triggerKey: 'ticket.priority_changed',
      conditions: [],
      actions: [{ action: 'change_status', params: { status: 'pending' } }],
    });

    const ticket = await subjectTicket({ priority: 'normal' });
    const context = newContext('ticket.status_changed');

    // If this returns at all, the cycle terminated.
    await engine.run(
      {
        trigger: 'ticket.status_changed',
        ticketId: ticket.id,
        actorUserId: null,
        from: 'new',
        to: 'open',
      },
      context,
    );

    expect(await AutomationRun.count()).toBeGreaterThanOrEqual(1);
  });
});

describe('automation gets no authority a person would not have (FR-058)', () => {
  it('fails rather than forcing an undeclared status transition', async () => {
    const rule = await makeRule({
      name: 'Illegal move',
      triggerKey: 'ticket.created',
      conditions: [],
      // `open -> closed` is NOT a declared edge: Phase 3 requires resolving
      // first, and automation does not get a shortcut around that.
      actions: [{ action: 'change_status', params: { status: 'closed' } }],
    });

    const ticket = await subjectTicket();

    await engine.run(creationEvent(ticket.id), newContext('ticket.created'));

    expect((await Ticket.findByPk(ticket.id))?.status).toBe('open');

    const run = await AutomationRun.findOne({ where: { rule_id: rule.id } });

    expect(run?.outcome).toBe('failed');
  });

  it('fails rather than assigning to a deactivated user', async () => {
    const { user: target } = await agentAs('agent');

    target.is_active = false;
    await target.save();

    const rule = await makeRule({
      name: 'Assign to nobody',
      triggerKey: 'ticket.created',
      conditions: [],
      actions: [{ action: 'assign_to_user', params: { userId: target.id } }],
    });

    const ticket = await subjectTicket();
    const before = (await Ticket.findByPk(ticket.id))?.assignee_user_id;

    await engine.run(creationEvent(ticket.id), newContext('ticket.created'));

    expect((await Ticket.findByPk(ticket.id))?.assignee_user_id).toBe(before);

    const run = await AutomationRun.findOne({ where: { rule_id: rule.id } });

    expect(run?.outcome).toBe('failed');
    expect(JSON.stringify(run?.actions_applied)).toContain('not eligible');
  });
});

describe('a failing action does not abort its siblings (FR-065)', () => {
  it('applies the good action and records the bad one', async () => {
    const rule = await makeRule({
      name: 'One good, one bad',
      triggerKey: 'ticket.created',
      conditions: [],
      actions: [
        // Illegal edge — fails.
        { action: 'change_status', params: { status: 'closed' } },
        // Legitimate — must still happen.
        { action: 'set_priority', params: { priority: 'urgent' } },
      ],
    });

    const ticket = await subjectTicket({ priority: 'normal' });

    await engine.run(creationEvent(ticket.id), newContext('ticket.created'));

    expect((await Ticket.findByPk(ticket.id))?.priority).toBe('urgent');

    const run = await AutomationRun.findOne({ where: { rule_id: rule.id } });
    const applied = run?.actions_applied ?? [];

    expect(run?.outcome).toBe('acted');
    expect(applied).toHaveLength(2);
    expect(applied.some((entry) => entry.result === 'failed')).toBe(true);
    expect(applied.some((entry) => entry.result === 'ok')).toBe(true);
  });
});

describe('the dry run writes nothing (FR-066)', () => {
  it('reports what would match without changing anything', async () => {
    const actor = await actorFor();
    const matching = await subjectTicket({ category: 'billing', priority: 'normal' });
    const other = await subjectTicket({ category: 'general', priority: 'normal' });

    const view = await automationService.createRule(
      {
        name: 'Dry',
        triggerKey: 'ticket.created',
        conditions: [{ field: 'ticket.category', operator: 'is', value: 'billing' }],
        actions: [{ action: 'set_priority', params: { priority: 'urgent' } }],
      },
      actor,
    );

    const result = await automationService.dryRunRule(view.id, {});

    expect(result.matched.map((entry) => entry.ticket.id)).toContain(matching.id);
    expect(result.matched.map((entry) => entry.ticket.id)).not.toContain(other.id);
    expect(result.unmatchedCount).toBeGreaterThanOrEqual(1);

    // NOTHING CHANGED, and nothing was recorded as a run — the condition
    // evaluator is pure and never reaches the action executor.
    expect((await Ticket.findByPk(matching.id))?.priority).toBe('normal');
    expect(await AutomationRun.count()).toBe(0);
  });
});

describe('the run record outlives the rule (FR-070)', () => {
  it('keeps the name after the rule is deleted', async () => {
    const actor = await actorFor();
    const rule = await makeRule({
      name: 'Temporary',
      triggerKey: 'ticket.created',
      conditions: [],
      actions: [{ action: 'set_priority', params: { priority: 'high' } }],
    });

    const ticket = await subjectTicket({ priority: 'normal' });
    await engine.run(creationEvent(ticket.id), newContext('ticket.created'));

    await automationService.deleteRule(rule.id, actor);

    const runs = await AutomationRun.findAll();

    expect(runs).toHaveLength(1);
    expect(runs[0]?.rule_id).toBeNull();
    // The answer to "what changed this ticket overnight?" survives the tidy-up.
    expect(runs[0]?.rule_name).toBe('Temporary');
  });
});

describe('a rule failure never fails its trigger (FR-071)', () => {
  it('lets the request that triggered it succeed', async () => {
    await makeRule({
      name: 'Always fails',
      triggerKey: 'ticket.created',
      conditions: [],
      actions: [{ action: 'change_status', params: { status: 'closed' } }],
    });

    const { agent } = await agentAs('supervisor');
    const customer = await seedCustomer();

    const response = await agent.post('/api/tickets').send({
      customerId: customer.id,
      subject: 'Still created',
      category: 'general',
      priority: 'normal',
    });

    // The rule runs after the commit and cannot reach back into the response.
    expect(response.status).toBe(201);
    expect(User).toBeDefined();
  });
});
