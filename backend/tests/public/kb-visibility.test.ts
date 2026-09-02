import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import app from '../../src/app.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { makeArticle } from '../search/helpers.js';

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
 * WHAT THE PUBLIC SURFACE CANNOT REACH (FR-032c).
 *
 * Note that nothing in this file signs in. That is the point: these requests
 * are made exactly as a stranger would make them.
 *
 * THE PROPERTY BEING ASSERTED IS AN ABSENCE OF DIFFERENCE. A draft, an archived
 * article, an internal one, and a slug that never existed must be
 * INDISTINGUISHABLE from outside. It is not enough that each returns 404 — the
 * bodies must be identical too, because a reader who can tell "exists but not
 * for you" from "does not exist" can enumerate what the organisation is writing
 * about them.
 */

const FIELDS = {
  titleEn: 'Card reader keeps rebooting',
  bodyEn: 'The reader power-cycles when the card is inserted.',
};

const anonymous = () => supertest(app);

describe('four different reasons produce one identical answer', () => {
  it('returns byte-identical 404s for internal, draft, archived, and absent', async () => {
    // THE ASSERTION THIS FILE EXISTS FOR.
    const internal = await makeArticle({ ...FIELDS, audience: 'internal' });
    const draft = await makeArticle({ ...FIELDS, audience: 'customer', status: 'draft' });
    const archived = await makeArticle({ ...FIELDS, audience: 'customer', status: 'archived' });

    const responses = await Promise.all([
      anonymous().get(`/api/public/kb/articles/${internal.slug}`),
      anonymous().get(`/api/public/kb/articles/${draft.slug ?? 'a-draft'}`),
      anonymous().get(`/api/public/kb/articles/${archived.slug}`),
      anonymous().get('/api/public/kb/articles/never-existed-at-all'),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(404);
    }

    // Not merely the same status — the same BODY. A difference in the message,
    // the code, or the details would be enough to distinguish them.
    const bodies = responses.map((response) => JSON.stringify(response.body));
    expect(new Set(bodies).size).toBe(1);
  });

  it('serves a published customer-facing article, so the refusals mean something', async () => {
    // The control. Without this, every assertion above would pass on a surface
    // that simply refused everything.
    const article = await makeArticle({ ...FIELDS, audience: 'customer' });

    const response = await anonymous().get(`/api/public/kb/articles/${article.slug}`);

    expect(response.status).toBe(200);
    expect(response.body.title).toBe(FIELDS.titleEn);
  });
});

describe('an internal article cannot be reached by any public route', () => {
  it('is absent from public search', async () => {
    await makeArticle({ ...FIELDS, audience: 'internal' });

    const response = await anonymous().get('/api/public/kb/search?q=card+reader');

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
  });

  it('does not make its category appear in the public browse list', async () => {
    // A category listed with nothing in it tells a stranger that content exists
    // which they may not read — a smaller disclosure than the article, and
    // still one worth not making.
    await makeArticle({ ...FIELDS, audience: 'internal' });

    const response = await anonymous().get('/api/public/kb/categories');

    expect(response.body.items).toEqual([]);
  });

  it('is not counted in the cross-language offer', async () => {
    // The offer carries a NUMBER, and a number about internal content is still
    // information about internal content.
    await makeArticle({
      titleEn: 'Card reader escalation runbook',
      bodyEn: 'Page the on-call engineer.',
      audience: 'internal',
    });

    const response = await anonymous().get('/api/public/kb/search?q=card+reader&lang=ar');

    expect(response.body.items).toEqual([]);
    expect(response.body.otherLanguage).toBeNull();
  });
});

describe('the surface accepts nothing that could widen it', () => {
  it('ignores an audience parameter on the article route', async () => {
    // Somebody WILL try this. The controller passes a literal, so the parameter
    // is not read at all — this test proves the parameter is inert rather than
    // filtered.
    const internal = await makeArticle({ ...FIELDS, audience: 'internal' });

    for (const query of ['?audience=internal', '?status=draft', '?audience=internal&status=any']) {
      const response = await anonymous().get(`/api/public/kb/articles/${internal.slug}${query}`);
      expect(response.status).toBe(404);
    }
  });

  it('ignores an audience parameter on the search route', async () => {
    await makeArticle({ ...FIELDS, audience: 'internal' });

    const response = await anonymous().get('/api/public/kb/search?q=card+reader&audience=internal');

    expect(response.body.items).toEqual([]);
  });

  it('accepts no writes at all (FR-032b)', async () => {
    // No comments, no ratings, no corrections. The absence of every write verb
    // is what removes moderation, spam, and stored injection from this phase.
    const article = await makeArticle({ ...FIELDS, audience: 'customer' });

    const post = await anonymous()
      .post(`/api/public/kb/articles/${article.slug}`)
      .send({ comment: 'anything' });
    const patch = await anonymous()
      .patch(`/api/public/kb/articles/${article.slug}`)
      .send({ title: 'anything' });
    const remove = await anonymous().delete(`/api/public/kb/articles/${article.slug}`);

    for (const response of [post, patch, remove]) {
      expect(response.status).toBe(404);
    }
  });
});

describe('public URLs address articles by slug, never by id', () => {
  it('does not resolve an article by its numeric id (research D10)', async () => {
    // Sequential ids in a public URL disclose the size of the corpus and let a
    // stranger walk it one number at a time.
    const article = await makeArticle({ ...FIELDS, audience: 'customer' });

    const response = await anonymous().get(`/api/public/kb/articles/${article.id}`);

    expect(response.status).toBe(404);
  });
});
