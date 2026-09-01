import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
 * The slug (research D10).
 *
 * TWO PROPERTIES, AND THE SECOND IS THE ONE THAT MATTERS.
 *
 * A public URL addresses an article by slug rather than by id, because
 * sequential ids in a public URL disclose the size of the corpus and let a
 * stranger walk it one number at a time.
 *
 * And the slug NEVER CHANGES once set. A slug that tracked the title would
 * break every link already sent the first time somebody fixed a typo — the
 * links in old emails, in old tickets, in a customer's bookmarks. Correcting a
 * heading is a small act, and it must not have that consequence.
 */

async function publishWithTitle(
  publisher: Awaited<ReturnType<typeof agentAs>>,
  titleEn: string,
): Promise<{ id: number; slug: string; version: number }> {
  const category = await createCategory();

  const created = await publisher.agent
    .post('/api/knowledge/articles')
    .send({ categoryId: category.id, titleEn, bodyEn: ENGLISH_ARTICLE.bodyEn });

  const published = await publisher.agent.post(
    `/api/knowledge/articles/${created.body.id}/publish`,
  );

  return {
    id: created.body.id,
    slug: published.body.slug,
    version: published.body.version,
  };
}

describe('the slug is derived at first publish', () => {
  it('has no slug while it is a draft', async () => {
    const publisher = await agentAs('supervisor');
    const category = await createCategory();

    const created = await publisher.agent
      .post('/api/knowledge/articles')
      .send({ categoryId: category.id, ...ENGLISH_ARTICLE });

    expect(created.body.slug).toBeNull();
  });

  it('derives a readable slug from the title', async () => {
    const publisher = await agentAs('supervisor');
    const article = await publishWithTitle(publisher, 'Card reader keeps rebooting');

    expect(article.slug).toBe('card-reader-keeps-rebooting');
  });

  it('keeps Arabic characters rather than transliterating them', async () => {
    // Transliterating is a guess, and guessing across scripts produces
    // confident nonsense — the same argument the tokenizer makes for refusing
    // to do it. A percent-encoded Arabic slug is ugly in a status bar and
    // correct everywhere else; a wrong Latin approximation is neither.
    const publisher = await agentAs('supervisor');
    const category = await createCategory();

    const created = await publisher.agent.post('/api/knowledge/articles').send({
      categoryId: category.id,
      titleAr: 'قارئ البطاقة',
      bodyAr: 'نص المقالة',
    });

    const published = await publisher.agent.post(
      `/api/knowledge/articles/${created.body.id}/publish`,
    );

    expect(published.body.slug).toBe('قارئ-البطاقة');
  });

  it('resolves a collision rather than failing the publish', async () => {
    const publisher = await agentAs('supervisor');

    const first = await publishWithTitle(publisher, 'Card reader keeps rebooting');
    const second = await publishWithTitle(publisher, 'Card reader keeps rebooting');

    expect(first.slug).toBe('card-reader-keeps-rebooting');
    expect(second.slug).not.toBe(first.slug);
    expect(second.slug).toContain('card-reader-keeps-rebooting');
  });
});

describe('the slug does NOT change when the title is edited', () => {
  it('leaves every link already sent still working', async () => {
    // THE ASSERTION THIS FILE EXISTS FOR.
    const publisher = await agentAs('supervisor');
    const article = await publishWithTitle(publisher, 'Card reader keeps rebooting');

    const edited = await publisher.agent
      .patch(`/api/knowledge/articles/${article.id}`)
      .send({ titleEn: 'Card reader reboots when a card is inserted', version: article.version });

    expect(edited.status).toBe(200);
    expect(edited.body.titleEn).toBe('Card reader reboots when a card is inserted');
    expect(edited.body.slug).toBe('card-reader-keeps-rebooting');
  });

  it('survives an archive and a restore', async () => {
    const publisher = await agentAs('supervisor');
    const article = await publishWithTitle(publisher, 'Card reader keeps rebooting');

    await publisher.agent.post(`/api/knowledge/articles/${article.id}/archive`);
    const restored = await publisher.agent.post(`/api/knowledge/articles/${article.id}/restore`);

    expect(restored.body.slug).toBe('card-reader-keeps-rebooting');
  });
});
