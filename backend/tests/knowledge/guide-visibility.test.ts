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
 * A guide with nothing a reader can see is not offered (FR-011d).
 *
 * AND IT IS DERIVED, NOT STORED. That is the whole content of this file.
 *
 * A stored `is_visible` flag on `kb_guides` would be correct on the day it was
 * written and wrong the first time somebody archived a step — and nothing would
 * notice, because the flag would still say what it always said. The reader
 * would be offered a guide that opens onto nothing.
 *
 * Deriving it from the steps means the answer cannot go stale, for the same
 * reason a computed suggestion cannot (FR-042) and an unindexed draft cannot be
 * found (research D4). It is the same idea three times: do not store a
 * conclusion you can compute from a fact that changes.
 */

async function guideVisibility(
  admin: Awaited<ReturnType<typeof agentAs>>,
  guideId: number,
): Promise<boolean> {
  const guides = await admin.agent.get('/api/knowledge/guides');
  return guides.body.items.find((g: { id: number }) => g.id === guideId).isReaderVisible;
}

async function makeGuide(
  admin: Awaited<ReturnType<typeof agentAs>>,
  articleIds: number[],
): Promise<number> {
  const guide = await admin.agent
    .post('/api/knowledge/guides')
    .send({ titleEn: 'Setting up a terminal' });

  await admin.agent.put(`/api/knowledge/guides/${guide.body.id}/steps`).send({ articleIds });

  return guide.body.id as number;
}

describe('a guide is offered only when a reader can reach something in it', () => {
  it('is not offered when every step is a draft', async () => {
    const admin = await agentAs('admin');
    const category = await createCategory();

    const first = await createArticle(category.id, { titleEn: 'One' });
    const second = await createArticle(category.id, { titleEn: 'Two' });

    const guideId = await makeGuide(admin, [first.id, second.id]);

    expect(await guideVisibility(admin, guideId)).toBe(false);
  });

  it('is not offered when it has no steps at all', async () => {
    const admin = await agentAs('admin');
    const guideId = await makeGuide(admin, []);

    expect(await guideVisibility(admin, guideId)).toBe(false);
  });

  it('is offered as soon as ONE step is published', async () => {
    const admin = await agentAs('admin');
    const category = await createCategory();

    const first = await createArticle(category.id, { titleEn: 'One' });
    const second = await createArticle(category.id, { titleEn: 'Two' });

    const guideId = await makeGuide(admin, [first.id, second.id]);

    await first.update({ status: 'published', slug: 'one' });

    expect(await guideVisibility(admin, guideId)).toBe(true);
  });

  it('stops being offered the moment its last published step is archived', async () => {
    // THE ASSERTION A STORED FLAG WOULD FAIL. Nothing here updated the guide;
    // the guide simply answers a different question about the same facts.
    const admin = await agentAs('admin');
    const category = await createCategory();

    const article = await createArticle(category.id, { titleEn: 'One' });
    const guideId = await makeGuide(admin, [article.id]);

    await article.update({ status: 'published', slug: 'one' });
    expect(await guideVisibility(admin, guideId)).toBe(true);

    await article.update({ status: 'archived' });
    expect(await guideVisibility(admin, guideId)).toBe(false);
  });

  it('comes back when the step is restored', async () => {
    const admin = await agentAs('admin');
    const category = await createCategory();

    const article = await createArticle(category.id, { titleEn: 'One' });
    const guideId = await makeGuide(admin, [article.id]);

    await article.update({ status: 'published', slug: 'one' });
    await article.update({ status: 'archived' });
    await article.update({ status: 'published' });

    expect(await guideVisibility(admin, guideId)).toBe(true);
  });
});

describe('the management view still shows every guide', () => {
  it('lists an invisible guide so somebody can fix it', async () => {
    // "Not offered to readers" is not "hidden from its author". A guide whose
    // steps are all drafts is a guide somebody is still building, and hiding it
    // from the person building it would be absurd.
    const admin = await agentAs('admin');
    const category = await createCategory();

    const article = await createArticle(category.id, { titleEn: 'One' });
    const guideId = await makeGuide(admin, [article.id]);

    const guides = await admin.agent.get('/api/knowledge/guides');

    expect(guides.body.items.map((g: { id: number }) => g.id)).toContain(guideId);
  });
});
