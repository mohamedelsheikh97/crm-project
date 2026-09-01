import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { KbArticleTerm } from '../../src/models/index.js';
import { agentAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { createCategory } from '../knowledge/helpers.js';
import { searchIds } from './helpers.js';

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
 * The index is rebuilt IN THE WRITING TRANSACTION (research D4).
 *
 * "Saved but not searchable" and "searchable under its old text" are both
 * unrepresentable, and the reason that matters is that BOTH FAILURES ARE
 * SILENT. Nobody reports "the search returned the previous version of this
 * article" — they read the previous version, act on it, and never know.
 *
 * These tests go through the ENDPOINTS rather than calling `reindex` directly,
 * because the property being asserted is that the article service always calls
 * it — not that the function works when called.
 */

async function terms(articleId: number): Promise<string[]> {
  const rows = await KbArticleTerm.findAll({
    where: { article_id: articleId },
    order: [['term', 'ASC']],
  });

  return [...new Set(rows.map((row) => row.term))];
}

describe('every lifecycle transition rebuilds the index', () => {
  it('indexes on publish and never before', async () => {
    const publisher = await agentAs('supervisor');
    const category = await createCategory();

    const created = await publisher.agent.post('/api/knowledge/articles').send({
      categoryId: category.id,
      titleEn: 'Card reader keeps rebooting',
      bodyEn: 'Replace the cable.',
    });

    // A draft has no rows at all — FR-004 made structural.
    expect(await terms(created.body.id)).toEqual([]);

    await publisher.agent.post(`/api/knowledge/articles/${created.body.id}/publish`);

    expect(await terms(created.body.id)).toContain('reader');
    expect(await searchIds('card reader')).toContain(created.body.id);
  });

  it('rebuilds on an edit, so the old text is not findable', async () => {
    // THE ASSERTION THIS FILE EXISTS FOR. If reindex were not in the same
    // transaction as the save, the article would still be findable under a word
    // that is no longer in it — and nobody would notice.
    const publisher = await agentAs('supervisor');
    const category = await createCategory();

    const created = await publisher.agent.post('/api/knowledge/articles').send({
      categoryId: category.id,
      titleEn: 'Card reader keeps rebooting',
      bodyEn: 'Replace the cable.',
    });

    const published = await publisher.agent.post(
      `/api/knowledge/articles/${created.body.id}/publish`,
    );

    expect(await searchIds('rebooting')).toContain(created.body.id);

    await publisher.agent.patch(`/api/knowledge/articles/${created.body.id}`).send({
      titleEn: 'Terminal display flickers',
      bodyEn: 'Reseat the ribbon connector.',
      version: published.body.version,
    });

    // Gone under the old words...
    expect(await searchIds('rebooting')).not.toContain(created.body.id);
    // ...and present under the new ones, in the same breath.
    expect(await searchIds('flickers')).toContain(created.body.id);
  });

  it('empties the index on archive and refills it on restore', async () => {
    const publisher = await agentAs('supervisor');
    const category = await createCategory();

    const created = await publisher.agent.post('/api/knowledge/articles').send({
      categoryId: category.id,
      titleEn: 'Card reader keeps rebooting',
      bodyEn: 'Replace the cable.',
    });

    await publisher.agent.post(`/api/knowledge/articles/${created.body.id}/publish`);
    await publisher.agent.post(`/api/knowledge/articles/${created.body.id}/archive`);

    expect(await terms(created.body.id)).toEqual([]);

    await publisher.agent.post(`/api/knowledge/articles/${created.body.id}/restore`);

    expect(await terms(created.body.id)).toContain('reader');
  });

  it('indexes each language into its own rows', async () => {
    // What makes FR-029's cross-language near-miss a second QUERY rather than a
    // heuristic: the rows already know which language produced them.
    const publisher = await agentAs('supervisor');
    const category = await createCategory();

    const created = await publisher.agent.post('/api/knowledge/articles').send({
      categoryId: category.id,
      titleEn: 'Card reader keeps rebooting',
      bodyEn: 'Replace the cable.',
      titleAr: 'قارئ البطاقة يعيد التشغيل',
      bodyAr: 'استبدل الكابل.',
    });

    await publisher.agent.post(`/api/knowledge/articles/${created.body.id}/publish`);

    const rows = await KbArticleTerm.findAll({ where: { article_id: created.body.id } });
    const languages = new Set(rows.map((row) => row.lang));
    const fields = new Set(rows.map((row) => row.field));

    expect([...languages].sort()).toEqual(['ar', 'en']);
    // Title and body are separate rows — the ranking input (research D3).
    expect([...fields].sort()).toEqual(['body', 'title']);
  });
});

describe('a failed write leaves the index untouched', () => {
  it('does not reindex when the save is rejected as stale', async () => {
    // The index rebuild rides inside the transaction, so a refused write cannot
    // half-apply: the article keeps its text AND its old index rows.
    const publisher = await agentAs('supervisor');
    const category = await createCategory();

    const created = await publisher.agent.post('/api/knowledge/articles').send({
      categoryId: category.id,
      titleEn: 'Card reader keeps rebooting',
      bodyEn: 'Replace the cable.',
    });

    await publisher.agent.post(`/api/knowledge/articles/${created.body.id}/publish`);

    const stale = await publisher.agent
      .patch(`/api/knowledge/articles/${created.body.id}`)
      .send({ titleEn: 'Something else entirely', version: 0 });

    expect(stale.status).toBe(409);
    expect(await searchIds('rebooting')).toContain(created.body.id);
  });
});
