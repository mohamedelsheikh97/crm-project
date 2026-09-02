import { Op, type WhereOptions } from 'sequelize';

/**
 * Keyset paging for the published interface (Phase 11, FR-008, FR-009, SC-005,
 * research D2).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE EXISTING OFFSET PAGING COULD NOT SERVE THIS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `customer.service.ts` and `ticket.service.ts` both return
 * `{ items, page, pageSize, total }`. Insert a record while a client is paging
 * and every later page shifts by one: one record is read twice and one is never
 * read at all.
 *
 * For a screen that is harmless — a human re-reading a row corrupts nothing. For
 * a client synchronising into another system's database, a skipped record is a
 * customer that silently does not exist over there, and nothing will ever
 * correct it. FR-008 and SC-005 exist because of that asymmetry.
 *
 * Keyset paging over `(updated_at, id)` gives the guarantee, and it is the same
 * ordering FR-009's "changed since" needs, so one index serves both.
 *
 * `id` IS THE TIEBREAKER because MySQL `DATETIME` is second-precision and two
 * records updated in the same second would otherwise have no defined order —
 * the same reasoning `ticket.service.ts` already applies to its own sort.
 *
 * THE CURSOR IS OPAQUE so it is not mistaken for a stable identifier a client
 * can construct, which is how clients end up depending on internals. A
 * hand-built cursor is refused rather than interpreted.
 */

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export interface Cursor {
  /** The `updated_at` of the last record on the previous page. */
  readonly updatedAt: Date;
  /** Its id — the tiebreaker within the same second. */
  readonly id: number;
  /**
   * The `since` the cursor was issued under, or null.
   *
   * Carried so that pairing a cursor with a DIFFERENT `since` can be refused
   * rather than silently reinterpreted. Reinterpreting would produce a page
   * that is neither what the cursor described nor what the new `since` asks
   * for, and the client would have no way to tell.
   */
  readonly since: string | null;
}

export class InvalidCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCursorError';
  }
}

export class InvalidLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidLimitError';
  }
}

export function encodeCursor(cursor: Cursor): string {
  const payload = JSON.stringify({
    u: cursor.updatedAt.toISOString(),
    i: cursor.id,
    s: cursor.since,
  });

  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeCursor(value: unknown): Cursor {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidCursorError('cursor must be a non-empty string');
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError('cursor is not a cursor this system issued');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new InvalidCursorError('cursor is not a cursor this system issued');
  }

  const { u, i, s } = parsed as { u?: unknown; i?: unknown; s?: unknown };

  if (typeof u !== 'string' || typeof i !== 'number' || !Number.isInteger(i)) {
    throw new InvalidCursorError('cursor is not a cursor this system issued');
  }

  const updatedAt = new Date(u);

  if (Number.isNaN(updatedAt.getTime())) {
    throw new InvalidCursorError('cursor is not a cursor this system issued');
  }

  return {
    updatedAt,
    id: i,
    since: typeof s === 'string' ? s : null,
  };
}

/** 1 to MAX_LIMIT. A malformed value is refused rather than clamped silently. */
export function resolveLimit(value: unknown): number {
  if (value === undefined || value === null || value === '') return DEFAULT_LIMIT;

  const limit = Number(value);

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new InvalidLimitError(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }

  return limit;
}

/** An RFC 3339 instant, or null. A malformed value is refused, never ignored. */
export function resolveSince(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') return null;

  if (typeof value !== 'string') {
    throw new InvalidCursorError('since must be an RFC 3339 timestamp');
  }

  const at = new Date(value);

  if (Number.isNaN(at.getTime())) {
    throw new InvalidCursorError('since must be an RFC 3339 timestamp');
  }

  /**
   * A future `since` is refused rather than answered with an empty page.
   *
   * An empty page reads as "nothing has changed", which a client would believe.
   * A refusal tells them their clock or their bookkeeping is wrong, which is
   * what actually happened.
   */
  if (at.getTime() > Date.now() + 60_000) {
    throw new InvalidCursorError('since is in the future');
  }

  return at;
}

