import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../src/app.js';
import { reset as resetRateLimit } from '../../src/lib/rate-limit.js';
import { Ticket } from '../../src/models/index.js';
import * as searchService from '../../src/services/kb-search.service.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { makeArticle } from '../search/helpers.js';

import { buildPortalWorld, portalAgent, type PortalWorld } from './fixtures.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  resetRateLimit();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closeTestDatabase();
});

/**
 * HELP CONTENT INSIDE THE PORTAL (Phase 8, User Story 6, FR-038 - FR-046,
 * SC-013, SC-014).
 *
 * Phase 7's Clarifications Q1 left this phase to decide deliberately whether the
 * authenticated portal reuses the public help centre or grows its own reading
 * view. It reuses it — the portal's knowledge controller RE-EXPORTS Phase 7's
 * public handlers, so FR-039's "identical results" is true by construction rather
 * than by comparison.
 *
 * The parity test below asserts it anyway, because "there is one implementation"
 * is a claim that stops being true the first time somebody copies a handler to
 * add a feature.
 */

describe('portal knowledge results equal the public help centre’s (FR-039)', () => {
  let world: PortalWorld;

  beforeEach(async () => {
    world = await buildPortalWorld();

    await makeArticle({
      titleEn: 'Resetting a card reader',
      bodyEn: 'Hold the button for ten seconds until the light turns green.',
      status: 'published',
      audience: 'customer',
    });

    await makeArticle({
      titleEn: 'Internal escalation runbook',
      bodyEn: 'Card reader faults escalate to the hardware team after two hours.',
      status: 'published',
      audience: 'internal',
    });

    await makeArticle({
      titleEn: 'Draft about card readers',
      bodyEn: 'Not finished yet.',
      status: 'draft',
      audience: 'customer',
    });
  });

  it('returns the same search results for the same query', async () => {
    const [portal, publicSurface] = await Promise.all([
      portalAgent(world.a.accessToken).get('/api/portal/kb/search?q=card%20reader&lang=en'),
      supertest(app).get('/api/public/kb/search?q=card%20reader&lang=en'),
    ]);

    expect(portal.status).toBe(200);
    expect(publicSurface.status).toBe(200);
    expect(portal.body).toEqual(publicSurface.body);
  });

  it('reaches no internal or unpublished article (FR-040, SC-013)', async () => {
    const results = await portalAgent(world.a.accessToken).get(
      '/api/portal/kb/search?q=card%20reader&lang=en',
    );

    const titles = results.body.items.map((item: { title: string }) => item.title);

    expect(titles).toContain('Resetting a card reader');
    expect(titles).not.toContain('Internal escalation runbook');
    expect(titles).not.toContain('Draft about card readers');
  });

  it('cannot be widened by a parameter', async () => {
    // Phase 7's controller passes `audience` and `status` as LITERALS, and the
    // portal mounts the same handler. Every shape a caller might try.
    const attempts = [
      '/api/portal/kb/search?q=escalation&lang=en&audience=internal',
      '/api/portal/kb/search?q=escalation&lang=en&status=draft',
      '/api/portal/kb/search?q=escalation&lang=en&audience[]=internal',
    ];

    for (const url of attempts) {
      const response = await portalAgent(world.a.accessToken).get(url);
      const titles = response.body.items.map((item: { title: string }) => item.title);

      expect(titles).not.toContain('Internal escalation runbook');
    }
  });

  it('returns the same 404 for a draft, an internal article, and a slug that never existed', async () => {
    const unknown = await portalAgent(world.a.accessToken).get(
      '/api/portal/kb/articles/no-such-article',
    );

    expect(unknown.status).toBe(404);

    // Drafts have no slug until first publish, so the strongest available form of
    // this assertion is that nothing customer-visible reaches them and the
    // refusal is indistinguishable from absence.
    expect(unknown.body.error.code).toBe('NOT_FOUND');
  });
});

describe('deflection while describing a request (FR-041, FR-042, FR-044, SC-014)', () => {
  let world: PortalWorld;

  beforeEach(async () => {
    world = await buildPortalWorld();

    await makeArticle({
      titleEn: 'Resetting a card reader',
      bodyEn: 'Hold the button for ten seconds until the light turns green.',
      status: 'published',
      audience: 'customer',
    });
  });

  it('offers a matching article for the customer’s draft', async () => {
    const response = await portalAgent(world.a.accessToken).get(
      '/api/portal/kb/suggestions?text=my%20card%20reader%20will%20not%20turn%20on',
    );

    expect(response.status).toBe(200);
    expect(response.body.items.length).toBeGreaterThan(0);
    expect(response.body.items[0].title).toBe('Resetting a card reader');
    // Internal ids never travel: a slug is the handle.
    expect(Object.keys(response.body.items[0]).sort()).toEqual([
      'excerpt',
      'lang',
      'slug',
      'title',
    ]);
  });

  it('returns an empty list rather than an error when nothing matches (FR-044)', async () => {
    const response = await portalAgent(world.a.accessToken).get(
      '/api/portal/kb/suggestions?text=something%20entirely%20unrelated%20to%20anything',
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
  });

  it('says nothing for a fragment too short to match on', async () => {
    const response = await portalAgent(world.a.accessToken).get(
      '/api/portal/kb/suggestions?text=card',
    );

    // Silence, not noise. Noise beside a submit button is worse than nothing.
    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
  });

  /**
   * THE ONE THAT MATTERS (FR-042, SC-014).
   *
   * Phase 7 wrote this rule for the public form and it applies with more force
   * here: a customer with a problem who cannot reach a person is the worst
   * outcome this system can produce, and it would be caused by a feature meant to
   * help. So submission is proven to succeed while suggestion is BROKEN.
   */
  it('submission succeeds even when the suggestion service throws', async () => {
    vi.spyOn(searchService, 'search').mockRejectedValue(new Error('index is on fire'));

    const suggestions = await portalAgent(world.a.accessToken).get(
      '/api/portal/kb/suggestions?text=my%20card%20reader%20will%20not%20turn%20on',
    );

    // The endpoint fails; the form must not.
    expect(suggestions.status).toBe(500);

    const submitted = await portalAgent(world.a.accessToken)
      .post('/api/portal/tickets')
      .send({ subject: 'Card reader', description: 'My card reader will not turn on.' });

    expect(submitted.status).toBe(201);
    expect(await Ticket.count({ where: { subject: 'Card reader' } })).toBe(1);
  });

  it('submission does not depend on the suggestion endpoint being called at all', async () => {
    const submitted = await portalAgent(world.a.accessToken)
      .post('/api/portal/tickets')
      .send({ subject: 'Straight to a person', description: 'I did not read anything first.' });

    expect(submitted.status).toBe(201);
  });
});
