import { UniqueConstraintError } from 'sequelize';

import { sequelize } from '../config/database.js';
import * as registry from '../erp/registry.js';
import { ownerOf, SYNCABLE_FIELDS } from '../erp/field-ownership.js';
import { ErpUnavailableError, type ErpCustomer } from '../erp/types.js';
import { Customer } from '../models/customer.model.js';
import { ErpLink } from '../models/erp-link.model.js';
import { ErpSyncRecord, type ChangedField } from '../models/erp-sync-record.model.js';
import { ErpSyncRun, type SyncMode } from '../models/erp-sync-run.model.js';
import { normaliseContact } from '../lib/phone.js';

/**
 * ERP customer synchronisation (Phase 11, US4, FR-039 - FR-051, research D12).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ONE FAILURE THAT MATTERS MOST: OVERWRITING WHAT A PERSON TYPED.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A failed sync is visible. A SUCCESSFUL one that silently replaced an agent's
 * correction is not: every screen works, the data is plausible, and the
 * correction is gone. FR-043 forbids it, and `erp_links.last_synced_values` is
 * how it is detected — the values the sync last wrote. Current equals
 * last-written means nobody touched it; current differs means somebody did.
 *
 * Research D12 records why the two obvious alternatives are worse:
 * `customers.updated_at` is too coarse to be per-field, and reading the audit
 * log makes correctness depend on retention, so pruning the log would start
 * silently overwriting agents' work.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PREVIEW AND APPLY ARE ONE CODE PATH.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * SC-017 requires a preview to report the same set the run applies. Two code
 * paths would agree on the day they were written; one path with a `mode` flag
 * agrees by construction. A preview that disagreed with the run would be worse
 * than no preview, because it was trusted.
 */

export interface SyncSummary {
  readonly runId: number;
  readonly mode: SyncMode;
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly conflicts: number;
  readonly state: 'completed' | 'failed';
  readonly failureReason: string | null;
}

export class SyncAlreadyRunningError extends Error {
  constructor() {
    super('a synchronisation is already running for this adapter');
    this.name = 'SyncAlreadyRunningError';
  }
}

/**
 * How each syncable CRM column is derived from an ERP record.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ONE DERIVATION PER FIELD, USED BY BOTH CLASSIFY AND APPLY.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This started as a plain field-name map, with the awkward cases handled inline
 * in the create path. That produced a whole family of the same bug: `company` is
 * only set for a customer of type `company`, the create path knew that and
 * `classify` did not, so for an INDIVIDUAL the two disagreed about what the
 * incoming value was — and every subsequent run reported a change that did not
 * exist.
 *
 * Two computations of "what should this field be" is the same failure FR-007
 * warns about between phases, in miniature. One function, called from both
 * places, makes them agree by construction.
 */
const DERIVE: Readonly<Record<string, (erp: ErpCustomer) => unknown>> = {
  display_name: (erp) => erp.displayName,
  /**
   * A company name only for a company.
   *
   * An individual has no company, and writing their own name into the field
   * would make every individual look like a one-person business in every list
   * that groups by it.
   */
  company: (erp) => (erp.type === 'company' ? erp.displayName : null),
  address: (erp) => erp.addressLine,

  // Declared because the ownership table names them, and skipped by
  // CUSTOMER_COLUMNS below because they are not columns on `customers`.
  tax_id: (erp) => erp.taxId,
  email: (erp) => erp.email,
  phone: (erp) => erp.phone,
};

/**
 * Columns that exist on `customers`. The rest are contact rows, which this
 * phase does not write.
 *
 * `email` and `phone` are contacts in this schema, not columns — so they are
 * declared in the ownership table (they are fields a sync COULD own) and
 * skipped here with a stated reason rather than silently. Widening the sync to
 * write contact rows is a deliberate change, not an oversight to be filled in.
 */
const CUSTOMER_COLUMNS = new Set(['display_name', 'company', 'address']);

function valueFor(erp: ErpCustomer, field: string): unknown {
  const derive = DERIVE[field];

  return derive ? (derive(erp) ?? null) : null;
}

/**
 * Applies this system's own validation to an ERP value (FR-047).
 *
 * A value this system would reject from a person is rejected from the ERP too.
 * Returns a reason, or null when acceptable.
 */
function rejectionReason(erp: ErpCustomer): string | null {
  if (!erp.displayName || erp.displayName.trim() === '') {
    return 'displayName is empty';
  }

  if (erp.email !== null && erp.email.trim() !== '') {
    // The same normaliser identity resolution uses, so "valid" means the same
    // thing on both paths rather than being decided twice.
    const normalised = normaliseContact('email', erp.email);

    if (!normalised || !normalised.includes('@') || normalised.startsWith('@')) {
      return `email "${erp.email}" is not an address this system would accept`;
    }
  }

  return null;
}

