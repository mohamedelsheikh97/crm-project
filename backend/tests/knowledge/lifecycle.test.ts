import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { KbArticle } from '../../src/models/index.js';
import { agentAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { ARABIC_ARTICLE, ENGLISH_ARTICLE, createCategory } from './helpers.js';

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
 * The article lifecycle (User Story 2, FR-003 to FR-007).
 *
 * The whole of this story is one idea: an article is visible because somebody
 * DECIDED it should be, and stops being visible without ever being destroyed.
 */

describe('an article starts as a draft (FR-004)', () => {
  it('is created as a draft even though nothing asked for one', async () => {
    const author = await agentAs('agent');
    const category = await createCategory();

    const created = await author.agent
      .post('/api/knowledge/articles')
      .send({ categoryId: category.id, ...ENGLISH_ARTICLE });

    expect(created.status).toBe(201);
    expect(created.body.status).toBe('draft');
    // The safe default for content nobody has considered is "colleagues only".
    expect(created.body.audience).toBe('internal');
    // No slug until publish: a draft has no public URL, and reserving one for a
    // document that may never exist is a name taken for nothing (research D10).
    expect(created.body.slug).toBeNull();
    expect(created.body.publishedAt).toBeNull();
  });

  it('cannot be talked into being published by the request', async () => {
    // FR-004 is structural: `status` is not a parameter, so a caller sending
    // one changes nothing. This is the assertion that keeps it structural if
    // somebody later adds a passthrough "for convenience".
    const author = await agentAs('agent');
    const category = await createCategory();

    const created = await author.agent.post('/api/knowledge/articles').send({
      categoryId: category.id,
      status: 'published',
      audience: 'customer',
      ...ENGLISH_ARTICLE,
    });

    expect(created.body.status).toBe('draft');
    // `audience` IS a legitimate parameter — deciding who an article is for is
    // an authoring decision (FR-031). Only `status` is withheld.
    expect(created.body.audience).toBe('customer');
  });

  it('refuses an article with no category (FR-010)', async () => {
    // An article that only search can reach is one nobody can browse to, so
    // filing is mandatory rather than encouraged.
    const author = await agentAs('agent');

    const created = await author.agent.post('/api/knowledge/articles').send(ENGLISH_ARTICLE);

    expect(created.status).toBe(400);
    expect(created.body.error.details[0].message).toBe('kb.error.categoryRequired');
  });
});

describe('publishing (FR-006)', () => {
  it('records when it went live and who put it there, and fixes the slug', async () => {
    const publisher = await agentAs('supervisor');
    const category = await createCategory();

    const created = await publisher.agent
      .post('/api/knowledge/articles')
      .send({ categoryId: category.id, ...ENGLISH_ARTICLE });

    const published = await publisher.agent.post(
      `/api/knowledge/articles/${created.body.id}/publish`,
    );

    expect(published.status).toBe(200);
    expect(published.body.status).toBe('published');
    expect(published.body.publishedAt).not.toBeNull();
    expect(published.body.slug).toBe('card-reader-keeps-rebooting');

    const row = await KbArticle.findByPk(created.body.id);
    expect(row?.published_by_user_id).toBe(publisher.user.id);
  });

  it('publishes a one-language article, and says which language it has', async () => {
    // Clarifications Q3: a one-language article is legitimate, not a defect.
    // `availableLanguages` is what FR-005a depends on — an unlabelled
    // single-language article looks like a page that failed to load.
    const publisher = await agentAs('supervisor');
    const category = await createCategory();

    const created = await publisher.agent
      .post('/api/knowledge/articles')
      .send({ categoryId: category.id, ...ARABIC_ARTICLE });

    const published = await publisher.agent.post(
      `/api/knowledge/articles/${created.body.id}/publish`,
    );

    expect(published.status).toBe(200);
    expect(published.body.availableLanguages).toEqual(['ar']);
  });
});

describe('archiving removes without destroying (FR-007)', () => {
  it('hides an article from readers while leaving it intact and restorable', async () => {
    const publisher = await agentAs('supervisor');
    const category = await createCategory();

    const created = await publisher.agent
      .post('/api/knowledge/articles')
      .send({ categoryId: category.id, ...ENGLISH_ARTICLE });

    await publisher.agent.post(`/api/knowledge/articles/${created.body.id}/publish`);

    const archived = await publisher.agent.post(
      `/api/knowledge/articles/${created.body.id}/archive`,
    );

    expect(archived.status).toBe(200);
    expect(archived.body.status).toBe('archived');

    // STILL THERE, and still readable. This is what makes archiving the
    // project's delete rather than a euphemism for one.
    const reread = await publisher.agent.get(`/api/knowledge/articles/${created.body.id}`);
    expect(reread.status).toBe(200);
    expect(reread.body.bodyEn).toBe(ENGLISH_ARTICLE.bodyEn);

    // `published_at` survives the archive: "when did this first go live" stays
    // true, which is the question a stewardship review actually asks.
    expect(reread.body.publishedAt).not.toBeNull();
  });

  it('lets an abandoned draft be archived (FR-003)', async () => {
    // Refusing would leave the only way to tidy an abandoned draft being to
    // leave it in the author's list forever.
    const publisher = await agentAs('supervisor');
    const category = await createCategory();

    const created = await publisher.agent
      .post('/api/knowledge/articles')
      .send({ categoryId: category.id, titleEn: 'Half-written', bodyEn: null });

    const archived = await publisher.agent.post(
      `/api/knowledge/articles/${created.body.id}/archive`,
    );

    expect(archived.status).toBe(200);
    expect(archived.body.status).toBe('archived');
  });

  it('restores an archived article to published', async () => {
    const publisher = await agentAs('supervisor');
    const category = await createCategory();

    const created = await publisher.agent
      .post('/api/knowledge/articles')
      .send({ categoryId: category.id, ...ENGLISH_ARTICLE });

    await publisher.agent.post(`/api/knowledge/articles/${created.body.id}/publish`);
    const publishedAt = (await publisher.agent.get(`/api/knowledge/articles/${created.body.id}`))
      .body.publishedAt;

    await publisher.agent.post(`/api/knowledge/articles/${created.body.id}/archive`);
    const restored = await publisher.agent.post(
      `/api/knowledge/articles/${created.body.id}/restore`,
    );

    expect(restored.status).toBe(200);
    expect(restored.body.status).toBe('published');
    // The FIRST publish, not this one. An archive and a restore is not a new
    // publication.
    expect(restored.body.publishedAt).toBe(publishedAt);
  });
});

describe('there is no way to destroy an article', () => {
  it('has no DELETE route (FR-007)', async () => {
    const admin = await agentAs('admin');
    const category = await createCategory();

    const created = await admin.agent
      .post('/api/knowledge/articles')
      .send({ categoryId: category.id, ...ENGLISH_ARTICLE });

    // 404 because the route does not exist, not 403 because it is guarded.
    // The absence IS the requirement — archiving is the removal.
    const deleted = await admin.agent.delete(`/api/knowledge/articles/${created.body.id}`);

    expect(deleted.status).toBe(404);
    expect(await KbArticle.findByPk(created.body.id)).not.toBeNull();
  });
});

describe('a draft is not visible to someone who cannot author', () => {
  it('answers 404 rather than 403, so the status code discloses nothing', async () => {
    // The rule FR-019 fixed in Phase 1: decide permission before existence, or
    // the status code tells a reader that a draft is being written about them.
    const author = await agentAs('agent');
    const category = await createCategory();

    const created = await author.agent
      .post('/api/knowledge/articles')
      .send({ categoryId: category.id, ...ENGLISH_ARTICLE });

    // Strip kb:author from the agent role for this assertion.
    const { RolePermission, Role } = await import('../../src/models/index.js');
    const agentRole = await Role.findOne({ where: { key: 'agent' } });
    await RolePermission.destroy({
      where: { role_id: agentRole!.id, permission_key: 'kb:author' },
    });

    const reader = await agentAs('agent');
    const response = await reader.agent.get(`/api/knowledge/articles/${created.body.id}`);

    expect(response.status).toBe(404);
  });
});
