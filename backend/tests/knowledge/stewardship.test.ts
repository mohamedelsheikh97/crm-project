import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { KbArticle } from '../../src/models/index.js';
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
 * Finding out-of-date content before a customer finds it (User Story 6,
 * FR-048, FR-051).
 *
 * THE TWO SORTS THAT MATTER, AND WHY THE SECOND MATTERS MORE.
 *
 *   OLD AND UNREAD is a tidying job. Nobody is being misled; the article is
 *   simply taking up space and making the corpus look bigger than it is.
 *
 *   OLD AND HEAVILY READ IS THE URGENT ONE. An article nobody has touched in a
 *   year, which four hundred customers read last month, is actively
 *   misinforming people at scale — and it looks perfectly healthy on any screen
 *   that sorts by readership alone.
 *
 * A stewardship view that offers only one of these sorts finds the wrong
 * problem. Both are here for that reason.
 */

async function seedCorpus(): Promise<Record<string, KbArticle>> {
  const category = await createCategory();

  const stale = await createArticle(category.id, { titleEn: 'Stale and unread' });
  const staleAndRead = await createArticle(category.id, { titleEn: 'Stale and heavily read' });
  const fresh = await createArticle(category.id, { titleEn: 'Fresh' });

  await stale.update({ view_count: 2 }, { silent: true });
  await staleAndRead.update({ view_count: 400 }, { silent: true });
  await fresh.update({ view_count: 50 }, { silent: true });

  // Set the timestamps explicitly and silently: `updated_at` is the whole
  // signal under test, so it must be the fixture rather than a side effect.
  await stale.update({ updated_at: new Date('2025-01-01T00:00:00Z') }, { silent: true });
  await staleAndRead.update({ updated_at: new Date('2025-02-01T00:00:00Z') }, { silent: true });
  await fresh.update({ updated_at: new Date('2026-08-01T00:00:00Z') }, { silent: true });

  return { stale, staleAndRead, fresh };
}

describe('the management view reports when and by whom (FR-048)', () => {
  it('carries last-updated and the person who did it', async () => {
    const editor = await agentAs('supervisor');
    const category = await createCategory();

    const created = await editor.agent
      .post('/api/knowledge/articles')
      .send({ categoryId: category.id, titleEn: 'Card reader', bodyEn: 'Replace the cable.' });

    const listed = await editor.agent.get('/api/knowledge/articles');
    const entry = listed.body.items.find((a: { id: number }) => a.id === created.body.id);

    expect(entry.updatedAt).toBeDefined();
    expect(entry.updatedBy).toEqual({ id: editor.user.id, fullName: editor.user.full_name });
  });

  it('carries how often each article has been read (FR-049)', async () => {
    const editor = await agentAs('supervisor');
    const { staleAndRead } = await seedCorpus();

    const listed = await editor.agent.get('/api/knowledge/articles');
    const entry = listed.body.items.find((a: { id: number }) => a.id === staleAndRead.id);

    expect(entry.viewCount).toBe(400);
  });
});

describe('the sorts that surface decay (FR-051)', () => {
  it('finds the longest-untouched articles first', async () => {
    const editor = await agentAs('supervisor');
    const { stale, staleAndRead, fresh } = await seedCorpus();

    const listed = await editor.agent.get('/api/knowledge/articles?sort=stale');

    expect(listed.body.items.map((a: { id: number }) => a.id)).toEqual([
      stale.id,
      staleAndRead.id,
      fresh.id,
    ]);
  });

  it('finds the most-read articles first — the sort that finds the URGENT problem', async () => {
    // Combined with the sort above, this is what makes "old AND heavily read"
    // findable. Neither sort alone shows it.
    const editor = await agentAs('supervisor');
    const { stale, staleAndRead, fresh } = await seedCorpus();

    const listed = await editor.agent.get('/api/knowledge/articles?sort=mostRead');

    expect(listed.body.items.map((a: { id: number }) => a.id)).toEqual([
      staleAndRead.id,
      fresh.id,
      stale.id,
    ]);
  });

  it('finds the least-read articles first', async () => {
    const editor = await agentAs('supervisor');
    const { stale, staleAndRead, fresh } = await seedCorpus();

    const listed = await editor.agent.get('/api/knowledge/articles?sort=leastRead');

    expect(listed.body.items.map((a: { id: number }) => a.id)).toEqual([
      stale.id,
      fresh.id,
      staleAndRead.id,
    ]);
  });

  it('defaults to most-recently-changed', async () => {
    const editor = await agentAs('supervisor');
    const { stale, staleAndRead, fresh } = await seedCorpus();

    const listed = await editor.agent.get('/api/knowledge/articles');

    expect(listed.body.items.map((a: { id: number }) => a.id)).toEqual([
      fresh.id,
      staleAndRead.id,
      stale.id,
    ]);
  });

  it('ignores an unknown sort rather than failing', async () => {
    // A stewardship screen must not break because somebody bookmarked a URL
    // with an old parameter in it.
    const editor = await agentAs('supervisor');
    await seedCorpus();

    const listed = await editor.agent.get('/api/knowledge/articles?sort=whatever');

    expect(listed.status).toBe(200);
    expect(listed.body.items.length).toBe(3);
  });

  it('orders totally, so paging cannot repeat or skip an article', async () => {
    // Every sort breaks its ties by id. Without that, two articles updated in
    // the same second could swap between pages — an article on both page one
    // and page two, and another on neither.
    const editor = await agentAs('supervisor');
    const category = await createCategory();

    const sameSecond = new Date('2026-05-05T12:00:00Z');
    for (let i = 0; i < 6; i += 1) {
      const article = await createArticle(category.id, { titleEn: `Article ${i}` });
      await article.update({ updated_at: sameSecond, view_count: 10 }, { silent: true });
    }

    const first = await editor.agent.get('/api/knowledge/articles?sort=stale');
    const second = await editor.agent.get('/api/knowledge/articles?sort=stale');

    expect(second.body.items.map((a: { id: number }) => a.id)).toEqual(
      first.body.items.map((a: { id: number }) => a.id),
    );
  });
});