interface Classification {
  readonly outcome: 'created' | 'updated' | 'skipped' | 'conflict';
  readonly reason: string | null;
  readonly changed: ChangedField[];
  /** Only for `updated`/`conflict`: what to write when applying. */
  readonly writes: Record<string, unknown>;
}

/**
 * Decides what would happen to one ERP record, WITHOUT writing.
 *
 * Shared by preview and apply, which is what makes SC-017 true by construction.
 */
async function classify(erp: ErpCustomer, adapterKey: string): Promise<Classification> {
  const rejected = rejectionReason(erp);

  if (rejected) {
    return { outcome: 'skipped', reason: rejected, changed: [], writes: {} };
  }

  const link = await ErpLink.findOne({
    where: { external_id: erp.externalId, adapter_key: adapterKey },
  });

  if (!link) {
    return { outcome: 'created', reason: null, changed: [], writes: {} };
  }

  const customer = await Customer.findByPk(link.customer_id);

  if (!customer) {
    return {
      outcome: 'skipped',
      // The link survives a deleted customer via SET NULL elsewhere; here it
      // means the row is gone and re-creating it would resurrect something
      // somebody removed.
      reason: 'the linked customer no longer exists',
      changed: [],
      writes: {},
    };
  }

  const changed: ChangedField[] = [];
  const writes: Record<string, unknown> = {};
  let sawConflict = false;

  for (const field of SYNCABLE_FIELDS) {
    if (!CUSTOMER_COLUMNS.has(field)) continue;

    const incoming = valueFor(erp, field);
    const current = (customer as unknown as Record<string, unknown>)[field] ?? null;
    const lastWritten = link.last_synced_values[field] ?? null;

    if (incoming === current) continue;

    /**
     * THE HUMAN-EDIT TEST.
     *
     * If the current value differs from what the sync last wrote, a person
     * changed it. That is exact for the question being asked, needs no history,
     * and survives audit pruning.
     */
    const humanEdited = current !== lastWritten;
    const owner = ownerOf(field);

    if (humanEdited && owner === 'crm') {
      /**
       * The CRM owns it and a person edited it: the ERP value LOSES, and the
       * fact is recorded so the run's history shows what was declined.
       */
      changed.push({ field, from: current, to: incoming, wasHumanEdit: true });
      sawConflict = true;
      continue;
    }

    if (humanEdited && owner === 'erp') {
      /**
       * The ERP owns it and a person edited it anyway: the ERP value WINS, and
       * FR-043's "recorded and visible" applies — the value that lost stays
       * readable in `changed_fields`.
       */
      changed.push({ field, from: current, to: incoming, wasHumanEdit: true });
      writes[field] = incoming;
      sawConflict = true;
      continue;
    }

    // Nobody touched it. An ordinary update.
    changed.push({ field, from: current, to: incoming, wasHumanEdit: false });

    if (owner === 'erp') writes[field] = incoming;
  }

  if (changed.length === 0) {
    return { outcome: 'skipped', reason: 'no change', changed: [], writes: {} };
  }

  return {
    outcome: sawConflict ? 'conflict' : 'updated',
    reason: sawConflict ? 'a value edited in this system was involved' : null,
    changed,
    writes,
  };
}

/**
 * Runs a synchronisation.
 *
 * `mode: 'preview'` writes NOTHING to customers — only the run and its per-record
 * classification, so an administrator can read what would happen and so
 * SC-017's comparison has two rows of the same shape to compare.
 *
 * IDEMPOTENT PER RECORD. Application is an upsert keyed on the external
 * identifier, so re-applying is a no-op and a retry is correct regardless of
 * where it resumes (FR-045). The stored cursor only saves work — which is the
 * right way round, because a position that is merely an optimisation cannot
 * corrupt anything by being slightly wrong.
 */
