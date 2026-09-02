import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { KbArticle, KbGuideStep } from '../../src/models/index.js';
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
 * Guides (User Story 5, FR-011a to FR-011d, research D9).
 *
 * A GUIDE IS A JOIN, NOT A CONTAINER. The article does not know it is in one,
 * stays in its own category, and may appear in several guides. That is FR-011b
 * true by construction rather than by rule — nothing has to remember to keep
 * the article browsable, because nothing moved it.
 *
 * The alternative, modelling a guide as a special kind of article, would have
 * forced every article query in the system to learn to exclude containers. Each
 * of them would have had to remember, and one of them would not have.
 */

async function guideWith(
  admin: Awaited<ReturnType<typeof agentAs>>,
  articleIds: number[],
): Promise<number> {
  const guide = await admin.agent
    .post('/api/knowledge/guides')
    .send({ titleEn: 'Setting up a terminal' });

  await admin.agent.put(`/api/knowledge/guides/${guide.body.id}/steps`).send({ articleIds });

  return guide.body.id as number;
}

describe('an article in a guide stays where it was', () => {
  it('keeps its category (FR-011b)', async () => {
    const admin = await agentAs('admin');
    const category = await createCategory({ slug: 'hardware' });
    const article = await createArticle(category.id);

    await guideWith(admin, [article.id]);

    const reread = await KbArticle.findByPk(article.id);
    expect(reread?.category_id).toBe(category.id);
  });

  it('may appear in more than one guide', async () => {
    const admin = await agentAs('admin');
    const category = await createCategory();
    const article = await createArticle(category.id);

    const first = await guideWith(admin, [article.id]);

    const second = await admin.agent
      .post('/api/knowledge/guides')
      .send({ titleEn: 'Replacing a terminal' });
    await admin.agent
      .put(`/api/knowledge/guides/${second.body.id}/steps`)
      .send({ articleIds: [article.id] });

    const guides = await admin.agent.get('/api/knowledge/guides');
    const holding = guides.body.items.filter((g: { steps: Array<{ articleId: number }> }) =>
      g.steps.some((step) => step.articleId === article.id),
    );

    expect(holding.map((g: { id: number }) => g.id).sort()).toEqual([first, second.body.id].sort());
  });

  it('survives the guide being deleted', async () => {
    // A guide is a join. Deleting it removes the join rows and nothing else,
    // which is why this delete needs no warning about what it takes with it.
    const admin = await agentAs('admin');
    const category = await createCategory();
    const article = await createArticle(category.id);

    const guideId = await guideWith(admin, [article.id]);

    expect((await admin.agent.delete(`/api/knowledge/guides/${guideId}`)).status).toBe(204);
    expect(await KbArticle.findByPk(article.id)).not.toBeNull();
    expect(await KbGuideStep.count()).toBe(0);
  });
});

describe('the step sequence is replaced as a whole', () => {
  it('numbers the steps from one, in the order given', async () => {
    const admin = await agentAs('admin');
    const category = await createCategory();

    const first = await createArticle(category.id, { titleEn: 'Unpack it' });
    const second = await createArticle(category.id, { titleEn: 'Plug it in' });
    const third = await createArticle(category.id, { titleEn: 'Register it' });

    const guideId = await guideWith(admin, [first.id, second.id, third.id]);

    const guides = await admin.agent.get('/api/knowledge/guides');
    const guide = guides.body.items.find((g: { id: number }) => g.id === guideId);

    expect(guide.steps.map((s: { articleId: number; position: number }) => s.position)).toEqual([
      1, 2, 3,
    ]);
    expect(guide.steps.map((s: { articleId: number }) => s.articleId)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
  });

  it('reorders atomically, leaving no two steps claiming one position', async () => {
    // A guide's order is ONE editorial decision. A partial reorder would let
    // two steps sit at position 2, and the reader would get an order nobody
    // chose.
    const admin = await agentAs('admin');
    const category = await createCategory();

    const a = await createArticle(category.id, { titleEn: 'A' });
    const b = await createArticle(category.id, { titleEn: 'B' });
    const c = await createArticle(category.id, { titleEn: 'C' });

    const guideId = await guideWith(admin, [a.id, b.id, c.id]);

    await admin.agent
      .put(`/api/knowledge/guides/${guideId}/steps`)
      .send({ articleIds: [c.id, a.id, b.id] });

    const guides = await admin.agent.get('/api/knowledge/guides');
    const guide = guides.body.items.find((g: { id: number }) => g.id === guideId);

    expect(guide.steps.map((s: { articleId: number }) => s.articleId)).toEqual([c.id, a.id, b.id]);

    const positions = (await KbGuideStep.findAll({ where: { guide_id: guideId } })).map(
      (step) => step.position,
    );
    expect([...positions].sort()).toEqual([1, 2, 3]);
  });

  it('removes a step by leaving it out of the new sequence', async () => {
    const admin = await agentAs('admin');
    const category = await createCategory();

    const a = await createArticle(category.id, { titleEn: 'A' });
    const b = await createArticle(category.id, { titleEn: 'B' });

    const guideId = await guideWith(admin, [a.id, b.id]);

    await admin.agent.put(`/api/knowledge/guides/${guideId}/steps`).send({ articleIds: [a.id] });

    const guides = await admin.agent.get('/api/knowledge/guides');
    const guide = guides.body.items.find((g: { id: number }) => g.id === guideId);

    expect(guide.steps.map((s: { articleId: number }) => s.articleId)).toEqual([a.id]);
    // Removed from the guide, untouched as an article.
    expect(await KbArticle.findByPk(b.id)).not.toBeNull();
  });

  it('refuses the same article twice in one guide', async () => {
    const admin = await agentAs('admin');
    const category = await createCategory();
    const article = await createArticle(category.id);

    const guide = await admin.agent
      .post('/api/knowledge/guides')
      .send({ titleEn: 'Setting up a terminal' });

    const response = await admin.agent
      .put(`/api/knowledge/guides/${guide.body.id}/steps`)
      .send({ articleIds: [article.id, article.id] });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].message).toBe('kb.error.stepsDuplicate');
  });

  it('refuses an article that does not exist', async () => {
    const admin = await agentAs('admin');

    const guide = await admin.agent
      .post('/api/knowledge/guides')
      .send({ titleEn: 'Setting up a terminal' });

    const response = await admin.agent
      .put(`/api/knowledge/guides/${guide.body.id}/steps`)
      .send({ articleIds: [999999] });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].message).toBe('kb.error.stepsUnknownArticle');
  });
});

describe('managing guides needs kb:manage', () => {
  it('refuses an agent', async () => {
    const author = await agentAs('agent');

    const created = await author.agent
      .post('/api/knowledge/guides')
      .send({ titleEn: 'Setting up a terminal' });

    expect(created.status).toBe(403);
  });
});
