import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { simulatorAdapter, setFailing } from '../../src/erp/simulator.js';
import { Customer, ErpLink, ErpSyncRecord, ErpSyncRun } from '../../src/models/index.js';
import * as syncService from '../../src/services/erp-sync.service.js';
import { createTestUser } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

/**
 * Synchronisation behaviour (Phase 11, US4, FR-044 - FR-051, SC-017, SC-019).
 *
 * The human-edit protection has its own file, because it is the requirement
 * whose failure is most damaging and least visible. This one covers the rest:
 * the preview writing nothing, skips carrying reasons, resumption, concurrency,
 * and an unreachable ERP changing nothing.
 */
describe('ERP synchronisation', () => {
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

  it('the PREVIEW writes nothing to customers (FR-044)', async () => {
    const before = await Customer.count();

    const summary = await syncService.run({ mode: 'preview', startedByUserId: userId });

    expect(summary.state).toBe('completed');
    // It classified real work...
    expect(summary.created).toBeGreaterThan(0);

    // ...and changed nothing. A preview that writes is not a preview.
    expect(await Customer.count()).toBe(before);
    expect(await ErpLink.count()).toBe(0);

    // But the classification IS recorded, which is what makes SC-017 checkable
    // after the fact rather than from memory.
    expect(await ErpSyncRecord.count({ where: { sync_run_id: summary.runId } })).toBeGreaterThan(0);
  });

  it('the preview and the run agree, record for record (SC-017)', async () => {
    const preview = await syncService.run({ mode: 'preview', startedByUserId: userId });
    const applied = await syncService.run({ mode: 'apply', startedByUserId: userId });

    /**
     * A preview that disagreed with the run would be worse than no preview,
     * because it was trusted. They agree here by construction — one code path
     * with a `mode` flag — and this asserts the property rather than the
     * implementation.
     */
    expect(applied.created).toBe(preview.created);
    expect(applied.updated).toBe(preview.updated);
    expect(applied.skipped).toBe(preview.skipped);
    expect(applied.conflicts).toBe(preview.conflicts);

    const outcomeFor = async (runId: number) => {
      const records = await ErpSyncRecord.findAll({ where: { sync_run_id: runId } });

      return records
        .map((record) => `${record.external_id}:${record.outcome}`)
        .sort()
        .join('|');
    };

    expect(await outcomeFor(applied.runId)).toBe(await outcomeFor(preview.runId));
  });

  it('SKIPS a record with a stated reason, and keeps going (FR-046)', async () => {
    const summary = await syncService.run({ mode: 'apply', startedByUserId: userId });

    const skips = await ErpSyncRecord.findAll({
      where: { sync_run_id: summary.runId, outcome: 'skipped' },
    });

    expect(skips.length).toBeGreaterThan(0);

    /**
     * EVERY skip names a reason. The natural implementation logs "skipped: 47"
     * and leaves the reader to guess, which is a record an administrator cannot
     * act on.
     */
    for (const skip of skips) {
      expect(skip.reason, `${skip.external_id} was skipped with no reason`).toBeTruthy();
      expect(skip.reason!.length).toBeGreaterThan(3);
    }

    // And the run completed: one bad row did not stop the other nine thousand.
    expect(summary.state).toBe('completed');
    expect(summary.created).toBeGreaterThan(0);
  });

  it('refuses a value its OWN validation would reject (FR-047)', async () => {
    const summary = await syncService.run({ mode: 'apply', startedByUserId: userId });

    const rejected = await ErpSyncRecord.findOne({
      where: { sync_run_id: summary.runId, external_id: 'ERP-1005' },
    });

    /**
     * A value this system would refuse from a person is refused from the ERP
     * too. Writing past validation because "the ERP is authoritative" would put
     * a record in the database that no screen could edit back into shape.
     */
    expect(rejected?.outcome).toBe('skipped');
    expect(rejected?.reason).toMatch(/not an address this system would accept/);

    // And it was NOT created despite being skipped for one field.
    expect(await ErpLink.findOne({ where: { external_id: 'ERP-1005' } })).toBeNull();
  });

  it('REPORTS an ERP-archived customer rather than deactivating it (FR-050)', async () => {
    const summary = await syncService.run({ mode: 'apply', startedByUserId: userId });

    const link = await ErpLink.findOne({ where: { external_id: 'ERP-1006' } });
    expect(link).not.toBeNull();

    const customer = await Customer.findByPk(link!.customer_id);

    /**
     * Deactivation in this system has consequences the ERP does not know about
     * — portal access, ticket routing — so an archive flag over there is
     * reported here rather than acted on.
     */
    expect(customer!.is_active).toBe(true);

    const record = await ErpSyncRecord.findOne({
      where: { sync_run_id: summary.runId, external_id: 'ERP-1006' },
    });

    expect(record?.reason).toMatch(/archived in the ERP but not deactivated/);
  });

  it('is IDEMPOTENT: a second run creates and updates nothing (FR-045)', async () => {
    await syncService.run({ mode: 'apply', startedByUserId: userId });

    const links = await ErpLink.count();
    const customers = await Customer.count();

    const second = await syncService.run({ mode: 'apply', startedByUserId: userId });

    /**
     * The property that makes a retry correct regardless of where it resumes.
     * The stored cursor only saves work — which is the right way round, because
     * a position that is merely an optimisation cannot corrupt anything by being
     * slightly wrong.
     */
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.conflicts).toBe(0);
    expect(await ErpLink.count()).toBe(links);
    expect(await Customer.count()).toBe(customers);
  });

  it('skips a SECOND ERP record claiming the same identifier (FR-041)', async () => {
    /**
     * This assertion exists because the fixture found a real bug.
     *
     * `UNIQUE(external_id)` stops two LINKS sharing an identifier; it does
     * nothing about two ERP RECORDS sharing one, which simply found the existing
     * link and updated it. Since the two disagreed, every run reported a change
     * and flagged it as a human edit — a permanent phantom conflict on a
     * customer nobody had touched.
     */
    const summary = await syncService.run({ mode: 'apply', startedByUserId: userId });

    const duplicates = await ErpSyncRecord.findAll({
      where: { sync_run_id: summary.runId, external_id: 'ERP-1001' },
    });

    expect(duplicates.length).toBe(2);

    const skipped = duplicates.filter((record) => record.outcome === 'skipped');

    expect(skipped.length).toBe(1);
    expect(skipped[0]!.reason).toMatch(/second ERP record claims this identifier/);

    // Exactly one link, and one customer, for that identifier.
    expect(await ErpLink.count({ where: { external_id: 'ERP-1001' } })).toBe(1);
  });

  it('REFUSES a concurrent run at the database (FR-048)', async () => {
    /**
     * A generated column plus a unique index, not an application check.
     *
     * An application check has a window between the read and the write, and the
     * failure it allows is two syncs interleaving their writes to the same
     * customers — the one outcome nobody could untangle afterwards.
     *
     * Started by inserting a `running` row directly rather than racing two real
     * runs, because a race is not deterministic and this asserts the constraint
     * rather than the timing.
     */
    await ErpSyncRun.create({
      adapter_key: simulatorAdapter.describe().key,
      mode: 'apply',
      state: 'running',
      started_at: new Date(),
    } as never);

    await expect(
      syncService.run({ mode: 'apply', startedByUserId: userId }),
    ).rejects.toBeInstanceOf(syncService.SyncAlreadyRunningError);
  });

  it('permits a new run once the previous one FINISHED', async () => {
    // The complement: the constraint is on running rows, not on the adapter.
    // Without this, a guard that refused every second run would pass above.
    await syncService.run({ mode: 'apply', startedByUserId: userId });

    const second = await syncService.run({ mode: 'apply', startedByUserId: userId });

    expect(second.state).toBe('completed');
    expect(await ErpSyncRun.count()).toBe(2);
  });

  it('an UNREACHABLE ERP fails visibly and changes nothing', async () => {
    setFailing(true);

    const summary = await syncService.run({ mode: 'apply', startedByUserId: userId });

    /**
     * Half a sync applied against an ERP that then vanished is worse than no
     * sync, because nobody knows how far it got. Here it failed before applying
     * anything, and the run SAYS SO — a silent no-op reporting success is the
     * shape of bug that gets believed.
     */
    expect(summary.state).toBe('failed');
    expect(summary.failureReason).toMatch(/unreachable/i);
    expect(summary.created).toBe(0);
    expect(await ErpLink.count()).toBe(0);

    // And the run row records the reason, so the administration screen can show
    // it rather than an unexplained absence of results.
    const run = await ErpSyncRun.findByPk(summary.runId);

    expect(run!.state).toBe('failed');
    expect(run!.failure_reason).toBeTruthy();
  });

  it('does not leave a `running` row behind after a failure', async () => {
    /**
     * Otherwise FR-048's guard would lock the adapter out permanently after one
     * ERP outage, and the only recovery would be somebody editing the database.
     */
    setFailing(true);

    await syncService.run({ mode: 'apply', startedByUserId: userId });

    setFailing(false);

    const recovered = await syncService.run({ mode: 'apply', startedByUserId: userId });

    expect(recovered.state).toBe('completed');
    expect(recovered.created).toBeGreaterThan(0);
  });

  it('pages through more records than one page holds (FR-045)', async () => {
    const summary = await syncService.run({ mode: 'apply', startedByUserId: userId });

    /**
     * The simulator's page size is smaller than its fixture, so a run that only
     * read the first page would create a handful rather than all of them. This
     * is what proves the loop advances.
     */
    expect(summary.created).toBeGreaterThan(5);

    const run = await ErpSyncRun.findByPk(summary.runId);

    // The cursor is null at the end, which is how the loop knows to stop.
    expect(run!.cursor).toBeNull();
  });
});