export async function run(options: {
  readonly mode: SyncMode;
  readonly startedByUserId: number;
  readonly limit?: number;
}): Promise<SyncSummary> {
  const erp = registry.adapter();
  const adapterKey = erp.describe().key;

  let runRow: ErpSyncRun;

  try {
    /**
     * FR-048's concurrency guard is the DATABASE's, via a generated column and
     * a unique index. An application check would have a window between the read
     * and the write, and the failure it allows is two syncs interleaving their
     * writes to the same customers — the one outcome nobody could untangle.
     */
    runRow = await ErpSyncRun.create({
      adapter_key: adapterKey,
      mode: options.mode,
      state: 'running',
      started_by_user_id: options.startedByUserId,
      started_at: new Date(),
    } as never);
  } catch (error) {
    /**
     * DETECTED BY THE ERROR CLASS, not by matching its message.
     *
     * The first version tested the message against /duplicate|unique/, and
     * Sequelize reports a unique-constraint violation with the message
     * "Validation error" — so the guard never fired and the caller saw a raw
     * database error instead of the 409 FR-048 asks for. Matching on a message
     * is matching on something the library is free to reword.
     */
    if (error instanceof UniqueConstraintError) throw new SyncAlreadyRunningError();

    throw error;
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let conflicts = 0;

  /**
   * External identifiers already seen in THIS run (FR-041).
   *
   * ═══════════════════════════════════════════════════════════════════════
   * `UNIQUE(external_id)` DOES NOT CATCH THIS, AND THE FIXTURE PROVED IT.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * The unique index stops two LINKS claiming one identifier. It does nothing
   * about two ERP RECORDS claiming one: the second simply finds the existing
   * link and updates it.
   *
   * That is worse than it sounds. The two records disagree, so each run writes
   * one set of values and the next run sees the other — an endless ping-pong
   * where every run reports a change and, because the current value never
   * matches what the sync last wrote, flags it as a HUMAN EDIT. An
   * administrator would see a permanent conflict on a customer nobody had
   * touched, and the real human edits would be lost in the noise.
   *
   * So a repeat within a run is skipped with a reason. Two ERP records sharing
   * an identifier is a data problem in the ERP, and the honest response is to
   * report it rather than let them overwrite each other forever.
   */
  const seen = new Set<string>();

  try {
    /**
     * NORMALISED TO NULL, AND THE `?? null` IS LOAD-BEARING.
     *
     * `ErpSyncRun.create` returns `undefined` for a column it did not write,
     * not the database's NULL default. A bare assignment therefore handed the
     * adapter `undefined`; its `cursor === null` check fell through to
     * `Number(undefined)`, which is NaN, and the page came back EMPTY.
     *
     * The run then reported SUCCESS having processed nothing — which is the
     * worst shape of bug this phase can have. A sync that fails is investigated.
     * A sync that says it worked and did not is believed.
     */
    let cursor: string | null = runRow.cursor ?? null;
    const limit = options.limit ?? 100;

    for (;;) {
      // `ErpUnavailableError` propagates from here and fails the run — that is
      // genuinely page-level. Per-record failures arrive in `page.invalid`.
      const page = await erp.listCustomers({ since: null, cursor, limit });

      /**
       * Rows the adapter could not produce (FR-046).
       *
       * Recorded as skips with their reasons, and the run CONTINUES — one bad
       * row must not stop the other 9,999. An earlier design had the adapter
       * throw for these, which abandoned the whole page and defeated the
       * requirement; `erp/types.ts` records the correction.
       */
      for (const bad of page.invalid) {
        await ErpSyncRecord.create({
          sync_run_id: runRow.id,
          external_id: bad.externalId,
          outcome: 'skipped',
          reason: bad.reason.slice(0, 255),
        } as never);

        skipped += 1;
      }

      for (const record of page.items) {
        if (seen.has(record.externalId)) {
          await ErpSyncRecord.create({
            sync_run_id: runRow.id,
            external_id: record.externalId,
            outcome: 'skipped',
            reason:
              'a second ERP record claims this identifier; the first one in this run was applied',
          } as never);

          skipped += 1;
          continue;
        }

        seen.add(record.externalId);

        const decision = await classify(record, adapterKey);

        if (options.mode === 'apply') {
          await applyDecision(record, decision, adapterKey, runRow.id);
        } else {
          await ErpSyncRecord.create({
            sync_run_id: runRow.id,
            external_id: record.externalId,
            outcome: decision.outcome,
            reason: decision.reason,
            changed_fields: decision.changed.length > 0 ? decision.changed : null,
          } as never);
        }

        if (decision.outcome === 'created') created += 1;
        else if (decision.outcome === 'updated') updated += 1;
        else if (decision.outcome === 'conflict') conflicts += 1;
        else skipped += 1;
      }

      cursor = page.nextCursor;

      // The position is stored so a retry resumes rather than restarts. It is
      // an optimisation, not a correctness requirement — see the header.
      await runRow.update({ cursor });

      if (cursor === null) break;
    }

    await runRow.update({
      state: 'completed',
      finished_at: new Date(),
      created_count: created,
      updated_count: updated,
      skipped_count: skipped,
      conflict_count: conflicts,
    });

    return {
      runId: runRow.id,
      mode: options.mode,
      created,
      updated,
      skipped,
      conflicts,
      state: 'completed',
      failureReason: null,
    };
  } catch (error) {
    /**
     * The ERP went away, or something unclassified happened.
     *
     * THE RUN FAILS AND CHANGES NOTHING FURTHER. Half a sync applied against an
     * ERP that then vanished is worse than no sync, because nobody knows how far
     * it got — so the run is marked failed with a reason, and what it had
     * already applied is recorded per record rather than rolled back. That is
     * the honest state: those customers really were updated.
     */
    const reason =
      error instanceof ErpUnavailableError
        ? `the ERP was unreachable: ${error.message}`
        : error instanceof Error
          ? error.message
          : 'the run failed';

    await runRow.update({
      state: 'failed',
      finished_at: new Date(),
      failure_reason: reason.slice(0, 255),
      created_count: created,
      updated_count: updated,
      skipped_count: skipped,
      conflict_count: conflicts,
    });

    return {
      runId: runRow.id,
      mode: options.mode,
      created,
      updated,
      skipped,
      conflicts,
      state: 'failed',
      failureReason: reason,
    };
  }
}

/** Writes one decision. Only called in `apply` mode. */
async function applyDecision(
  erp: ErpCustomer,
  decision: Classification,
  adapterKey: string,
  runId: number,
): Promise<void> {
  await sequelize.transaction(async (transaction) => {
    if (decision.outcome === 'skipped') {
      await ErpSyncRecord.create(
        {
          sync_run_id: runId,
          external_id: erp.externalId,
          outcome: 'skipped',
          reason: decision.reason,
        } as never,
        { transaction },
      );

      return;
    }

    if (decision.outcome === 'created') {
      /**
       * The row AND the snapshot, both from `valueFor` — so the create path
       * cannot disagree with `classify` about what the incoming value is. That
       * disagreement was a real bug: see the note on `DERIVE`.
       */
      const written: Record<string, unknown> = {};

      for (const field of SYNCABLE_FIELDS) {
        if (CUSTOMER_COLUMNS.has(field)) written[field] = valueFor(erp, field);
      }

      const customer = await Customer.create(
        {
          ...written,
          is_active: true,
          is_provisional: false,
        } as never,
        { transaction },
      );

      /**
       * `isArchived` does NOT deactivate (FR-050).
       *
       * A customer archived in the ERP is created active here and the fact is
       * recorded, because deactivation in this system has consequences — portal
       * access, ticket routing — that the ERP does not know about.
       */
      const snapshot: Record<string, unknown> = {};

      for (const field of SYNCABLE_FIELDS) {
        if (CUSTOMER_COLUMNS.has(field)) snapshot[field] = written[field] ?? null;
      }

      await ErpLink.create(
        {
          customer_id: customer.id,
          external_id: erp.externalId,
          adapter_key: adapterKey,
          last_reconciled_at: new Date(),
          last_synced_values: snapshot,
        } as never,
        { transaction },
      );

      await ErpSyncRecord.create(
        {
          sync_run_id: runId,
          external_id: erp.externalId,
          customer_id: customer.id,
          outcome: 'created',
          reason: erp.isArchived ? 'created; archived in the ERP but not deactivated here' : null,
        } as never,
        { transaction },
      );

      return;
    }

    const link = await ErpLink.findOne({
      where: { external_id: erp.externalId, adapter_key: adapterKey },
      transaction,
    });

    if (!link) return;

    if (Object.keys(decision.writes).length > 0) {
      await Customer.update(decision.writes, { where: { id: link.customer_id }, transaction });
    }

    /**
     * The snapshot records what the sync WROTE, not what the ERP said.
     *
     * A field the ERP offered and the ownership rule declined must not enter the
     * snapshot — otherwise the next run would see current-equals-last-written
     * and conclude nobody had edited it, quietly reversing the protection this
     * whole mechanism exists for.
     */
    const snapshot = { ...link.last_synced_values };

    for (const field of Object.keys(decision.writes)) {
      snapshot[field] = decision.writes[field];
    }

    await link.update(
      { last_synced_values: snapshot, last_reconciled_at: new Date() },
      { transaction },
    );

    await ErpSyncRecord.create(
      {
        sync_run_id: runId,
        external_id: erp.externalId,
        customer_id: link.customer_id,
        outcome: decision.outcome,
        reason: decision.reason,
        changed_fields: decision.changed,
      } as never,
      { transaction },
    );
  });
}

/** Recent runs, for the administration screen (FR-049). */
export async function recentRuns(limit = 20): Promise<ErpSyncRun[]> {
  return ErpSyncRun.findAll({ order: [['created_at', 'DESC']], limit });
}

export async function recordsFor(runId: number): Promise<ErpSyncRecord[]> {
  return ErpSyncRecord.findAll({
    where: { sync_run_id: runId },
    order: [['id', 'ASC']],
    limit: 500,
  });
}
