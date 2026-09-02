import { col, fn, type WhereOptions } from 'sequelize';

import { figure, type Figure, type ResolvedPeriod } from '../reporting/figure.js';
import { describe as describeFilters, type ReportFilters } from '../reporting/filters.js';
import { bucketKey, bucketSizeFor } from '../reporting/period.js';
import * as sources from '../reporting/sources.js';
import { ACTIVE_STATUSES, PAUSED_STATUSES } from '../sla/clock.js';
import { TICKET_CATEGORIES } from '../tickets/taxonomy.js';
import { ALL_CHANNELS } from '../models/message.model.js';
import { TICKET_STATUSES } from '../tickets/lifecycle.js';

/**
 * Ticket volume and status reporting (Phase 10, US1, FR-015 - FR-019).
 *
 * READS ONLY THROUGH `reporting/sources.ts` (research D2). No table name appears
 * in this file, and no rule is restated: the classification of which statuses
 * count as unsettled comes from `sla/clock.ts`, the category and channel lists
 * from `tickets/taxonomy.ts` and the channel registry, and the status list from
 * `tickets/lifecycle.ts`.
 *
 * That is not fastidiousness. A reporting query that listed the four categories
 * itself would become a second definition of Phase 3's taxonomy — and when a
 * fifth category is added, the report would silently omit it while every total
 * still looked plausible.
 */

/**
 * Unsettled = the clock is running or stopped, but the work is not done.
 *
 * Composed from `sla/clock.ts`'s two lists rather than written as a literal.
 * Phase 6 already decided which statuses mean "not finished" — `escalated` is
 * deliberately NOT terminal there — and a report that disagreed would produce an
 * open-ticket count that contradicted the SLA screen.
 */
const UNSETTLED: readonly string[] = [...ACTIVE_STATUSES, ...PAUSED_STATUSES];

export interface VolumeReport {
  readonly received: Figure<number>;
  readonly openAtEnd: Figure<number>;
  readonly byStatus: Figure<Array<{ status: string; count: number }>>;
  readonly byCategory: Figure<Array<{ category: string; count: number }>>;
  readonly byChannel: Figure<Array<{ channel: string; count: number }>>;
  readonly overTime: Figure<Array<{ bucket: string; count: number }>>;
}

/** Counts by one column, with every declared bucket present even at zero. */
async function countBy(
  where: WhereOptions,
  column: string,
  declared: readonly string[],
): Promise<Array<{ key: string; count: number }>> {
  const rows = (await sources.models.Ticket.findAll({
    where,
    attributes: [column, [fn('COUNT', col('id')), 'n']],
    group: [column],
    raw: true,
  })) as unknown as Array<Record<string, unknown>>;

  const counted = new Map<string, number>();

  for (const row of rows) {
    const key = row[column];
    if (typeof key === 'string') counted.set(key, Number(row.n));
  }

  /**
   * EVERY DECLARED BUCKET IS PRESENT, INCLUDING ZEROES.
   *
   * A `GROUP BY` returns only the buckets that have rows, so a category nobody
   * used this month would be absent from the chart entirely — and a reader
   * would conclude it does not exist rather than that it was quiet. Zero is a
   * fact here; absence is a different claim.
   */
  return declared.map((key) => ({ key, count: counted.get(key) ?? 0 }));
}

export async function report(
  period: ResolvedPeriod,
  filters: ReportFilters,
): Promise<VolumeReport> {
  const described = describeFilters(filters);
  const build = <T>(
    value: T,
    count: number,
    total: number,
    excluded: Array<{ reason: string; count: number }> = [],
  ) => figure({ value, count, total, excluded }, period, described);

  const createdWhere = sources.ticketsCreatedIn(period, filters);

  const received = await sources.models.Ticket.count({ where: createdWhere });

  /**
   * FR-017: the merged side is excluded by `ticketsCreatedIn`, so `received`
   * counts a merged pair ONCE. Reporting how many were excluded keeps that
   * visible rather than making the total quietly smaller than the table
   * (FR-004).
   */
  const mergedInPeriod = await sources.models.Ticket.count({
    where: sources.mergedIn(period, filters),
  });

  /**
   * FR-016: a DIFFERENT question, and deliberately not filtered by creation
   * date. A ticket raised in March and still open in May is open at the end of
   * May; a query that filtered by creation would report "tickets created this
   * month that are still open", which is a much smaller and different number.
   */
  const openAtEnd = await sources.models.Ticket.count({
    where: sources.ticketsOpenAt(period, filters, UNSETTLED),
  });

  const byStatusRows = await countBy(createdWhere, 'status', TICKET_STATUSES);
  const byCategoryRows = await countBy(createdWhere, 'category', TICKET_CATEGORIES);
  const byChannelRows = await countBy(createdWhere, 'source', ALL_CHANNELS);

  const size = bucketSizeFor(period);

  const overTimeRows = (await sources.models.Ticket.findAll({
    where: createdWhere,
    attributes: ['created_at'],
    raw: true,
  })) as unknown as Array<{ created_at: Date | string }>;

  const buckets = new Map<string, number>();

  for (const row of overTimeRows) {
    const at = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
    const key = bucketKey(at, period, size);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  const overTime = [...buckets.entries()]
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));

  const mergedExclusion = mergedInPeriod > 0 ? [{ reason: 'merged', count: mergedInPeriod }] : [];

  return {
    received: build(received, received, received + mergedInPeriod, mergedExclusion),
    openAtEnd: build(openAtEnd, openAtEnd, openAtEnd),
    byStatus: build(
      byStatusRows.map((row) => ({ status: row.key, count: row.count })),
      received,
      received + mergedInPeriod,
      mergedExclusion,
    ),
    byCategory: build(
      byCategoryRows.map((row) => ({ category: row.key, count: row.count })),
      received,
      received + mergedInPeriod,
      mergedExclusion,
    ),
    byChannel: build(
      byChannelRows.map((row) => ({ channel: row.key, count: row.count })),
      received,
      received + mergedInPeriod,
      mergedExclusion,
    ),
    overTime: build(overTime, received, received + mergedInPeriod, mergedExclusion),
  };
}

/** Whether the system holds any ticket at all before this period ended (FR-014). */
export async function hasDataFor(period: ResolvedPeriod): Promise<boolean> {
  const anyBefore = await sources.models.Ticket.count({
    where: sources.anyTicketUpTo(period),
  });

  return anyBefore > 0;
}
