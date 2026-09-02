import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS } from '../../src/services/audit.service.js';
import { AuditLog } from '../../src/models/index.js';
import { agentAs, type AuthedAgent } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { build, MONTH, ensureUtcCalendar } from '../reporting/fixture.js';

/**
 * Export audit (Phase 10, US3, FR-051, SC-023).
 *
 * An export is the moment operational data leaves the system and becomes a file
 * somebody can forward. That is exactly the event Phase 1's audit log exists
 * for, and this reuses its `data.exported` key rather than inventing a
 * reporting-specific one — it is the same event Phase 2 recorded for a customer
 * list.
 *
 * THE FILTERS ARE PART OF THE RECORD, not decoration. "Someone exported the SLA
 * report" is far less useful six months later than "someone exported the SLA
 * report for February, filtered to one team" — the second tells you what left.
 */
describe('export audit trail', () => {
  let supervisor: AuthedAgent;
  let email: string;

  beforeAll(async () => {
    await setupTestDatabase();
    await truncateAll();
    await ensureUtcCalendar();
    await build();

    const created = await agentAs('supervisor');
    supervisor = created.agent;
    email = created.user.email;
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  async function exportsRecorded() {
    return AuditLog.findAll({
      where: { action: AUDIT_ACTIONS.DATA_EXPORTED },
      order: [['id', 'ASC']],
    });
  }

  it('records every server-side export, attributable to the taker', async () => {
    const before = (await exportsRecorded()).length;

    const response = await supervisor
      .post(`/api/reports/volume/export?from=${MONTH.from}&to=${MONTH.to}`)
      .send({ format: 'csv' });

    expect(response.status).toBe(200);

    const after = await exportsRecorded();
    expect(after.length).toBe(before + 1);

    const entry = after[after.length - 1]!;

    // A named person, not just a user id — the id is useless once the row is
    // deleted, which is the case where the record matters most.
    expect(entry.actor_email).toBe(email);
    expect(entry.target_type).toBe('report');
    expect(entry.target_label).toBe('volume');
  });

  it('records the period and filters that produced the file', async () => {
    await supervisor
      .post(`/api/reports/volume/export?from=${MONTH.from}&to=${MONTH.to}&channel=email`)
      .send({ format: 'xlsx' });

    const entries = await exportsRecorded();
    const metadata = entries[entries.length - 1]!.metadata as Record<string, unknown>;

    expect(metadata.format).toBe('xlsx');
    expect(metadata.period).toMatchObject({ timeZone: expect.any(String) });
    expect(String((metadata.period as Record<string, string>).from)).toContain('2026-02-01');

    // The filter that narrowed the file is in the record. Without it the entry
    // cannot answer the only question anybody asks of it later: what left?
    expect(JSON.stringify(metadata.filters)).toContain('email');
  });

  it('records the row count, so a later reader knows the size of what left', async () => {
    await supervisor
      .post(`/api/reports/sla/export?from=${MONTH.from}&to=${MONTH.to}`)
      .send({ format: 'csv' });

    const entries = await exportsRecorded();
    const metadata = entries[entries.length - 1]!.metadata as Record<string, unknown>;

    expect(typeof metadata.rowCount).toBe('number');
    expect(metadata.rowCount as number).toBeGreaterThan(0);
  });

  it('does NOT record a refused export as an export', async () => {
    const before = (await exportsRecorded()).length;

    const response = await supervisor
      .post(`/api/reports/volume/export?from=${MONTH.from}&to=${MONTH.to}`)
      .send({ format: 'pdf' });

    // PDF is not a server format — it is the browser's print pipeline.
    expect(response.status).toBe(400);

    // Nothing left the system, so nothing is recorded as having left. An audit
    // log with entries for exports that never happened is an audit log nobody
    // trusts.
    expect((await exportsRecorded()).length).toBe(before);
  });
});
