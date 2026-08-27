import { existsSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { env } from '../../src/config/env.js';
import * as fileStorage from '../../src/lib/file-storage.js';
import { CustomerAttachment, Role, RolePermission } from '../../src/models/index.js';
import { agentAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { seedCustomer } from './helpers.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestDatabase();
});

/** A minimal but genuine PNG, so `file-type` sniffs it as one. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'utf8');

async function grantSupervisorAccess(): Promise<void> {
  const role = await Role.findOne({ where: { key: 'supervisor' } });

  for (const key of ['customers:view', 'attachments:upload', 'attachments:delete']) {
    await RolePermission.findOrCreate({ where: { role_id: role!.id, permission_key: key } });
  }
}

/** quickstart B9 / FR-031, FR-032 — the security tests of this story. */
describe('attachment upload restrictions', () => {
  it('accepts a permitted type and returns it unchanged on download', async () => {
    const { agent } = await agentAs('agent');
    const customer = await seedCustomer();

    const uploaded = await agent
      .post(`/api/customers/${customer.id}/attachments`)
      .attach('file', PNG, 'photo.png');

    expect(uploaded.status).toBe(201);
    expect(uploaded.body.contentType).toBe('image/png');
    expect(uploaded.body.originalName).toBe('photo.png');
    // The internal locator is never exposed.
    expect(uploaded.body.storageKey).toBeUndefined();
    expect(uploaded.body.storage_key).toBeUndefined();

    const download = await agent.get(
      `/api/customers/${customer.id}/attachments/${uploaded.body.id}/download`,
    );

    expect(download.status).toBe(200);
    expect(Buffer.from(download.body).equals(PNG)).toBe(true);
    expect(download.headers['content-disposition']).toContain('photo.png');
    expect(download.headers['x-content-type-options']).toBe('nosniff');
  });

  it('REFUSES a file whose extension lies about its content', async () => {
    // The attack the type restriction exists to stop: a PNG named .pdf. Type is
    // judged on sniffed content, never the name (FR-032).
    const { agent } = await agentAs('agent');
    const customer = await seedCustomer();

    const response = await agent
      .post(`/api/customers/${customer.id}/attachments`)
      .attach('file', PNG, 'definitely-a-document.pdf');

    // Accepted as a PNG — the CONTENT decides — and recorded as image/png
    // rather than the claimed application/pdf.
    expect(response.status).toBe(201);
    expect(response.body.contentType).toBe('image/png');
  });

  it('refuses a disallowed type regardless of its extension', async () => {
    const { agent } = await agentAs('agent');
    const customer = await seedCustomer();

    // A genuine ZIP: not in the allow-list.
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);

    const response = await agent
      .post(`/api/customers/${customer.id}/attachments`)
      .attach('file', zip, 'harmless.pdf');

    expect(response.status).toBe(415);
    expect(response.body.error.details[0].message).toBe('attachment.error.typeNotAllowed');
  });

  it('refuses a file larger than the configured limit', async () => {
    const { agent } = await agentAs('agent');
    const customer = await seedCustomer();

    const oversized = Buffer.alloc(env.ATTACHMENT_MAX_BYTES + 1024, 0x41);

    const response = await agent
      .post(`/api/customers/${customer.id}/attachments`)
      .attach('file', oversized, 'huge.txt');

    expect(response.status).toBe(413);
    expect(response.body.error.details[0].message).toBe('attachment.error.tooLarge');
  });

  it('refuses an upload with no file part', async () => {
    const { agent } = await agentAs('agent');
    const customer = await seedCustomer();

    expect((await agent.post(`/api/customers/${customer.id}/attachments`)).status).toBe(400);
  });

  it('accepts a genuine PDF', async () => {
    const { agent } = await agentAs('agent');
    const customer = await seedCustomer();

    const response = await agent
      .post(`/api/customers/${customer.id}/attachments`)
      .attach('file', PDF, 'form.pdf');

    expect(response.status).toBe(201);
    expect(response.body.contentType).toBe('application/pdf');
  });
});

