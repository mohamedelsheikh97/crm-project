import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { agentAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { createArticle, createCategory } from './helpers.js';

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
 * Browsing (SC-007, FR-013, FR-014).
 *
 * SEARCH IS FOR PEOPLE WHO CAN NAME WHAT THEY WANT. Browsing is for everyone
 * else — and on a help centre that is most people, because somebody with a
 * problem often cannot say what it is called. FR-010 makes every article carry
 * a category precisely so this route always exists: an article reachable only
 * by search is one nobody can find by looking.
 *
 * SC-007 is therefore a completeness claim rather than a feature: EVERY
 * published article is reachable by browsing, with no exceptions and no
 * orphans.
 */

describe('every published article is reachable by browsing (SC-007)', () => {
  it('lists the published articles filed in a category', async () => {
    const reader = await agentAs('agent');
    const hardware = await createCategory({ slug: 'hardware' });
    const billing = await createCategory({ slug: 'billing' });

    const first = await createArticle(hardware.id, { titleEn: 'One' });
    const second = await createArticle(hardware.id, { titleEn: 'Two' });
    const elsewhere = await createArticle(billing.id, { titleEn: 'Three' });

    for (const article of [first, second, elsewhere]) {
      await article.update({ status: 'published', slug: `slug-${article.id}` });
    }

    const listed = await reader.agent.get(
      `/api/knowledge/articles?categoryId=${hardware.id}&status=published`,
    );

    expect(listed.body.items.map((a: { id: number }) => a.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
  });

  it('leaves no published article without a category to browse from', async () => {
    // FR-010 as a completeness check. `category_id` is NOT NULL in the schema,
    // so this cannot fail — which is the point of asserting it: it states the
    // guarantee where somebody reading the tests will meet it.
    const reader = await agentAs('agent');
    const category = await createCategory();

    for (let i = 0; i < 5; i += 1) {
      const article = await createArticle(category.id, { titleEn: `Article ${i}` });
      await article.update({ status: 'published', slug: `slug-${article.id}` });
    }

    const all = await reader.agent.get('/api/knowledge/articles?status=published');
    const categories = await reader.agent.get('/api/knowledge/categories');
    const knownCategoryIds = new Set(categories.body.items.map((c: { id: number }) => c.id));

    expect(all.body.items.length).toBe(5);
    for (const article of all.body.items) {
      expect(knownCategoryIds.has(article.categoryId)).toBe(true);
    }
  });
});

describe('a category with nothing visible says so (FR-014)', () => {
  it('reports a published count of zero rather than pretending to have content', async () => {
    // The listing carries BOTH counts so the interface can tell "empty" from
    // "everything in here is still a draft" — which are different messages to
    // an administrator and the same message to a reader.
    const admin = await agentAs('admin');
    const category = await createCategory();

    await createArticle(category.id, { titleEn: 'Still a draft' });

    const categories = await admin.agent.get('/api/knowledge/categories');
    const entry = categories.body.items.find((c: { id: number }) => c.id === category.id);

    expect(entry.articleCount).toBe(1);
    expect(entry.publishedCount).toBe(0);
  });

  it('returns an empty list rather than an error for an empty category', async () => {
    // An empty state is a real state (SC-013). A 404 here would make a category
    // somebody has just created look broken.
    const reader = await agentAs('agent');
    const category = await createCategory();

    const listed = await reader.agent.get(
      `/api/knowledge/articles?categoryId=${category.id}&status=published`,
    );

    expect(listed.status).toBe(200);
    expect(listed.body.items).toEqual([]);
    expect(listed.body.total).toBe(0);
  });

  it('returns an empty list for a category that does not exist, not a leak', async () => {
    const reader = await agentAs('agent');

    const listed = await reader.agent.get('/api/knowledge/articles?categoryId=999999');

    expect(listed.status).toBe(200);
    expect(listed.body.items).toEqual([]);
  });
});

describe('browsing shows only what the reader may see', () => {
  it('omits drafts from a reader without kb:author', async () => {
    const { Role, RolePermission } = await import('../../src/models/index.js');
    const category = await createCategory();

    const draft = await createArticle(category.id, { titleEn: 'Draft' });
    const live = await createArticle(category.id, { titleEn: 'Live' });
    await live.update({ status: 'published', slug: 'live' });

    const agentRole = await Role.findOne({ where: { key: 'agent' } });
    await RolePermission.destroy({
      where: { role_id: agentRole!.id, permission_key: 'kb:author' },
    });

    const reader = await agentAs('agent');
    const listed = await reader.agent.get(`/api/knowledge/articles?categoryId=${category.id}`);

    const ids = listed.body.items.map((a: { id: number }) => a.id);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(draft.id);
  });
});
