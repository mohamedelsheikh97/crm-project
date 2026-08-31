import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import app from '../../src/app.js';
import { reset as resetRateLimit } from '../../src/lib/rate-limit.js';
import { Customer, FormDefinition, Message, Ticket } from '../../src/models/index.js';
import { agentAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

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

const anonymous = supertest(app);

async function seedForm(overrides: Partial<Record<string, unknown>> = {}): Promise<FormDefinition> {
  return FormDefinition.create({
    slug: 'contact-us',
    title_en: 'Contact us',
    title_ar: 'اتصل بنا',
    fields_json: [
      { key: 'email', type: 'email', required: true, label_en: 'Your email', label_ar: 'بريدك' },
      {
        key: 'orderNumber',
        type: 'text',
        required: true,
        label_en: 'Order number',
        label_ar: 'رقم الطلب',
      },
      { key: 'detail', type: 'textarea', required: false, label_en: 'Details', label_ar: 'التفاصيل' },
    ],
    default_category: null,
    default_priority: null,
    is_published: true,
    created_by_user_id: null,
    ...overrides,
  } as never);
}

/**
 * US7 — a form submission becomes a legible ticket (FR-082-FR-086).
 */
describe('public form submission', () => {
  it('creates a ticket carrying every answer with the question it answers', async () => {
    await seedForm();

    const response = await anonymous.post('/api/public/forms/contact-us/submissions').send({
      answers: { email: 'hala@example.com', orderNumber: 'A-1234', detail: 'It never arrived.' },
    });

    expect(response.status).toBe(202);

    const message = await Message.findOne();

    // The ANSWERS with their QUESTIONS, not one paragraph of run-together text.
    expect(message?.body).toContain('Order number');
    expect(message?.body).toContain('A-1234');
    expect(message?.body).toContain('Details');
    expect(message?.body).toContain('It never arrived.');

    const ticket = await Ticket.findOne();
    expect(ticket?.source).toBe('form');
    expect(ticket?.created_by_user_id).toBeNull();
  });

  it('discloses nothing about internal records in the response (FR-106)', async () => {
    await seedForm();

    const response = await anonymous
      .post('/api/public/forms/contact-us/submissions')
      .send({ answers: { email: 'hala@example.com', orderNumber: 'A-1' } });

    // No ticket id, no reference, no customer. A stranger must not be handed a
    // handle on internal records.
    expect(response.body).toEqual({ received: true });
  });

  it('answers identically whether the sender is known or a stranger (FR-106)', async () => {
    await seedForm();

    const { normaliseContact } = await import('../../src/lib/phone.js');
    const { CustomerContact } = await import('../../src/models/index.js');

    const known = await Customer.create({
      display_name: 'Known',
      company: null,
      address: null,
      is_active: true,
      created_by_user_id: null,
    });

    await CustomerContact.create({
      customer_id: known.id,
      kind: 'email',
      value_raw: 'known@example.com',
      value_normalised: normaliseContact('email', 'known@example.com'),
      is_primary: true,
    });

    const first = await anonymous
      .post('/api/public/forms/contact-us/submissions')
      .send({ answers: { email: 'known@example.com', orderNumber: 'A-1' } });

    const second = await anonymous
      .post('/api/public/forms/contact-us/submissions')
      .send({ answers: { email: 'stranger@example.com', orderNumber: 'A-2' } });

    // Byte-identical. Otherwise this endpoint becomes an oracle for "is this
    // address one of your customers?".
    expect(first.status).toBe(second.status);
    expect(first.body).toEqual(second.body);
  });

  it('enforces required fields SERVER-SIDE and names the failing one (FR-083)', async () => {
    await seedForm();

    const response = await anonymous
      .post('/api/public/forms/contact-us/submissions')
      .send({ answers: { email: 'hala@example.com' } });

    expect(response.status).toBe(400);
    expect(response.body.error.details).toContainEqual({
      field: 'orderNumber',
      message: 'forms.public.required',
    });

    expect(await Ticket.count()).toBe(0);
  });

  it('labels the answers in the submission language', async () => {
    await seedForm();

    await anonymous
      .post('/api/public/forms/contact-us/submissions?locale=ar')
      .send({ answers: { email: 'hala@example.com', orderNumber: 'A-1' } });

    const message = await Message.findOne();

    expect(message?.body).toContain('رقم الطلب');
    expect(message?.body).not.toContain('Order number');
  });

  it('KEEPS AN OLD TICKET READABLE after the form is edited (FR-085)', async () => {
    // The reason a submission copies the question text rather than referring
    // back to the definition: editing a form must not retroactively change what
    // a customer appears to have been asked.
    const form = await seedForm();

    await anonymous
      .post('/api/public/forms/contact-us/submissions')
      .send({ answers: { email: 'hala@example.com', orderNumber: 'A-1234' } });

    form.fields_json = [
      { key: 'email', type: 'email', required: true, label_en: 'Email', label_ar: 'بريد' },
      {
        key: 'orderNumber',
        type: 'text',
        required: true,
        label_en: 'COMPLETELY DIFFERENT QUESTION',
        label_ar: 'سؤال مختلف',
      },
    ];
    await form.save();

    const message = await Message.findOne();

    // Still says what was actually asked at the time.
    expect(message?.body).toContain('Order number');
    expect(message?.body).not.toContain('COMPLETELY DIFFERENT QUESTION');
  });

  it('refuses an unpublished form the same way as one that does not exist', async () => {
    await seedForm({ is_published: false });

    const submit = await anonymous
      .post('/api/public/forms/contact-us/submissions')
      .send({ answers: { email: 'a@b.com', orderNumber: 'A-1' } });

    const missing = await anonymous
      .post('/api/public/forms/does-not-exist/submissions')
      .send({ answers: {} });

    expect(submit.status).toBe(404);
    expect(missing.status).toBe(404);
  });

  it('rate limits repeated submissions without blocking the first (FR-086)', async () => {
    await seedForm();

    const { env } = await import('../../src/config/env.js');
    let refused = 0;

    for (let i = 0; i <= env.PUBLIC_RATE_PER_MINUTE + 1; i += 1) {
      const response = await anonymous
        .post('/api/public/forms/contact-us/submissions')
        .send({ answers: { email: `a${i}@example.com`, orderNumber: `A-${i}` } });

      if (response.status === 429) refused += 1;
    }

    expect(refused).toBeGreaterThan(0);
  });
});

describe('form definitions (FR-079, FR-080, FR-084)', () => {
  it('requires forms:manage to define one', async () => {
    const { agent } = await agentAs('agent');

    const response = await agent.post('/api/forms').send({
      slug: 'x-form',
      titleEn: 'X',
      titleAr: 'س',
      fields: [{ key: 'a', type: 'text', required: true, label_en: 'A', label_ar: 'أ' }],
    });

    expect(response.status).toBe(403);
  });

  it('requires a label in BOTH languages for every question', async () => {
    const { agent } = await agentAs('supervisor');

    const response = await agent.post('/api/forms').send({
      slug: 'x-form',
      titleEn: 'X',
      titleAr: 'س',
      fields: [{ key: 'a', type: 'text', required: true, label_en: 'A', label_ar: '' }],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].message).toBe('forms.error.labelRequired');
  });

  it('refuses a category outside Phase 3 taxonomy (FR-084)', async () => {
    const { agent } = await agentAs('supervisor');

    const response = await agent.post('/api/forms').send({
      slug: 'x-form',
      titleEn: 'X',
      titleAr: 'س',
      fields: [{ key: 'a', type: 'text', required: true, label_en: 'A', label_ar: 'أ' }],
      defaultCategory: 'invented-category',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].message).toBe('forms.error.categoryInvalid');
  });
});
