import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { KbTicketArticle } from '../../src/models/index.js';
import * as attachmentService from '../../src/services/kb-attachment.service.js';
import { seedCustomer } from '../customers/helpers.js';
import { agentAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { makeArticle } from '../search/helpers.js';
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
 * Pinning an article to a ticket by hand (User Story 7).
 *
 * TWO PROPERTIES, AND BOTH ARE ABOUT WHAT A HUMAN DOES BY ACCIDENT.
 *
 *   ATTACHING TWICE IS A NO-OP, NOT A CONFLICT. A double-click is not an error
 *   worth refusing, and a 409 would make the interface handle a case that means
 *   nothing to the agent who caused it.
 *
 *   AN AGENT'S ATTACHMENT IS DISTINGUISHABLE FROM A RULE'S. Null
 *   `attached_by_user_id` means a rule did it — the Phase 5 and 6 convention
 *   for a system act. An agent deciding whether to trust a pinned article needs
 *   to know whether a colleague chose it or a rule matched a word.
 */

const ARTICLE = {
  titleEn: 'Understanding your invoice',
  bodyEn: 'Each line shows the service and the period it covers.',
};

async function ticketFor(agent: Awaited<ReturnType<typeof agentAs>>) {
  return seedTicket({
    customer: await seedCustomer(),
    createdBy: agent.user,
    assignee: agent.user,
    status: 'open',
    subject: 'My invoice is wrong',
  });
}

describe('an agent can pin an article', () => {
  it('attaches it and records who did', async () => {
    const agent = await agentAs('supervisor');
    const ticket = await ticketFor(agent);
    const article = await makeArticle(ARTICLE);

    const response = await agent.agent
      .post(`/api/tickets/${ticket.id}/articles`)
      .send({ articleId: article.id });

    expect(response.status).toBe(200);

    const row = await KbTicketArticle.findOne({
      where: { ticket_id: ticket.id, article_id: article.id },
    });

    expect(row).not.toBeNull();
    expect(row!.attached_by_user_id).toBe(agent.user.id);
  });

  it('treats a second attach of the same article as a no-op, not a conflict', async () => {
    // THE DOUBLE-CLICK CASE. Refusing it would be technically defensible and
    // practically useless: nothing about the world is wrong afterwards.
    const agent = await agentAs('supervisor');
    const ticket = await ticketFor(agent);
    const article = await makeArticle(ARTICLE);

    const first = await agent.agent
      .post(`/api/tickets/${ticket.id}/articles`)
      .send({ articleId: article.id });
    const second = await agent.agent
      .post(`/api/tickets/${ticket.id}/articles`)
      .send({ articleId: article.id });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    expect(await KbTicketArticle.count({ where: { ticket_id: ticket.id } })).toBe(1);
  });

  it('keeps the FIRST attributor when attached twice by different people', async () => {
    // Who first decided this article answers the ticket is the interesting
    // fact. A second person clicking the same button did not decide anything
    // new, and overwriting would erase the decision that was actually made.
    const first = await agentAs('supervisor');
    const second = await agentAs('admin');
    const ticket = await ticketFor(first);
    const article = await makeArticle(ARTICLE);

    await first.agent.post(`/api/tickets/${ticket.id}/articles`).send({ articleId: article.id });
    await second.agent.post(`/api/tickets/${ticket.id}/articles`).send({ articleId: article.id });

    const row = await KbTicketArticle.findOne({ where: { ticket_id: ticket.id } });
    expect(row!.attached_by_user_id).toBe(first.user.id);
  });

  it('unpins', async () => {
    const agent = await agentAs('supervisor');
    const ticket = await ticketFor(agent);
    const article = await makeArticle(ARTICLE);

    await agent.agent.post(`/api/tickets/${ticket.id}/articles`).send({ articleId: article.id });

    const removed = await agent.agent.delete(`/api/tickets/${ticket.id}/articles/${article.id}`);

    expect(removed.status).toBe(204);
    expect(await KbTicketArticle.count({ where: { ticket_id: ticket.id } })).toBe(0);
  });

  it('answers 404 when unpinning something that is not pinned', async () => {
    // Not a silent success: an agent whose click did nothing should find out.
    const agent = await agentAs('supervisor');
    const ticket = await ticketFor(agent);
    const article = await makeArticle(ARTICLE);

    const removed = await agent.agent.delete(`/api/tickets/${ticket.id}/articles/${article.id}`);

    expect(removed.status).toBe(404);
  });
});

describe('a person and a rule are distinguishable as attributors', () => {
  it('records a user id for a person and null for a rule', async () => {
    const agent = await agentAs('supervisor');
    const ticket = await ticketFor(agent);

    const byPerson = await makeArticle(ARTICLE);
    const byRule = await makeArticle({ ...ARTICLE, titleEn: 'Payment methods' });

    await agent.agent.post(`/api/tickets/${ticket.id}/articles`).send({ articleId: byPerson.id });
    // The automation executor's call, made directly: null actor.
    await attachmentService.attach(ticket.id, byRule.id, null);

    const rows = await KbTicketArticle.findAll({ where: { ticket_id: ticket.id } });
    const attributions = new Map(rows.map((row) => [row.article_id, row.attached_by_user_id]));

    expect(attributions.get(byPerson.id)).toBe(agent.user.id);
    expect(attributions.get(byRule.id)).toBeNull();
  });
});

describe('what cannot be pinned', () => {
  it('refuses a draft or an archived article', async () => {
    // An article that is not published has not been through the only quality
    // gate this content has. Pinning it would put unreviewed text in front of
    // an agent as though somebody had approved it.
    const agent = await agentAs('supervisor');
    const ticket = await ticketFor(agent);

    const draft = await makeArticle({ ...ARTICLE, status: 'draft' });
    const archived = await makeArticle({ ...ARTICLE, status: 'archived' });

    for (const article of [draft, archived]) {
      const response = await agent.agent
        .post(`/api/tickets/${ticket.id}/articles`)
        .send({ articleId: article.id });

      expect(response.status).toBe(400);
      expect(response.body.error.details[0].message).toBe('kb.attach.error.articleNotPublished');
    }

    expect(await KbTicketArticle.count({ where: { ticket_id: ticket.id } })).toBe(0);
  });

  it('refuses an article that does not exist', async () => {
    const agent = await agentAs('supervisor');
    const ticket = await ticketFor(agent);

    const response = await agent.agent
      .post(`/api/tickets/${ticket.id}/articles`)
      .send({ articleId: 999999 });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].message).toBe('kb.attach.error.articleUnknown');
  });

  it('refuses an agent without tickets:update', async () => {
    // Pinning changes the TICKET's working context, so it is gated by the
    // ticket permission rather than by a knowledge key.
    const { Role, RolePermission } = await import('../../src/models/index.js');
    const owner = await agentAs('supervisor');
    const ticket = await ticketFor(owner);
    const article = await makeArticle(ARTICLE);

    const agentRole = await Role.findOne({ where: { key: 'agent' } });
    await RolePermission.destroy({
      where: { role_id: agentRole!.id, permission_key: 'tickets:update' },
    });

    const reader = await agentAs('agent');
    const response = await reader.agent
      .post(`/api/tickets/${ticket.id}/articles`)
      .send({ articleId: article.id });

    expect(response.status).toBe(403);
  });
});

