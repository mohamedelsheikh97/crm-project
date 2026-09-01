import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import app from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { reset as resetRateLimits } from '../../src/lib/rate-limit.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { makeArticle } from '../search/helpers.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  resetRateLimits();
});

afterAll(async () => {
  await closeTestDatabase();
});

/**
 * SCOPED RATE LIMITING (FR-036).
 *
 * THE PROPERTY IS THE INDEPENDENCE, not the limit. Exhausting one scope must
 * not exhaust another, and the reason is a specific failure: search costs more
 * than reading — a tokenisation, an index scan, a ranking pass — so it carries
 * a tighter allowance. If the two shared a bucket, somebody hammering search
 * would knock out READING for every legitimate customer at the same address,
 * including the one part-way through a guide.
 *
 * This is exactly the property Phase 5 built `rateLimit(scope, limit)` for, and
 * Phase 7 is the first phase with two public scopes of genuinely different cost
 * to test it against.
 */

const anonymous = () => supertest(app);

const FIELDS = {
  titleEn: 'Card reader keeps rebooting',
  bodyEn: 'Try a different card first, then contact us.',
  audience: 'customer' as const,
};

async function exhaust(path: string, attempts: number): Promise<number> {
  let lastStatus = 200;

  for (let i = 0; i < attempts; i += 1) {
    lastStatus = (await anonymous().get(path)).status;
    if (lastStatus === 429) break;
  }

  return lastStatus;
}

describe('the two public knowledge scopes are independent', () => {
  it('exhausting search does not exhaust reading', async () => {
    // THE ASSERTION THIS FILE EXISTS FOR.
    const article = await makeArticle(FIELDS);

    const searchStatus = await exhaust(
      '/api/public/kb/search?q=card+reader',
      env.PUBLIC_RATE_PER_MINUTE + 5,
    );

    expect(searchStatus).toBe(429);

    // The reader who was part-way through an article is unaffected.
    const read = await anonymous().get(`/api/public/kb/articles/${article.slug}`);
    expect(read.status).toBe(200);
  });

  it('exhausting reading does not exhaust search', async () => {
    const article = await makeArticle(FIELDS);

    const readStatus = await exhaust(
      `/api/public/kb/articles/${article.slug}`,
      env.PUBLIC_RATE_PER_MINUTE * 3 + 5,
    );

    expect(readStatus).toBe(429);

    const search = await anonymous().get('/api/public/kb/search?q=card+reader');
    expect(search.status).toBe(200);
  });

  it('does not exhaust the Phase 5 form scopes either', async () => {
    // The public form is how a customer reaches a person. Flooding the help
    // centre must never close that door — deflection is advisory, and a
    // customer who wants a human gets one (FR-032e).
    await makeArticle(FIELDS);

    await exhaust('/api/public/kb/search?q=card+reader', env.PUBLIC_RATE_PER_MINUTE + 5);

    // 404 because no such form is seeded — the point is that it is not 429.
    const form = await anonymous().get('/api/public/forms/some-form');
    expect(form.status).not.toBe(429);
  });
});

describe('the refusal is well behaved', () => {
  it('answers 429 with a Retry-After header', async () => {
    // The things reaching this endpoint are not all our interface (FR-105), and
    // Retry-After is the header a well-behaved client already obeys.
    await makeArticle(FIELDS);

    let response = await anonymous().get('/api/public/kb/search?q=card+reader');

    for (let i = 0; i < env.PUBLIC_RATE_PER_MINUTE + 5 && response.status !== 429; i += 1) {
      response = await anonymous().get('/api/public/kb/search?q=card+reader');
    }

    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBeDefined();
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('gives search a tighter allowance than reading, because it costs more', async () => {
    // Stated as an assertion so a later change that equalises them is a
    // deliberate decision rather than an accident.
    const article = await makeArticle(FIELDS);

    let searchCalls = 0;
    let response = await anonymous().get('/api/public/kb/search?q=card+reader');
    while (response.status === 200 && searchCalls < 500) {
      searchCalls += 1;
      response = await anonymous().get('/api/public/kb/search?q=card+reader');
    }

    resetRateLimits();

    let readCalls = 0;
    response = await anonymous().get(`/api/public/kb/articles/${article.slug}`);
    while (response.status === 200 && readCalls < 500) {
      readCalls += 1;
      response = await anonymous().get(`/api/public/kb/articles/${article.slug}`);
    }

    expect(readCalls).toBeGreaterThan(searchCalls);
  });
});
