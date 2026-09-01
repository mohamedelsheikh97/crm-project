import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Role, RolePermission } from '../../src/models/index.js';
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
 * WHO MAY DO WHAT (FR-052, FR-053).
 *
 * The split between authoring and publishing is the one thing in this phase's
 * permission model that is not obvious, and it is the one thing worth testing
 * carefully. Publishing is the only quality gate this content has, so "may
 * write a draft" must not imply "may put words in front of customers in the
 * organisation's name" — the same separation Phase 5 made between
 * `ticket_notes:create` and `messages:send`.
 */

async function revoke(roleKey: 'agent' | 'supervisor' | 'admin', permissionKey: string) {
  const role = await Role.findOne({ where: { key: roleKey } });
  await RolePermission.destroy({ where: { role_id: role!.id, permission_key: permissionKey } });
}

describe('kb:author may write but NOT publish', () => {
  it('lets an agent create and edit a draft', async () => {
    const author = await agentAs('agent');
    const category = await createCategory();

    const created = await author.agent
      .post('/api/knowledge/articles')
      .send({ categoryId: category.id, ...ENGLISH_ARTICLE });

    expect(created.status).toBe(201);

    const edited = await author.agent
      .patch(`/api/knowledge/articles/${created.body.id}`)
      .send({ titleEn: 'Card reader reboots on insert', version: created.body.version });

    expect(edited.status).toBe(200);
    expect(edited.body.titleEn).toBe('Card reader reboots on insert');
  });

  it('refuses that same agent the publish, archive, and restore actions', async () => {
    // The seeded grants give an Agent kb:author and NOT kb:publish. This is the
    // assertion that keeps the split real rather than documented.
    const author = await agentAs('agent');
    const category = await createCategory();

    const created = await author.agent
      .post('/api/knowledge/articles')
      .send({ categoryId: category.id, ...ENGLISH_ARTICLE });

    for (const action of ['publish', 'archive', 'restore']) {
      const response = await author.agent.post(
        `/api/knowledge/articles/${created.body.id}/${action}`,
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    }
  });
});

describe('kb:publish carries the lifecycle', () => {
  it('lets a supervisor publish, archive, and restore', async () => {
    const publisher = await agentAs('supervisor');
    const category = await createCategory();

    const created = await publisher.agent
      .post('/api/knowledge/articles')
      .send({ categoryId: category.id, ...ENGLISH_ARTICLE });

    expect((await publisher.agent.post(`/api/knowledge/articles/${created.body.id}/publish`)).status)
      .toBe(200);
    expect((await publisher.agent.post(`/api/knowledge/articles/${created.body.id}/archive`)).status)
      .toBe(200);
    expect((await publisher.agent.post(`/api/knowledge/articles/${created.body.id}/restore`)).status)
      .toBe(200);
  });
});

describe('reading a published article needs no key beyond being signed in (FR-053)', () => {
  it('serves a published article to a user holding no kb permission at all', async () => {
    // THE ARGUMENT AGAINST A `kb:read` KEY, stated as a test. A permission every
    // role holds unconditionally cannot refuse anything: it is noise on the
    // roles screen and a matrix row that can never fail. The same reasoning kept
    // `notifications:view` out of Phase 4 and `sla:view` out of Phase 6.
    const publisher = await agentAs('supervisor');
    const category = await createCategory();

    const created = await publisher.agent
      .post('/api/knowledge/articles')
      .send({ categoryId: category.id, ...ENGLISH_ARTICLE });

    await publisher.agent.post(`/api/knowledge/articles/${created.body.id}/publish`);

    await revoke('agent', 'kb:author');
    const reader = await agentAs('agent');

    const response = await reader.agent.get(`/api/knowledge/articles/${created.body.id}`);

    expect(response.status).toBe(200);
    expect(response.body.titleEn).toBe(ENGLISH_ARTICLE.titleEn);
  });

  it('still refuses that reader the authoring actions', async () => {
    await revoke('agent', 'kb:author');
    const reader = await agentAs('agent');
    const category = await createCategory();

    const response = await reader.agent
      .post('/api/knowledge/articles')
      .send({ categoryId: category.id, ...ENGLISH_ARTICLE });

    expect(response.status).toBe(403);
  });

  it('hides drafts from that reader entirely', async () => {
    // Not 403 — 404. Deciding permission before existence is what stops the
    // status code disclosing that a draft is being written (FR-019).
    const author = await agentAs('agent');
    const category = await createCategory();

    const created = await author.agent
      .post('/api/knowledge/articles')
      .send({ categoryId: category.id, ...ENGLISH_ARTICLE });

    await revoke('agent', 'kb:author');
    const reader = await agentAs('agent');

    const single = await reader.agent.get(`/api/knowledge/articles/${created.body.id}`);
    expect(single.status).toBe(404);

    const listed = await reader.agent.get('/api/knowledge/articles');
    expect(listed.body.items.map((a: { id: number }) => a.id)).not.toContain(created.body.id);
  });
});
