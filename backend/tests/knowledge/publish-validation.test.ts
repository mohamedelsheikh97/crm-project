import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
 * The publish gate (FR-005).
 *
 * THIS IS THE ONLY QUALITY CONTROL THIS CONTENT HAS. There is no review
 * workflow, no approval chain, and no version history to fall back on (spec
 * Assumptions). The moment of publishing is the only moment anybody is required
 * to look at an article before it becomes the organisation speaking — so the
 * gate refuses precisely, and says which half is missing.
 *
 * A half-written article is worse than no article: the reader spends their
 * attention before discovering it does not answer them.
 */

async function draft(
  publisher: Awaited<ReturnType<typeof agentAs>>,
  fields: Record<string, unknown>,
): Promise<number> {
  const category = await createCategory();

  const created = await publisher.agent
    .post('/api/knowledge/articles')
    .send({ categoryId: category.id, ...fields });

  return created.body.id as number;
}

describe('publishing requires one COMPLETE language pair', () => {
  it('refuses a title with no body, and names the missing half', async () => {
    const publisher = await agentAs('supervisor');
    const id = await draft(publisher, { titleEn: 'Card reader keeps rebooting' });

    const response = await publisher.agent.post(`/api/knowledge/articles/${id}/publish`);

    // 422, not 400: nothing about the REQUEST is malformed. The article is
    // unfinished, and the same request succeeds once somebody writes the body.
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('ARTICLE_INCOMPLETE');
    expect(response.body.error.details).toContainEqual({
      field: 'bodyEn',
      message: 'kb.error.incompletePair',
    });
  });

  it('refuses a body with no title, and names THAT missing half', async () => {
    const publisher = await agentAs('supervisor');
    const id = await draft(publisher, { bodyAr: ARABIC_ARTICLE.bodyAr });

    const response = await publisher.agent.post(`/api/knowledge/articles/${id}/publish`);

    expect(response.status).toBe(422);
    expect(response.body.error.details).toContainEqual({
      field: 'titleAr',
      message: 'kb.error.incompletePair',
    });
  });

  it('refuses an article with nothing written in it at all', async () => {
    // A different message, because "finish the Arabic body" would be nonsense
    // advice for an empty article.
    const publisher = await agentAs('supervisor');
    const id = await draft(publisher, {});

    const response = await publisher.agent.post(`/api/knowledge/articles/${id}/publish`);

    expect(response.status).toBe(422);
    expect(response.body.error.details).toContainEqual({
      field: 'titleEn',
      message: 'kb.error.noCompleteLanguage',
    });
  });

  it('refuses a title in one language paired with a body in the OTHER', async () => {
    // The case that looks complete from a distance and is unreadable up close:
    // a reader gets an English heading over an Arabic body, or nothing at all.
    // "At least one complete pair" means one LANGUAGE, not one of each field.
    const publisher = await agentAs('supervisor');
    const id = await draft(publisher, {
      titleEn: ENGLISH_ARTICLE.titleEn,
      bodyAr: ARABIC_ARTICLE.bodyAr,
    });

    const response = await publisher.agent.post(`/api/knowledge/articles/${id}/publish`);

    expect(response.status).toBe(422);
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        { field: 'bodyEn', message: 'kb.error.incompletePair' },
        { field: 'titleAr', message: 'kb.error.incompletePair' },
      ]),
    );
  });

  it('publishes an article complete in ONE language (Clarifications Q3)', async () => {
    // The rule is "at least one complete pair", never "both languages".
    // Requiring both would mean an agent who solves a problem at 4pm cannot
    // write it down until somebody translates it.
    const publisher = await agentAs('supervisor');
    const id = await draft(publisher, ENGLISH_ARTICLE);

    const response = await publisher.agent.post(`/api/knowledge/articles/${id}/publish`);

    expect(response.status).toBe(200);
    expect(response.body.availableLanguages).toEqual(['en']);
  });

  it('publishes an article complete in BOTH, and reports both', async () => {
    const publisher = await agentAs('supervisor');
    const id = await draft(publisher, { ...ENGLISH_ARTICLE, ...ARABIC_ARTICLE });

    const response = await publisher.agent.post(`/api/knowledge/articles/${id}/publish`);

    expect(response.status).toBe(200);
    expect(response.body.availableLanguages).toEqual(['en', 'ar']);
  });
});

describe('restoring re-checks the gate', () => {
  it('refuses to restore an article edited into an incomplete state', async () => {
    // An article must not slip past the gate simply because it was once
    // published. The gate is about what is true now.
    const publisher = await agentAs('supervisor');
    const id = await draft(publisher, ENGLISH_ARTICLE);

    await publisher.agent.post(`/api/knowledge/articles/${id}/publish`);
    await publisher.agent.post(`/api/knowledge/articles/${id}/archive`);

    const current = await publisher.agent.get(`/api/knowledge/articles/${id}`);
    await publisher.agent
      .patch(`/api/knowledge/articles/${id}`)
      .send({ bodyEn: null, version: current.body.version });

    const restored = await publisher.agent.post(`/api/knowledge/articles/${id}/restore`);

    expect(restored.status).toBe(422);
    expect(restored.body.error.code).toBe('ARTICLE_INCOMPLETE');
  });
});
