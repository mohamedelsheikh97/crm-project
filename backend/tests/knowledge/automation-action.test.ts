import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { newContext } from '../../src/automation/events.js';
import type { AutomationEvent } from '../../src/automation/events.js';
import { AutomationRule, AutomationRun, KbTicketArticle, Ticket } from '../../src/models/index.js';
import * as automationService from '../../src/services/automation.service.js';
import * as engine from '../../src/services/automation-engine.service.js';
import { seedCustomer } from '../customers/helpers.js';
import { agentAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { makeArticle } from '../search/helpers.js';
import { seedTicket } from '../tickets/helpers.js';
import { createCategory } from './helpers.js';

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
 * The `suggest_article` automation action (User Story 7, FR-046, FR-047).
 *
 * Phase 6's catalog comment predicted this exactly — "one entry here plus one
 * executor branch" — and it cost precisely that. The interesting behaviour is
 * therefore not that it works, but WHAT IT DOES WHEN THE ARTICLE IS GONE.
 *
 * FR-047: a rule naming an archived or deleted article FAILS WITH A RECORDED
 * REASON rather than silently doing nothing. That distinction is the whole
 * point of the requirement. An article gets archived because somebody decided
 * it was wrong; a rule that quietly stopped attaching it leaves a supervisor
 * believing the rule is still helping, and the run record — the one place they
 * would look — shows a clean 'acted' or nothing at all.
 */

async function actorFor() {
  const { user } = await agentAs('admin');
  return { id: user.id, email: user.email, fullName: user.full_name, roleId: user.role_id };
}

async function makeRule(articleId: number): Promise<AutomationRule> {
  const actor = await actorFor();

  const view = await automationService.createRule(
    {
      name: 'Billing tickets get the billing FAQ',
      triggerKey: 'ticket.created',
      conditions: [{ field: 'ticket.category', operator: 'is', value: 'billing' }],
      actions: [{ action: 'suggest_article', params: { articleId } }],
    },
    actor,
  );

  await automationService.setEnabled(view.id, true, actor);

  return (await AutomationRule.findByPk(view.id)) as AutomationRule;
}

async function billingTicket(): Promise<Ticket> {
  const { user } = await agentAs('supervisor');

  return seedTicket({
    customer: await seedCustomer(),
    createdBy: user,
    status: 'open',
    category: 'billing',
    subject: 'My invoice is wrong',
  });
}

function creationEvent(ticketId: number): AutomationEvent {
  return { trigger: 'ticket.created', ticketId, actorUserId: null };
}

describe('a rule can attach an article to a ticket', () => {
  it('attaches it, and records the run as acted', async () => {
    const category = await createCategory({ ticketCategory: 'billing' });
    const article = await makeArticle({
      titleEn: 'Understanding your invoice',
      bodyEn: 'Each line shows the service and the period it covers.',
      categoryId: category.id,
    });

    const rule = await makeRule(article.id);
    const ticket = await billingTicket();

    await engine.run(creationEvent(ticket.id), newContext('ticket.created'));

    const attachment = await KbTicketArticle.findOne({
      where: { ticket_id: ticket.id, article_id: article.id },
    });

    expect(attachment).not.toBeNull();
    // NULL MEANS A RULE DID IT — the Phase 5 and 6 convention for a system act,
    // and what lets the panel tell "a colleague pinned this" from "a rule did".
    expect(attachment!.attached_by_user_id).toBeNull();

    const runs = await AutomationRun.findAll({ where: { rule_id: rule.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.outcome).toBe('acted');
  });

  it('does nothing on a ticket the rule does not match', async () => {
    const article = await makeArticle({
      titleEn: 'Understanding your invoice',
      bodyEn: 'Each line shows the service and the period it covers.',
    });

    const rule = await makeRule(article.id);

    const { user } = await agentAs('supervisor');
    const ticket = await seedTicket({
      customer: await seedCustomer(),
      createdBy: user,
      status: 'open',
      category: 'technical',
    });

    await engine.run(creationEvent(ticket.id), newContext('ticket.created'));

    expect(await KbTicketArticle.count({ where: { ticket_id: ticket.id } })).toBe(0);

    const runs = await AutomationRun.findAll({ where: { rule_id: rule.id } });
    expect(runs[0]!.outcome).toBe('no_match');
  });
});

describe('a rule naming an article that is gone FAILS LOUDLY (FR-047)', () => {
  it('records a failed run with a reason when the article is archived', async () => {
    // THE ASSERTION THIS FILE EXISTS FOR. The article was archived because
    // somebody decided it was wrong. Attaching it anyway would put a wrong
    // answer in front of an agent with a rule's authority behind it; doing
    // nothing quietly would leave a supervisor believing the rule still works.
    const article = await makeArticle({
      titleEn: 'Understanding your invoice',
      bodyEn: 'Each line shows the service and the period it covers.',
    });

    const rule = await makeRule(article.id);

    await article.update({ status: 'archived' });

    const ticket = await billingTicket();
    await engine.run(creationEvent(ticket.id), newContext('ticket.created'));

    expect(await KbTicketArticle.count({ where: { ticket_id: ticket.id } })).toBe(0);

    const runs = await AutomationRun.findAll({ where: { rule_id: rule.id } });

    expect(runs).toHaveLength(1);
    expect(runs[0]!.outcome).toBe('failed');
    // A REASON, not merely a failure — and an i18n key rather than a sentence,
    // because the same row may be read by an Arabic user and an English one.
    //
    // It lives in `actions_applied` rather than the run-level `detail`, which is
    // the EXISTING failure path: a run may apply several actions, so 'why' is a
    // property of the action rather than of the run. `apply_assignment_strategy`
    // records its refusals the same way, and the runs screen renders per action.
    expect(runs[0]!.actions_applied).toEqual([
      expect.objectContaining({
        action: 'suggest_article',
        result: 'failed',
        detail: 'kb.attach.error.articleNotPublished',
      }),
    ]);
  });

  it('records a failed run when the article no longer exists at all', async () => {
    const rule = await makeRule(999999);
    const ticket = await billingTicket();

    await engine.run(creationEvent(ticket.id), newContext('ticket.created'));

    const runs = await AutomationRun.findAll({ where: { rule_id: rule.id } });

    expect(runs[0]!.outcome).toBe('failed');
    expect(runs[0]!.actions_applied).toEqual([
      expect.objectContaining({ result: 'failed', detail: 'kb.attach.error.articleUnknown' }),
    ]);
  });

  it('records a failed run for a draft, which was never in front of anybody', async () => {
    const article = await makeArticle({
      titleEn: 'Understanding your invoice',
      bodyEn: 'Each line shows the service and the period it covers.',
      status: 'draft',
    });

    const rule = await makeRule(article.id);
    const ticket = await billingTicket();

    await engine.run(creationEvent(ticket.id), newContext('ticket.created'));

    const runs = await AutomationRun.findAll({ where: { rule_id: rule.id } });
    expect(runs[0]!.outcome).toBe('failed');
  });

  it('does not abort the other actions in the rule (FR-065)', async () => {
    // A failing action must not discard the ones that worked. The existing
    // failure path already guarantees this; asserting it here proves the new
    // branch joined that path rather than inventing its own.
    const actor = await actorFor();

    const view = await automationService.createRule(
      {
        name: 'Attach and escalate',
        triggerKey: 'ticket.created',
        conditions: [{ field: 'ticket.category', operator: 'is', value: 'billing' }],
        actions: [
          { action: 'suggest_article', params: { articleId: 999999 } },
          { action: 'set_priority', params: { priority: 'high' } },
        ],
      },
      actor,
    );

    await automationService.setEnabled(view.id, true, actor);

    const ticket = await billingTicket();
    await engine.run(creationEvent(ticket.id), newContext('ticket.created'));

    // The sibling action still ran.
    expect((await Ticket.findByPk(ticket.id))!.priority).toBe('high');

    // And the failure is still recorded beside the success, action by action.
    const runs = await AutomationRun.findAll({ where: { rule_id: view.id } });
    expect(runs[0]!.actions_applied).toEqual([
      expect.objectContaining({
        action: 'suggest_article',
        result: 'failed',
        detail: 'kb.attach.error.articleUnknown',
      }),
      expect.objectContaining({ action: 'set_priority', result: 'ok' }),
    ]);
  });
});

describe('the attachment appears as a pinned suggestion', () => {
  it('shows up on the ticket, marked as attached by a rule', async () => {
    const suggestionService = await import('../../src/services/kb-suggestion.service.js');

    const article = await makeArticle({
      titleEn: 'Understanding your invoice',
      bodyEn: 'Each line shows the service and the period it covers.',
    });

    await makeRule(article.id);
    const ticket = await billingTicket();

    await engine.run(creationEvent(ticket.id), newContext('ticket.created'));

    const suggestions = await suggestionService.suggestForTicket(ticket.id);
    const pinned = suggestions.find((s) => s.articleId === article.id);

    expect(pinned).toBeDefined();
    expect(pinned!.pinned).toBe(true);
    // Null attachedBy is how the panel says "a rule did this".
    expect(pinned!.attachedBy).toBeNull();
  });
});
