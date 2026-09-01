import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import app from '../../src/app.js';
import { createTestUser } from '../helpers/auth.js';
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
 * NOTHING ABOUT THE ORGANISATION LEAVES THROUGH THIS SURFACE (FR-035).
 *
 * The public article payload is built by an ALLOW-LIST — every field is there
 * because somebody put it there. That is why these tests assert on the SET OF
 * KEYS rather than on a handful of forbidden names: a test that checked only
 * for `viewCount` and `author` would pass on the day somebody adds
 * `internalNotes` to the article model and spreads it into the response.
 *
 * What a stranger must not learn: who works here, how many articles exist, how
 * popular anything is, when anybody last touched it, or any internal id.
 */

const anonymous = () => supertest(app);

const FIELDS = {
  titleEn: 'Card reader keeps rebooting',
  bodyEn: 'Try a different card first, then contact us.',
  audience: 'customer' as const,
};

/** Exactly what a public article may contain. Nothing else. */
const ALLOWED_ARTICLE_KEYS = [
  'slug',
  'title',
  'body',
  'lang',
  'availableLanguages',
  'category',
  'guide',
].sort();

describe('the public article payload', () => {
  it('carries exactly the allowed keys and no others', async () => {
    const author = await createTestUser({ roleKey: 'agent' });
    const article = await makeArticle(FIELDS);
    await article.update({
      created_by_user_id: author.id,
      updated_by_user_id: author.id,
      published_by_user_id: author.id,
      view_count: 412,
    });

    const response = await anonymous().get(`/api/public/kb/articles/${article.slug}`);

    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(ALLOWED_ARTICLE_KEYS);
  });

  it('discloses no internal id anywhere in the response', async () => {
    // Including nested: the category is identified by SLUG, not by id.
    const article = await makeArticle(FIELDS);

    const response = await anonymous().get(`/api/public/kb/articles/${article.slug}`);
    const serialised = JSON.stringify(response.body);

    expect(response.body.id).toBeUndefined();
    expect(response.body.category?.id).toBeUndefined();
    expect(response.body.categoryId).toBeUndefined();
    expect(serialised).not.toContain('"id"');
  });

  it('discloses no author, no readership, and no timestamps', async () => {
    const author = await createTestUser({ roleKey: 'agent', fullName: 'Hala Ahmed' });
    const article = await makeArticle(FIELDS);
    await article.update({ updated_by_user_id: author.id, view_count: 412 });

    const response = await anonymous().get(`/api/public/kb/articles/${article.slug}`);
    const serialised = JSON.stringify(response.body);

    expect(serialised).not.toContain('Hala Ahmed');
    expect(serialised).not.toContain('412');
    expect(response.body.viewCount).toBeUndefined();
    expect(response.body.updatedAt).toBeUndefined();
    expect(response.body.publishedAt).toBeUndefined();
    expect(response.body.status).toBeUndefined();
    // Whether the organisation classifies this as customer-facing is internal
    // configuration. The reader can see it, which is the only fact they need.
    expect(response.body.audience).toBeUndefined();
  });

  it('still tells the reader which language they are being handed (FR-005a)', async () => {
    // The one thing this surface DOES have to disclose. A reader given an
    // English article inside an Arabic help centre must be told, or an
    // unreadable page looks like a broken one.
    const article = await makeArticle(FIELDS);

    const response = await anonymous().get(`/api/public/kb/articles/${article.slug}?lang=ar`);

    expect(response.status).toBe(200);
    expect(response.body.lang).toBe('en');
    expect(response.body.availableLanguages).toEqual(['en']);
  });
});

describe('the public search payload', () => {
  it('carries no article ids and no category ids', async () => {
    await makeArticle(FIELDS);

    const response = await anonymous().get('/api/public/kb/search?q=card+reader');

    expect(response.body.items.length).toBe(1);

    const hit = response.body.items[0];
    expect(Object.keys(hit).sort()).toEqual(
      ['slug', 'title', 'lang', 'excerpt', 'categoryName'].sort(),
    );
    expect(hit.articleId).toBeUndefined();
    expect(hit.categoryId).toBeUndefined();
    // Not even the score. It is an implementation detail of a ranking function
    // nobody outside needs to reason about, and publishing it invites tuning
    // queries against it.
    expect(hit.score).toBeUndefined();
  });

  it('does not report how large the corpus is', async () => {
    // Results are CAPPED, NOT PAGED. No total, no page count: a reader who
    // reaches page nine is enumerating, and a total hands them the size for
    // free.
    for (let i = 0; i < 25; i += 1) {
      await makeArticle({ ...FIELDS, titleEn: `Card reader note ${i}` });
    }

    const response = await anonymous().get('/api/public/kb/search?q=card+reader');

    expect(response.body.total).toBeUndefined();
    expect(response.body.page).toBeUndefined();
    expect(response.body.pageSize).toBeUndefined();
    expect(response.body.items.length).toBeLessThanOrEqual(10);
  });
});

describe('the public category payload', () => {
  it('identifies a category by slug and name, never by id or counts', async () => {
    // How many articles a category holds is a fact about the organisation, and
    // "3 articles" against "300" says something about its size.
    await makeArticle(FIELDS);

    const response = await anonymous().get('/api/public/kb/categories');

    expect(response.body.items.length).toBe(1);
    expect(Object.keys(response.body.items[0]).sort()).toEqual(
      ['slug', 'nameEn', 'nameAr', 'articles'].sort(),
    );
    // The browse tree carries slug and title only — never an id, and never a
    // body somebody has not asked for.
    expect(Object.keys(response.body.items[0].articles[0]).sort()).toEqual(
      ['slug', 'titleEn', 'titleAr'].sort(),
    );
    expect(response.body.items[0].articleCount).toBeUndefined();
    expect(response.body.items[0].ticketCategory).toBeUndefined();
  });
});
