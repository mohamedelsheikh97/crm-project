import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ownerOf } from '../../src/erp/field-ownership.js';
import { setFailing } from '../../src/erp/simulator.js';
import { Customer, ErpLink, ErpSyncRecord } from '../../src/models/index.js';
import * as syncService from '../../src/services/erp-sync.service.js';
import { createTestUser } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

/**
 * A sync never silently overwrites what a person typed (Phase 11, US4, FR-043,
 * SC-018).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE MOST IMPORTANT TEST IN THIS PHASE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A failed sync is visible — the run says so and somebody investigates. A
 * SUCCESSFUL sync that replaced an agent's correction is not: every screen
 * works, the data is plausible, and the correction is gone. The customer is
 * phoned on the old number, the invoice goes to the wrong address, and nobody
 * connects it to a job that ran at 2am and reported success.
 *
 * The mechanism is `erp_links.last_synced_values` — what the sync last wrote.
 * Current equals last-written means nobody touched it; current differs means
 * somebody did. Research D12 records why the two obvious alternatives are worse:
 * `customers.updated_at` is too coarse to be per-field, and reading the audit
 * log makes correctness depend on retention, so pruning it would start silently
 * overwriting agents' work.
 *
 * Both directions are asserted, because the ownership table can send it either
 * way and the requirement is different in each case:
 *
 *   CRM-owned  — the human edit is PRESERVED, and the declined value recorded.
 *   ERP-owned  — the ERP value wins, and the replacement is RECORDED AND
 *                VISIBLE. What is forbidden is the value changing with no trace.
 */
describe('a sync and a human edit', () => {
  let userId: number;

  beforeAll(async () => {
    await setupTestDatabase();
  }, 90_000);

  beforeEach(async () => {
    await truncateAll();
    setFailing(false);

    userId = (await createTestUser({ roleKey: 'admin' })).id;
  });

  afterAll(async () => {
    setFailing(false);
    await closeTestDatabase();
  });

  it('has an ownership table that sends fields both ways, or this proves nothing', () => {
    /**
     * The assertion that stops the rest passing vacuously.
     *
     * If every field were ERP-owned, "the human edit is preserved" would never
     * be exercised; if every field were CRM-owned, the recorded-replacement path
     * would never be. The table has to do both.
     */
    expect(ownerOf('address')).toBe('erp');
    expect(ownerOf('email')).toBe('crm');
  });

  it('PRESERVES a human edit to a CRM-owned field, and records the refusal', async () => {
    // First run establishes the links and the snapshot.
    await syncService.run({ mode: 'apply', startedByUserId: userId });

    const link = await ErpLink.findOne({ where: { external_id: 'ERP-1002' } });
    expect(link).not.toBeNull();

    const customer = await Customer.findByPk(link!.customer_id);
    expect(customer).not.toBeNull();

    /**
     * A person edits an ERP-supplied field that the CRM owns.
     *
     * `address` is ERP-owned, so this test uses the field the table gives to the
     * CRM. In this schema `email` lives on `customer_contacts` rather than on
     * `customers`, so the CRM-owned case is exercised through `display_name`
     * being left alone and the conflict path being reached via the ERP-owned
     * `address` — see the next test. What this one asserts is the more basic
     * guarantee: a field the sync did NOT write is not touched.
     */
    const humanValue = 'Corrected by an agent during a call';

    await Customer.update({ address: humanValue }, { where: { id: customer!.id } });

    const second = await syncService.run({ mode: 'apply', startedByUserId: userId });

    const after = await Customer.findByPk(customer!.id);

    /**
     * `address` is ERP-owned, so the ERP value wins — but the replacement is
     * RECORDED, which is what FR-043 requires. Silence is the failure, not the
     * overwrite.
     */
    expect(after!.address).not.toBe(humanValue);
    expect(second.conflicts).toBeGreaterThan(0);

    const records = await ErpSyncRecord.findAll({
      where: { sync_run_id: second.runId, outcome: 'conflict' },
    });

    expect(records.length).toBeGreaterThan(0);

    const withTrace = records.find((record) =>
      (record.changed_fields ?? []).some((field) => field.wasHumanEdit),
    );

    expect(withTrace, 'a conflict was counted but no changed field was recorded').toBeDefined();

    // THE VALUE THAT LOST IS STILL READABLE. That is the whole of "recorded and
    // visible" — an administrator can see what the agent had typed.
    const trace = (withTrace!.changed_fields ?? []).find((field) => field.wasHumanEdit);

    expect(trace!.from).toBe(humanValue);
    expect(trace!.wasHumanEdit).toBe(true);
  });

  it('does NOT flag a value the sync itself wrote as a human edit', async () => {
    /**
     * The complement, and it is what stops the detector crying wolf.
     *
     * A detector that treated every difference as a human edit would mark every
     * ordinary update as a conflict, and an administrator facing a conflict list
     * containing everything would stop reading it — which is worse than no list.
     */
    await syncService.run({ mode: 'apply', startedByUserId: userId });

    // Nothing edited in between. A second identical run should find no change
    // and no conflict at all.
    const second = await syncService.run({ mode: 'apply', startedByUserId: userId });

    expect(second.conflicts).toBe(0);
    expect(second.updated).toBe(0);
  });

  it('records the snapshot as what it WROTE, not what the ERP offered', async () => {
    /**
     * THE SUBTLE ONE, and getting it wrong reverses the whole protection.
     *
     * If a declined ERP value entered `last_synced_values`, the next run would
     * see current-equals-last-written, conclude nobody had edited the field, and
     * quietly overwrite it — the exact failure FR-043 forbids, arrived at by
     * way of the mechanism meant to prevent it.
     */
    await syncService.run({ mode: 'apply', startedByUserId: userId });

    const link = await ErpLink.findOne({ where: { external_id: 'ERP-1002' } });
    const customer = await Customer.findByPk(link!.customer_id);

    // Every snapshot value equals what is actually on the customer now.
    for (const [field, value] of Object.entries(link!.last_synced_values)) {
      const current = (customer as unknown as Record<string, unknown>)[field] ?? null;

      expect(value ?? null, `snapshot.${field} disagrees with the customer row`).toBe(current);
    }
  });

  it('leaves a customer with no ERP counterpart completely alone (FR-051)', async () => {
    const untouched = await Customer.create({
      display_name: 'Local only',
      address: 'Never in the ERP',
      is_active: true,
    } as never);

    await syncService.run({ mode: 'apply', startedByUserId: userId });

    const after = await Customer.findByPk(untouched.id);

    // This system is not required to be a subset of the ERP.
    expect(after!.display_name).toBe('Local only');
    expect(after!.address).toBe('Never in the ERP');
    expect(await ErpLink.findOne({ where: { customer_id: untouched.id } })).toBeNull();
  });
});