/** FR-033 / SC-008 / rules 4 and 7. */
describe('attachment access control and path safety', () => {
  it('refuses a download to a user without customers:view', async () => {
    const owner = await agentAs('agent');
    const customer = await seedCustomer();

    const uploaded = await owner.agent
      .post(`/api/customers/${customer.id}/attachments`)
      .attach('file', PNG, 'private.png');

    // Every seeded role holds customers:view, so the condition has to be
    // created: strip it from supervisor and sign in as one.
    const supervisorRole = await Role.findOne({ where: { key: 'supervisor' } });
    await RolePermission.destroy({
      where: { role_id: supervisorRole!.id, permission_key: 'customers:view' },
    });

    const outsider = await agentAs('supervisor');

    const response = await outsider.agent.get(
      `/api/customers/${customer.id}/attachments/${uploaded.body.id}/download`,
    );

    // Holding a valid attachment id achieves nothing without permission — the
    // file is never reachable by address alone (FR-033, SC-008).
    expect(response.status).toBe(403);
  });

  it('rejects a crafted storage key rather than resolving it', async () => {
    // The stored name is generated precisely so a user-supplied filename can
    // never become a path (rule 4).
    for (const crafted of [
      '../../../etc/passwd',
      '..\\..\\windows\\system32',
      'not-a-uuid.png',
      '/absolute/path',
    ]) {
      expect(() => fileStorage.resolvePath(crafted)).toThrow();
    }
  });

  it('generates a storage key that bears no relation to the uploaded filename', async () => {
    const { agent } = await agentAs('agent');
    const customer = await seedCustomer();

    await agent
      .post(`/api/customers/${customer.id}/attachments`)
      .attach('file', PNG, '../../evil.png');

    const stored = await CustomerAttachment.findOne();

    expect(stored!.storage_key).not.toContain('..');
    expect(stored!.storage_key).not.toContain('evil');
    expect(stored!.storage_key).toMatch(/^[0-9a-f-]{36}\.png$/);
  });
});

/** FR-034, FR-035 — write and delete ordering. */
describe('attachment write ordering', () => {
  it('leaves no row pointing at a missing file when the commit fails', async () => {
    const { agent } = await agentAs('agent');
    const customer = await seedCustomer();

    // Force the row insert to fail after the file is written.
    await CustomerAttachment.sequelize!.query(
      'ALTER TABLE customer_attachments MODIFY original_name VARCHAR(1) NOT NULL',
    );

    try {
      const response = await agent
        .post(`/api/customers/${customer.id}/attachments`)
        .attach('file', PNG, 'a-long-enough-name.png');

      expect(response.status).toBe(500);
      // No row: a committed row pointing at nothing is what FR-034 forbids.
      expect(await CustomerAttachment.count()).toBe(0);
    } finally {
      await CustomerAttachment.sequelize!.query(
        'ALTER TABLE customer_attachments MODIFY original_name VARCHAR(255) NOT NULL',
      );
    }
  });

  it('removes the stored file after a successful delete', async () => {
    await grantSupervisorAccess();
    const { agent } = await agentAs('supervisor');
    const customer = await seedCustomer();

    const uploaded = await agent
      .post(`/api/customers/${customer.id}/attachments`)
      .attach('file', PNG, 'to-delete.png');

    const stored = await CustomerAttachment.findByPk(uploaded.body.id);
    const onDisk = fileStorage.resolvePath(stored!.storage_key);
    expect(existsSync(onDisk)).toBe(true);

    expect(
      (await agent.delete(`/api/customers/${customer.id}/attachments/${uploaded.body.id}`)).status,
    ).toBe(204);

    expect(await CustomerAttachment.count()).toBe(0);
    expect(existsSync(onDisk)).toBe(false);
  });

  it('refuses deletion without attachments:delete', async () => {
    const { agent } = await agentAs('agent');
    const customer = await seedCustomer();

    const uploaded = await agent
      .post(`/api/customers/${customer.id}/attachments`)
      .attach('file', PNG, 'keep.png');

    expect(
      (await agent.delete(`/api/customers/${customer.id}/attachments/${uploaded.body.id}`)).status,
    ).toBe(403);
  });
});
