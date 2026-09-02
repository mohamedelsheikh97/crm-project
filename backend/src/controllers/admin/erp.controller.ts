import type { NextFunction, Request, Response } from 'express';

import { conflict, notFound, unauthenticated } from '../../errors/app-error.js';
import * as registry from '../../erp/registry.js';
import { FIELD_OWNERSHIP } from '../../erp/field-ownership.js';
import { sequelize } from '../../config/database.js';
import {
  AUDIT_ACTIONS,
  auditContextFrom,
  record as recordAudit,
} from '../../services/audit.service.js';
import * as syncService from '../../services/erp-sync.service.js';

/**
 * ERP administration (Phase 11, US4, FR-039a, FR-044, FR-048, FR-049).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ACTIVE ADAPTER IS REPORTED, INCLUDING WHETHER IT IS SIMULATED.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * FR-039a's second half, and it is the quiet failure this phase can most easily
 * ship: a deployment serving simulated order data to an agent who believes it is
 * real. The screen works, the numbers are plausible, and the agent quotes them
 * to a customer. Every surface that shows this data says where it came from.
 */
export function describeAdapter(req: Request, res: Response, next: NextFunction): void {
  try {
    const info = registry.describe();

    res.status(200).json({
      adapter: info,
      /**
       * The ownership table, published to the screen.
       *
       * An administrator about to run a sync should be able to see which system
       * wins each field BEFORE they run it — that is the difference between an
       * informed decision and finding out afterwards. The defaults are a
       * placeholder pending T115, and the screen says so.
       */
      fieldOwnership: FIELD_OWNERSHIP,
    });
  } catch (error) {
    next(error);
  }
}

async function start(req: Request, res: Response, next: NextFunction, mode: 'preview' | 'apply') {
  try {
    if (!req.user) throw unauthenticated();

    const summary = await syncService.run({ mode, startedByUserId: req.user.id });

    await sequelize.transaction(async (transaction) => {
      await recordAudit(
        {
          action:
            summary.state === 'failed'
              ? AUDIT_ACTIONS.ERP_SYNC_FAILED
              : AUDIT_ACTIONS.ERP_SYNC_COMPLETED,
          actorUserId: req.user!.id,
          actorEmail: req.user!.email,
          targetType: 'erp_sync_run',
          targetId: summary.runId,
          metadata: {
            mode,
            created: summary.created,
            updated: summary.updated,
            skipped: summary.skipped,
            // The one an incident would look for: an ERP value replaced
            // something a person here had edited (FR-043).
            conflicts: summary.conflicts,
            failureReason: summary.failureReason,
          },
          ...auditContextFrom(req),
        },
        transaction,
      );
    });

    res.status(summary.state === 'failed' ? 502 : 200).json({
      runId: summary.runId,
      mode: summary.mode,
      state: summary.state,
      created: summary.created,
      updated: summary.updated,
      skipped: summary.skipped,
      conflicts: summary.conflicts,
      failureReason: summary.failureReason,
    });
  } catch (error) {
    if (error instanceof syncService.SyncAlreadyRunningError) {
      /**
       * 409, and refused rather than queued (FR-048).
       *
       * Two syncs interleaving their writes to the same customers is the one
       * outcome nobody could untangle afterwards, so the second is turned away
       * rather than made to wait — a queued run would start later against data
       * the first had already changed.
       */
      next(conflict(error.message));
      return;
    }

    next(error);
  }
}

/**
 * A dry run. WRITES NOTHING to customers (FR-044).
 *
 * It does record the run and its per-record classification, which is what makes
 * SC-017 checkable: the preview's decisions and the run's are two rows of the
 * same shape, so "the preview said X and the run did Y" is answerable after the
 * fact rather than from memory.
 */
export function preview(req: Request, res: Response, next: NextFunction): void {
  void start(req, res, next, 'preview');
}

export function apply(req: Request, res: Response, next: NextFunction): void {
  void start(req, res, next, 'apply');
}

/** Recent runs (FR-049), retained long enough to answer a later question. */
export async function listRuns(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const runs = await syncService.recentRuns();

    res.status(200).json({
      items: runs.map((run) => ({
        id: run.id,
        adapterKey: run.adapter_key,
        mode: run.mode,
        state: run.state,
        createdCount: run.created_count,
        updatedCount: run.updated_count,
        skippedCount: run.skipped_count,
        conflictCount: run.conflict_count,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        failureReason: run.failure_reason,
      })),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * What one run did to each record, and why.
 *
 * Every non-trivial outcome carries a reason (FR-046) — the natural
 * implementation logs "skipped: 47" and leaves the reader to guess, which is a
 * record an administrator cannot act on.
 */
export async function runDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) throw notFound();

    const records = await syncService.recordsFor(id);

    res.status(200).json({
      items: records.map((record) => ({
        id: record.id,
        externalId: record.external_id,
        customerId: record.customer_id,
        outcome: record.outcome,
        reason: record.reason,
        // Before and after, so the value that LOST is still readable — which is
        // what makes FR-043's "recorded and visible" true.
        changedFields: record.changed_fields,
      })),
    });
  } catch (error) {
    next(error);
  }
}
