import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import app from '../../src/app.js';
import { AuditLog, KbArticle } from '../../src/models/index.js';
import { reset as resetRateLimit } from '../../src/lib/rate-limit.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { makeArticle } from '../search/helpers.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  resetRateLimit();
});

afterAll(async () => {
  await closeTestDatabase();
});

/**
 * How often an article is read (FR-049), and NOTHING ABOUT WHO READ IT
 * (FR-050, SC-011).
 *
 * A COUNTER, NEVER AN EVENT TABLE (research D11). The distinction is the whole
 * of the privacy property, and it is structural rather than promised: a counter
 * HAS NOWHERE TO PUT an IP address. An event table has a column free the first
 * time somebody wants a trend, and adding it would be a one-line change nobody
 * would think to question.
 *
 * The public help centre sharpens this. Those reads come from strangers, in
 * volume, and a per-read row would be a log of what anonymous people are
 * worried about — the sort of data that is a liability from the moment it
 * exists. Phase 10 owns trends and can design its own thing, deliberately.
 */

const anonymous = () => supertest(app);

const FIELDS = {
  titleEn: 'Card reader keeps rebooting',
  bodyEn: 'Try a different card first, then contact us.',
  audience: 'customer' as const,
};

/** Give the fire-and-forget increment a moment to land. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe('reading an article counts it', () => {
  it('increments the counter on a public read', async () => {
    const article = await makeArticle(FIELDS);

    expect(article.view_count).toBe(0);

    await anonymous().get(`/api/public/kb/articles/${article.slug}`);
    await settle();

    expect((await KbArticle.findByPk(article.id))!.view_count).toBe(1);
  });

  it('counts each read', async () => {
    const article = await makeArticle(FIELDS);

    for (let i = 0; i < 3; i += 1) {
      await anonymous().get(`/api/public/kb/articles/${article.slug}`);
    }
    await settle();

    expect((await KbArticle.findByPk(article.id))!.view_count).toBe(3);
  });

  it('does not count a refused read', async () => {
    // A 404 read nothing. Counting it would inflate the number that stewardship
    // decisions are made on, and would let anybody inflate it at will.
    const internal = await makeArticle({ ...FIELDS, audience: 'internal' });

    await anonymous().get(`/api/public/kb/articles/${internal.slug}`);
    await settle();

    expect((await KbArticle.findByPk(internal.id))!.view_count).toBe(0);
  });
});

describe('nothing identifying the reader is stored (FR-050, SC-011)', () => {
  it('writes no audit entry for a read', async () => {
    // Reads are deliberately absent from AUDIT_ACTIONS. The view counter IS the
    // record, and it holds no identity. An audit row per public page view would
    // hand anybody on the internet a way to fill the log an investigator reads.
    const article = await makeArticle(FIELDS);

    await anonymous()
      .get(`/api/public/kb/articles/${article.slug}`)
      .set('X-Forwarded-For', '203.0.113.9')
      .set('User-Agent', 'a-very-identifiable-agent');
    await settle();

    expect(await AuditLog.count({ where: { target_type: 'kb_article' } })).toBe(0);
  });

  it('stores nothing from the request anywhere on the article', async () => {
    const article = await makeArticle(FIELDS);

    await anonymous()
      .get(`/api/public/kb/articles/${article.slug}`)
      .set('X-Forwarded-For', '203.0.113.9')
      .set('User-Agent', 'a-very-identifiable-agent');
    await settle();

    const reread = await KbArticle.findByPk(article.id);
    const serialised = JSON.stringify(reread!.toJSON());

    expect(serialised).not.toContain('203.0.113.9');
    expect(serialised).not.toContain('a-very-identifiable-agent');
  });

  it('has no table in which a per-read row could be stored', async () => {
    // THE STRUCTURAL ASSERTION. If a future phase adds a `kb_article_views`
    // table, this fails and the change becomes a decision somebody makes on
    // purpose rather than one that slips through as an improvement.
    const { sequelize } = await import('../../src/config/database.js');

    const [tables] = (await sequelize.query(
      `SELECT table_name AS name FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name LIKE 'kb_%'`,
    )) as [Array<{ name: string }>, unknown];

    expect(tables.map((t) => t.name).sort()).toEqual([
      'kb_article_terms',
      'kb_articles',
      'kb_categories',
      'kb_guide_steps',
      'kb_guides',
      'kb_ticket_articles',
    ]);
  });
});

describe('counting does not disturb the stewardship signal', () => {
  it('leaves updated_at alone', async () => {
    // FR-048 reads `updated_at` as "when did somebody last CHANGE this". A
    // counter that bumped it would make every popular article look freshly
    // maintained — which is precisely backwards, because a heavily read stale
    // article is the most urgent thing in the corpus.
    const article = await makeArticle(FIELDS);
    const before = (await KbArticle.findByPk(article.id))!.updated_at.getTime();

    await anonymous().get(`/api/public/kb/articles/${article.slug}`);
    await settle();

    const after = (await KbArticle.findByPk(article.id))!;

    expect(after.view_count).toBe(1);
    expect(after.updated_at.getTime()).toBe(before);
  });
});

describe('the public read survives a counter failure', () => {
  it('serves the article even when the increment cannot be written', async () => {
    // The increment is best-effort and off the response path (plan.md, changed
    // during planning). An unauthenticated GET that writes on every view is a
    // denial-of-service amplifier aimed at the one surface strangers can reach;
    // a dropped count is a statistic, a saturated pool is an outage.
    const { vi } = await import('vitest');
    const articleService = await import('../../src/services/kb-article.service.js');

    const article = await makeArticle(FIELDS);

    vi.spyOn(articleService, 'recordView').mockRejectedValue(new Error('database unavailable'));

    const response = await anonymous().get(`/api/public/kb/articles/${article.slug}`);

    expect(response.status).toBe(200);
    expect(response.body.title).toBe(FIELDS.titleEn);

    vi.restoreAllMocks();
  });
});
