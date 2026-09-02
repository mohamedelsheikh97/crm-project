import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../src/app.js';
import { reset as resetRateLimit } from '../../src/lib/rate-limit.js';
import { FormDefinition, Ticket } from '../../src/models/index.js';
import * as searchService from '../../src/services/kb-search.service.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { makeArticle } from '../search/helpers.js';

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
 * DEFLECTION NEVER GETS IN THE WAY (FR-032d, FR-032e).
 *
 * Deflection is offering a customer an article as they describe their problem,
 * so they can solve it without waiting for anybody. It is genuinely valuable
 * and it is ADVISORY, and the second half is the one that needs defending.
 *
 * THE FAILURE THIS PREVENTS: a form that waits for a search before it will
 * submit. It looks harmless in a diff — an await, a disabled button while
 * loading — and it means that when the search is slow, broken, or rate limited,
 * A CUSTOMER WITH A PROBLEM CANNOT REACH A PERSON. That is the worst outcome
 * this system can produce, and it would be caused by a feature meant to help.
 *
 * So Phase 5's submission path is UNCHANGED by this phase, and these tests
 * prove it: submission succeeds identically whether deflection returned
 * matches, returned nothing, or threw.
 */

const anonymous = supertest(app);

async function seedForm(): Promise<FormDefinition> {
  return FormDefinition.create({
    slug: 'contact-us',
    title_en: 'Contact us',
    title_ar: 'اتصل بنا',
    fields_json: [
      { key: 'email', type: 'email', required: true, label_en: 'Your email', label_ar: 'بريدك' },
      {
        key: 'detail',
        type: 'textarea',
        required: false,
        label_en: 'Details',
        label_ar: 'التفاصيل',
      },
    ],
    default_category: null,
    default_priority: null,
    is_published: true,
    created_by_user_id: null,
  } as never);
}

const SUBMISSION = {
  answers: { email: 'hala@example.com', detail: 'The card reader keeps rebooting.' },
};

const ARTICLE = {
  titleEn: 'Card reader keeps rebooting',
  bodyEn: 'Try a different card first, then contact us.',
  audience: 'customer' as const,
};

describe('submitting succeeds regardless of what deflection did', () => {
  it('succeeds when deflection found a matching article', async () => {
    await seedForm();
    await makeArticle(ARTICLE);

    // The customer saw a suggestion and submitted anyway. That is a legitimate
    // choice, not a failure of the suggestion.
    const response = await anonymous
      .post('/api/public/forms/contact-us/submissions')
      .send(SUBMISSION);

    expect(response.status).toBe(202);
    expect(await Ticket.count()).toBe(1);
  });

  it('succeeds when deflection found nothing', async () => {
    await seedForm();

    const response = await anonymous
      .post('/api/public/forms/contact-us/submissions')
      .send(SUBMISSION);

    expect(response.status).toBe(202);
    expect(await Ticket.count()).toBe(1);
  });

  it('succeeds when the search path THROWS', async () => {
    // THE ASSERTION THIS FILE EXISTS FOR. If submission ever came to depend on
    // search, this is where it would show — and it is the case nobody would
    // think to try by hand.
    await seedForm();

    vi.spyOn(searchService, 'search').mockRejectedValue(new Error('index unavailable'));

    const response = await anonymous
      .post('/api/public/forms/contact-us/submissions')
      .send(SUBMISSION);

    expect(response.status).toBe(202);
    expect(await Ticket.count()).toBe(1);
  });

  it('succeeds when the search scope is completely rate limited', async () => {
    // A customer whose keystrokes exhausted the search allowance must still be
    // able to submit. Scoped limiting is what makes this true (FR-036), and
    // this is the customer-facing consequence of that design.
    await seedForm();
    await makeArticle(ARTICLE);

    for (let i = 0; i < 200; i += 1) {
      const search = await anonymous.get('/api/public/kb/search?q=card+reader');
      if (search.status === 429) break;
    }

    const response = await anonymous
      .post('/api/public/forms/contact-us/submissions')
      .send(SUBMISSION);

    expect(response.status).toBe(202);
    expect(await Ticket.count()).toBe(1);
  });
});

describe('the submission path is unchanged by this phase', () => {
  it('produces the same ticket whether or not articles exist to deflect with', async () => {
    // Phase 5's path, byte for byte. If adding a knowledge base changed what a
    // submitted ticket looks like, every Phase 5 assumption downstream would be
    // quietly in question.
    await seedForm();

    await anonymous.post('/api/public/forms/contact-us/submissions').send(SUBMISSION);
    const withoutArticles = await Ticket.findOne({ order: [['id', 'DESC']] });

    await makeArticle(ARTICLE);

    await anonymous.post('/api/public/forms/contact-us/submissions').send(SUBMISSION);
    const withArticles = await Ticket.findOne({ order: [['id', 'DESC']] });

    expect(withArticles!.subject).toBe(withoutArticles!.subject);
    expect(withArticles!.category).toBe(withoutArticles!.category);
    expect(withArticles!.priority).toBe(withoutArticles!.priority);
    expect(withArticles!.status).toBe(withoutArticles!.status);
  });

  it('attaches no article to a submitted ticket', async () => {
    // Deflection SHOWS an article; it does not decide one answered the ticket.
    // `kb_ticket_articles` holds decisions, and a customer scrolling past a
    // suggestion made none.
    const { KbTicketArticle } = await import('../../src/models/index.js');

    await seedForm();
    await makeArticle(ARTICLE);

    await anonymous.post('/api/public/forms/contact-us/submissions').send(SUBMISSION);

    expect(await KbTicketArticle.count()).toBe(0);
  });
});
