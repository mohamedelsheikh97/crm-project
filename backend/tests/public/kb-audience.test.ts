import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as searchService from '../../src/services/kb-search.service.js';
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
 * THE SERVICE ITSELF CANNOT SERVE INTERNAL CONTENT TO A CUSTOMER AUDIENCE.
 *
 * `kb-visibility.test.ts` asserts the same property through the HTTP surface,
 * and both are needed. That file proves the CONTROLLER passes the right
 * literal today. This one proves the SERVICE would refuse even if it did not —
 * which is the assertion that survives somebody refactoring the controller.
 *
 * The distinction matters because the dangerous change is not "somebody removes
 * the literal". It is "somebody makes the function reusable" — threading
 * `audience` through from a request so one handler can serve both surfaces.
 * That change looks like good engineering in a diff, and it is one line away
 * from serving internal content to the internet (research D7).
 *
 * So this file calls `search` DIRECTLY, with `audience: 'customer'`, and asserts
 * that no arrangement of arguments produces an internal article.
 */

const INTERNAL = {
  titleEn: 'Card reader escalation runbook',
  bodyEn: 'Page the on-call engineer and quote the terminal serial number.',
  audience: 'internal' as const,
};

const CUSTOMER = {
  titleEn: 'Card reader keeps rebooting',
  bodyEn: 'Try a different card first, then contact us.',
  audience: 'customer' as const,
};

async function customerSearch(query: string, lang: 'en' | 'ar' = 'en') {
  return searchService.search({ query, lang, audience: 'customer' });
}

describe('a customer-audience search never returns internal content', () => {
  it('excludes an internal article that matches perfectly', async () => {
    await makeArticle(INTERNAL);

    expect((await customerSearch('card reader escalation runbook')).items).toEqual([]);
  });

  it('returns only the customer article when both match', async () => {
    const internal = await makeArticle(INTERNAL);
    const customer = await makeArticle(CUSTOMER);

    const ids = (await customerSearch('card reader')).items.map((hit) => hit.articleId);

    expect(ids).toEqual([customer.id]);
    expect(ids).not.toContain(internal.id);
  });

  it('excludes it however the query is shaped', async () => {
    // Not a single lucky query: the exclusion is a property of the audience
    // argument, not of what was searched for.
    await makeArticle(INTERNAL);

    for (const query of ['card', 'reader', 'escalation', 'runbook', 'on-call engineer', 'card reader']) {
      expect((await customerSearch(query)).items).toEqual([]);
    }
  });

  it('excludes it when a category filter is applied', async () => {
    // A category filter NARROWS. It must never be a route around the audience.
    const internal = await makeArticle(INTERNAL);

    const result = await searchService.search({
      query: 'card reader',
      lang: 'en',
      audience: 'customer',
      categoryId: internal.category_id,
    });

    expect(result.items).toEqual([]);
  });

  it('excludes it from the cross-language count', async () => {
    await makeArticle(INTERNAL);

    const result = await customerSearch('card reader', 'ar');

    expect(result.items).toEqual([]);
    // Not "0", and not an object — absent. A count of internal matches is still
    // information about internal content.
    expect(result.otherLanguage).toBeNull();
  });
});

describe('an internal audience sees both, because widening is safe', () => {
  it('returns customer-facing articles to an internal search too', async () => {
    // The relationship is one-way. An article a customer may read is not
    // thereby one an agent may not — an agent answering that customer needs to
    // see exactly what the customer was told.
    const internal = await makeArticle(INTERNAL);
    const customer = await makeArticle(CUSTOMER);

    const ids = (
      await searchService.search({ query: 'card reader', lang: 'en', audience: 'internal' })
    ).items.map((hit) => hit.articleId);

    expect(ids).toContain(internal.id);
    expect(ids).toContain(customer.id);
  });
});

describe('changing the audience takes effect immediately', () => {
  it('stops serving it publicly the moment it is made internal', async () => {
    const article = await makeArticle(CUSTOMER);

    expect((await customerSearch('card reader')).items.length).toBe(1);

    await article.update({ audience: 'internal' });

    // No reindex needed: the audience is read from the article at query time,
    // not baked into the index rows. Index rows record WORDS; visibility is a
    // property of the article and is joined at search time.
    expect((await customerSearch('card reader')).items).toEqual([]);
  });
});
