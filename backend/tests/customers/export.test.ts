import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuditLog, Role, RolePermission } from '../../src/models/index.js';
import { AUDIT_ACTIONS } from '../../src/services/audit.service.js';
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

async function grantSupervisorView(): Promise<void> {
  const role = await Role.findOne({ where: { key: 'supervisor' } });
  await RolePermission.findOrCreate({
    where: { role_id: role!.id, permission_key: 'customers:view' },
  });
}

/** quickstart B12 / FR-037-FR-040, FR-044. */
describe('customer export', () => {
  it('exports exactly the filtered rows, not the whole table', async () => {
    await grantSupervisorView();
    const { agent } = await agentAs('supervisor');

    await seedCustomer({ displayName: 'Ahmed Hassan', company: 'Nile Trading' });
    await seedCustomer({ displayName: 'Fatima Ali', company: 'Delta Logistics' });
    await seedCustomer({ displayName: 'Omar Said', company: 'Nile Trading' });

    const response = await agent.get('/api/customers/export?search=Nile');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');

    const body = response.text;
    expect(body).toContain('Ahmed Hassan');
    expect(body).toContain('Omar Said');
    // An export that silently returns everything is a data-leak-shaped surprise.
    expect(body).not.toContain('Fatima Ali');
  });

  it('begins with a UTF-8 BOM so a spreadsheet renders Arabic correctly', async () => {
    await grantSupervisorView();
    const { agent } = await agentAs('supervisor');
    await seedCustomer({ displayName: 'شركة النيل للتجارة' });

    const response = await agent.get('/api/customers/export');

    // Without the BOM Excel guesses the encoding and Arabic arrives as mojibake
    // — in the one place a customer's name is most likely read outside the team.
    expect(response.text.charCodeAt(0)).toBe(0xfeff);
    expect(response.text).toContain('شركة النيل للتجارة');
  });

  it('records the export in the audit log with a row count', async () => {
    await grantSupervisorView();
    const { agent } = await agentAs('supervisor');
    await seedCustomer();
    await seedCustomer();

    await agent.get('/api/customers/export');

    // Uses the key Phase 1 defined for exactly this, rather than a new one.
    const entry = await AuditLog.findOne({ where: { action: AUDIT_ACTIONS.DATA_EXPORTED } });

    expect(entry).not.toBeNull();
    expect((entry!.metadata as { rowCount: number }).rowCount).toBe(2);
  });

  it('refuses a caller without customers:export', async () => {
    const { agent } = await agentAs('agent');

    expect((await agent.get('/api/customers/export')).status).toBe(403);
  });

  it('shows the raw phone value, never the normalised one', async () => {
    await grantSupervisorView();
    const { agent } = await agentAs('supervisor');
    await seedCustomer({ contacts: [{ kind: 'phone', value: '+20 100 123 4567' }] });

    const response = await agent.get('/api/customers/export');

    expect(response.text).toContain('+20 100 123 4567');
  });

  it('guards a leading + so a spreadsheet treats a phone number as text', async () => {
    await grantSupervisorView();
    const { agent } = await agentAs('supervisor');
    await seedCustomer({ contacts: [{ kind: 'phone', value: '+201001234567' }] });

    const exported = await agent.get('/api/customers/export');

    // Otherwise the spreadsheet reads it as a formula.
    expect(exported.text).toContain(`"'+201001234567"`);
  });

  it('excludes deactivated customers unless asked for', async () => {
    await grantSupervisorView();
    const { agent } = await agentAs('supervisor');
    await seedCustomer({ displayName: 'Active Person' });
    await seedCustomer({ displayName: 'Retired Person', isActive: false });

    const byDefault = await agent.get('/api/customers/export');
    expect(byDefault.text).not.toContain('Retired Person');

    const including = await agent.get('/api/customers/export?isActive=all');
    expect(including.text).toContain('Retired Person');
  });
});
