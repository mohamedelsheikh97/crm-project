import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuditLog } from '../../src/models/index.js';
import { agentAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { ENGLISH_ARTICLE, createCategory } from './helpers.js';

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
 * FR-009: changes to article content are answerable.
 *
 * ARTICLE CONTENT IS ORGANISATIONAL SPEECH. Published words that colleagues act
 * on and customers read, in the organisation's name. "Who changed the refund
 * policy article, and when" is a question somebody will eventually ask under
 * pressure, and there is no version history to answer it with (spec
 * Assumptions) — so the audit log is the whole of the answer.
 *
 * READS ARE DELIBERATELY NOT AUDITED, and the last test here asserts that. The
 * view counter is the record of reading (FR-049) and it holds no reader
 * identity by design (FR-050). Auditing page views would flood the log an
 * investigator reads with the one event that is never what they are looking
 * for — and the public help centre makes that worse, because those reads come
 * from strangers in volume.
 */

async function actionsFor(articleId: number): Promise<string[]> {
  const rows = await AuditLog.findAll({
    where: { target_type: 'kb_article', target_id: articleId },
    order: [['id', 'ASC']],
  });

  return rows.map((row) => row.action);
}

describe('every lifecycle act is recorded with its actor', () => {
  it('records create, edit, publish, archive, and restore', async () => {
    const publisher = await agentAs('supervisor');
    const category = await createCategory();

    const created = await publisher.agent
      .post('/api/knowledge/articles')
      .send({ categoryId: category.id, ...ENGLISH_ARTICLE });

    const id = created.body.id as number;

    await publisher.agent
      .patch(`/api/knowledge/articles/${id}`)
      .send({ titleEn: 'Card reader reboots', version: created.body.version });

    await publisher.agent.post(`/api/knowledge/articles/${id}/publish`);
    await publisher.agent.post(`/api/knowledge/articles/${id}/archive`);
    await publisher.agent.post(`/api/knowledge/articles/${id}/restore`);

    expect(await actionsFor(id)).toEqual([
      'kb.article.created',
      'kb.article.updated',
      'kb.article.published',
      'kb.article.archived',
      'kb.article.restored',
    ]);
  });

  it('names the person who did it', async () => {
    const publisher = await agentAs('supervisor');
    const category = await createCategory();

    const created = await publisher.agent
      .post('/api/knowledge/articles')
      .send({ categoryId: category.id, ...ENGLISH_ARTICLE });

    await publisher.agent.post(`/api/knowledge/articles/${created.body.id}/publish`);

    const entry = await AuditLog.findOne({
      where: { target_type: 'kb_article', target_id: created.body.id, action: 'kb.article.published' },
    });

    expect(entry?.actor_user_id).toBe(publisher.user.id);
    expect(entry?.actor_email).toBe(publisher.user.email);
  });

  it('records nothing when the publish is refused', async () => {
    // The audit entry is written inside the same transaction as the change, so
    // a refusal leaves no trace of a publication that never happened. A log
    // recording attempts as though they were acts is worse than no log.
    const publisher = await agentAs('supervisor');
    const category = await createCategory();

    const created = await publisher.agent
      .post('/api/knowledge/articles')
      .send({ categoryId: category.id, titleEn: 'Half-written' });

    const refused = await publisher.agent.post(
      `/api/knowledge/articles/${created.body.id}/publish`,
    );

    expect(refused.status).toBe(422);
    expect(await actionsFor(created.body.id)).toEqual(['kb.article.created']);
  });
});

describe('reads are not audited', () => {
  it('writes no audit entry when an article is opened', async () => {
    const publisher = await agentAs('supervisor');
    const category = await createCategory();

    const created = await publisher.agent
      .post('/api/knowledge/articles')
      .send({ categoryId: category.id, ...ENGLISH_ARTICLE });

    await publisher.agent.post(`/api/knowledge/articles/${created.body.id}/publish`);

    const before = await actionsFor(created.body.id);

    await publisher.agent.get(`/api/knowledge/articles/${created.body.id}`);
    await publisher.agent.get(`/api/knowledge/articles/${created.body.id}`);
    await publisher.agent.get(`/api/knowledge/articles/${created.body.id}`);

    expect(await actionsFor(created.body.id)).toEqual(before);
  });
});