describe('a pinned article is labelled with the language actually served', () => {
  it('does not report an English title as Arabic on an Arabic ticket (FR-005a)', async () => {
    // THE BUG THIS TEST EXISTS TO PIN. Preferring the ticket's language and
    // falling back to whatever the article has is correct. Reporting the
    // PREFERRED language after falling back is not: the panel would render an
    // English title with `lang="ar"` and `dir="rtl"`, which looks like a
    // rendering fault rather than a one-language article — and sends the reader
    // to reload instead of to a colleague who reads English.
    const suggestionService = await import('../../src/services/kb-suggestion.service.js');

    const agent = await agentAs('supervisor');
    const ticket = await seedTicket({
      customer: await seedCustomer(),
      createdBy: agent.user,
      status: 'open',
      subject: 'قارئ البطاقة يعيد التشغيل عند إدخال البطاقة',
    });

    // English only.
    const article = await makeArticle(ARTICLE);
    await attachmentService.attach(ticket.id, article.id, agent.user.id);

    const suggestions = await suggestionService.suggestForTicket(ticket.id);
    const pinned = suggestions.find((s) => s.articleId === article.id);

    expect(pinned).toBeDefined();
    expect(pinned!.title).toBe(ARTICLE.titleEn);
    expect(pinned!.lang).toBe('en');
  });

  it('prefers the ticket language when the article has both', async () => {
    const suggestionService = await import('../../src/services/kb-suggestion.service.js');

    const agent = await agentAs('supervisor');
    const ticket = await seedTicket({
      customer: await seedCustomer(),
      createdBy: agent.user,
      status: 'open',
      subject: 'قارئ البطاقة يعيد التشغيل عند إدخال البطاقة',
    });

    const article = await makeArticle({
      ...ARTICLE,
      titleAr: 'فهم فاتورتك',
      bodyAr: 'يوضح كل سطر الخدمة والفترة التي يغطيها.',
    });

    await attachmentService.attach(ticket.id, article.id, agent.user.id);

    const pinned = (await suggestionService.suggestForTicket(ticket.id)).find(
      (s) => s.articleId === article.id,
    );

    expect(pinned!.lang).toBe('ar');
    expect(pinned!.title).toBe('فهم فاتورتك');
  });
});
