import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { agentAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestDatabase();
});

const BILINGUAL = {
  titleEn: 'Password reset',
  titleAr: 'إعادة تعيين كلمة المرور',
  bodyEn: 'I have sent you a reset link. It expires in one hour.',
  bodyAr: 'أرسلت إليك رابط إعادة التعيين، وتنتهي صلاحيته خلال ساعة.',
};

describe('the template library', () => {
  it('lets a manager create a bilingual template that every agent can then use', async () => {
    const manager = await agentAs('supervisor');
    const agent = await agentAs('agent');

    const created = await manager.agent.post('/api/templates').send(BILINGUAL);

    expect(created.status).toBe(201);
    expect(created.body.availableLanguages).toEqual(['en', 'ar']);

    const listed = await agent.agent.get('/api/templates');
    expect(listed.body.items.map((t: { id: number }) => t.id)).toContain(created.body.id);
  });

  it('reports a single-language template as such, rather than hiding it (FR-070)', async () => {
    // The picker offers this one WITH ITS LANGUAGE IDENTIFIED rather than
    // silently handing an Arabic-speaking agent English text.
    const manager = await agentAs('supervisor');

    const created = await manager.agent.post('/api/templates').send({
      titleEn: 'Escalated to a specialist',
      bodyEn: 'I have passed this to a specialist who handles this area.',
    });

    expect(created.status).toBe(201);
    expect(created.body.availableLanguages).toEqual(['en']);
    expect(created.body.titleAr).toBeNull();
  });

  it('refuses a template with neither complete language pair', async () => {
    const manager = await agentAs('supervisor');

    const response = await manager.agent.post('/api/templates').send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('TEMPLATE_LANGUAGE_REQUIRED');
  });

  it('refuses a body with no title, and says which half is missing', async () => {
    // A constraint violation would be technically correct and useless. The
    // author needs to know what to fix.
    const manager = await agentAs('supervisor');

    const response = await manager.agent
      .post('/api/templates')
      .send({ bodyEn: 'Text with nothing to find it by' });

    expect(response.status).toBe(400);
    expect(response.body.error.details.map((d: { field: string }) => d.field)).toContain('titleEn');
  });

  it('refuses a title with no body', async () => {
    const manager = await agentAs('supervisor');

    const response = await manager.agent.post('/api/templates').send({ titleAr: 'عنوان بلا نص' });

    expect(response.status).toBe(400);
    expect(response.body.error.details.map((d: { field: string }) => d.field)).toContain('bodyAr');
  });
});

describe('finding a template', () => {
  it('searches title and body in either language', async () => {
    const manager = await agentAs('supervisor');
    const agent = await agentAs('agent');

    await manager.agent.post('/api/templates').send(BILINGUAL);
    await manager.agent
      .post('/api/templates')
      .send({ titleEn: 'Refund policy', bodyEn: 'Refunds are processed within five days.' });

    // By title...
    expect((await agent.agent.get('/api/templates?q=Refund')).body.total).toBe(1);
    // ...by a phrase from the body...
    expect((await agent.agent.get('/api/templates?q=five days')).body.total).toBe(1);
    // ...and in Arabic.
    expect((await agent.agent.get('/api/templates?q=إعادة')).body.total).toBe(1);
  });

  it('is bounded rather than rendering the whole library', async () => {
    const manager = await agentAs('supervisor');
    const agent = await agentAs('agent');

    for (let index = 0; index < 5; index += 1) {
      await manager.agent
        .post('/api/templates')
        .send({ titleEn: `Template ${index}`, bodyEn: 'Body' });
    }

    const response = await agent.agent.get('/api/templates?pageSize=2');

    expect(response.body.items).toHaveLength(2);
    expect(response.body.total).toBe(5);
  });
});

describe('retirement, not deletion (FR-071)', () => {
  it('removes a retired template from the picker while leaving the record', async () => {
    const manager = await agentAs('supervisor');
    const agent = await agentAs('agent');

    const created = await manager.agent.post('/api/templates').send(BILINGUAL);

    const retired = await manager.agent.post(`/api/templates/${created.body.id}/retire`);
    expect(retired.status).toBe(200);
    expect(retired.body.retiredAt).not.toBeNull();

    // Gone from the picker...
    expect((await agent.agent.get('/api/templates')).body.total).toBe(0);
    // ...but still there for management.
    expect((await manager.agent.get('/api/templates?includeRetired=true')).body.total).toBe(1);
  });

  it('offers no delete route at all', async () => {
    const manager = await agentAs('supervisor');
    const created = await manager.agent.post('/api/templates').send(BILINGUAL);

    expect((await manager.agent.delete(`/api/templates/${created.body.id}`)).status).toBe(404);
  });

  it('is idempotent', async () => {
    const manager = await agentAs('supervisor');
    const created = await manager.agent.post('/api/templates').send(BILINGUAL);

    const first = await manager.agent.post(`/api/templates/${created.body.id}/retire`);
    const second = await manager.agent.post(`/api/templates/${created.body.id}/retire`);

    expect(second.status).toBe(200);
    expect(second.body.retiredAt).toBe(first.body.retiredAt);
  });
});

describe('using a template is not managing it (FR-069)', () => {
  it('lets an agent read the library but not change it', async () => {
    const manager = await agentAs('supervisor');
    const agent = await agentAs('agent');

    const created = await manager.agent.post('/api/templates').send(BILINGUAL);

    expect((await agent.agent.get('/api/templates')).status).toBe(200);

    expect((await agent.agent.post('/api/templates').send(BILINGUAL)).status).toBe(403);
    expect(
      (await agent.agent.patch(`/api/templates/${created.body.id}`).send({ titleEn: 'Changed' }))
        .status,
    ).toBe(403);
    expect((await agent.agent.post(`/api/templates/${created.body.id}/retire`)).status).toBe(403);
  });
});

describe('the library is audited, ordinary work is not (FR-077)', () => {
  it('records creating, editing, and retiring a template', async () => {
    const manager = await agentAs('supervisor');
    const admin = await agentAs('admin');

    const created = await manager.agent.post('/api/templates').send(BILINGUAL);
    await manager.agent
      .patch(`/api/templates/${created.body.id}`)
      .send({ titleEn: 'Password reset (revised)' });
    await manager.agent.post(`/api/templates/${created.body.id}/retire`);

    const audit = await admin.agent.get('/api/admin/audit');
    const actions = audit.body.items.map((entry: { action: string }) => entry.action);

    expect(actions).toContain('template.created');
    expect(actions).toContain('template.updated');
    expect(actions).toContain('template.retired');
  });
});