export interface KeysetQuery {
  readonly limit: number;
  readonly since: Date | null;
  readonly cursor: Cursor | null;
}

/**
 * Reads the three paging parameters together, because they constrain each other.
 *
 * Pairing a cursor with a different `since` than it was issued under is refused
 * here rather than in each controller — one place to get it right.
 */
export function parseKeyset(query: Record<string, unknown>): KeysetQuery {
  const limit = resolveLimit(query.limit);
  const since = resolveSince(query.since);
  const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor);

  if (cursor !== null) {
    const requested = since === null ? null : since.toISOString();

    if (cursor.since !== requested) {
      throw new InvalidCursorError(
        'cursor was issued for a different `since`; start again without a cursor',
      );
    }
  }

  return { limit, since, cursor };
}

/**
 * The `where` clause: `updated_at >= since AND (updated_at, id) > (cursor)`.
 *
 * Written as the expanded tuple comparison rather than MySQL's row-value syntax
 * because Sequelize cannot express the latter portably, and because the expanded
 * form is what the `(updated_at, id)` index serves.
 */
export function keysetWhere(query: KeysetQuery, base: WhereOptions = {}): WhereOptions {
  const clauses: WhereOptions[] = [base];

  if (query.since !== null) {
    // Inclusive, and the published contract says so. An exclusive bound can skip
    // a record written in the same second as the boundary; an inclusive one
    // re-delivers the boundary record, which is idempotent to re-process.
    clauses.push({ updated_at: { [Op.gte]: query.since } } as WhereOptions);
  }

  if (query.cursor !== null) {
    const { updatedAt, id } = query.cursor;

    clauses.push({
      [Op.or]: [
        { updated_at: { [Op.gt]: updatedAt } },
        { updated_at: updatedAt, id: { [Op.gt]: id } },
      ],
    } as WhereOptions);
  }

  return { [Op.and]: clauses } as WhereOptions;
}

/** The only ordering the published interface uses. Matches the index exactly. */
export const KEYSET_ORDER: ReadonlyArray<readonly [string, 'ASC']> = [
  ['updated_at', 'ASC'],
  ['id', 'ASC'],
];

export interface Page<T> {
  readonly data: T[];
  readonly paging: {
    readonly next_cursor: string | null;
    readonly has_more: boolean;
  };
}

/**
 * Builds the response envelope from an already-sliced page plus its `hasMore`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `hasMore` IS PASSED IN, NOT INFERRED FROM THE ROW COUNT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The service reads one row more than asked for and reports whether it got it.
 * An earlier version of this function took the unsliced rows and did the
 * trimming itself, which forced any caller whose service had already trimmed to
 * re-add a row purely to signal "there is more" — a seam that works and reads as
 * a mistake, and that somebody would eventually get wrong.
 *
 * The extra-row probe (rather than a `COUNT`) is why paging costs no additional
 * query, and why a short page is never mistaken for the last page. The published
 * contract tells clients not to infer the end from a short page for exactly that
 * reason.
 */
export function toPage<T extends { id: number; updated_at: Date }>(
  page: ReadonlyArray<T>,
  hasMore: boolean,
  query: KeysetQuery,
  present: (row: T) => unknown,
): Page<unknown> {
  const last = page[page.length - 1];

  return {
    data: page.map(present),
    paging: {
      next_cursor:
        hasMore && last
          ? encodeCursor({
              updatedAt:
                last.updated_at instanceof Date ? last.updated_at : new Date(last.updated_at),
              id: last.id,
              since: query.since === null ? null : query.since.toISOString(),
            })
          : null,
      has_more: hasMore,
    },
  };
}

/** What to pass to `findAll`: the limit plus the probe row `toPage` consumes. */
export function fetchLimit(query: KeysetQuery): number {
  return query.limit + 1;
}
