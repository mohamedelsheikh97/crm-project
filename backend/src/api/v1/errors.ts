import type { Response } from 'express';

import { AppError, TicketMergedError } from '../../errors/app-error.js';
import { InvalidCursorError, InvalidLimitError } from '../paging.js';
import { InvalidFilterError } from '../../reporting/filters.js';
import { InvalidPeriodError } from '../../reporting/period.js';

/**
 * The published error envelope (Phase 11, FR-007).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SAME SHAPE THE INTERNAL INTERFACE USES. NOT A SECOND CONVENTION.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `{ error: { code, message, details } }` — identical to what
 * `middleware/error-handler.ts` produces for the screens, and the codes are the
 * same codes. That is deliberate rather than lazy: two error conventions in one
 * codebase means every client library, log parser and support runbook has to
 * know which surface it is looking at.
 *
 * `code` IS THE CONTRACT. `message` is for a human reading a log, and its
 * wording may change without a version bump — the published contract says so, so
 * a client branching on message text has been warned.
 *
 * THE MESSAGE IS ENGLISH REGARDLESS OF `Accept-Language`, and that is not a
 * Principle I violation. Principle I governs UI components and text in
 * templates. A machine consumer has no language, and making an integration's
 * behaviour depend on a header would be worse than a fixed one. The plan's
 * Constitution Check records this on the record rather than leaving it to be
 * challenged later.
 */
export interface PublishedErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details: ReadonlyArray<{ readonly field?: string; readonly message: string }>;
  };
}

export function send(
  res: Response,
  status: number,
  code: string,
  message: string,
  details: ReadonlyArray<{ field?: string; message: string }> = [],
): void {
  res.status(status).json({ error: { code, message, details } } satisfies PublishedErrorBody);
}

/**
 * `404` DELIBERATELY CONFLATES "does not exist" WITH "not yours".
 *
 * Distinguishing them would let a client walk identifiers to learn which records
 * exist outside its reach — which is a disclosure even when no field is
 * returned. Phase 10 made the same call for its agent report, and Phase 8 made
 * it for portal ticket visibility.
 */
export function notFound(res: Response): void {
  send(res, 404, 'NOT_FOUND', 'Not found.');
}

/**
 * Maps a thrown error to the published envelope.
 *
 * Returns `true` when it handled the error, so a controller reads
 * `if (handled(error, res)) return;` — the same shape Phase 10's
 * `badRequest(error, res)` established.
 *
 * WHAT IT DOES NOT HANDLE: anything unrecognised. That falls through to
 * `next(error)` and the global handler, which answers `500` with no detail and
 * no stack trace. Guessing at an unknown error's meaning here is how an
 * internal message ends up in a published response.
 */
export function handled(error: unknown, res: Response): boolean {
  if (error instanceof InvalidCursorError || error instanceof InvalidLimitError) {
    send(res, 400, 'VALIDATION_ERROR', error.message, [
      { field: 'paging', message: error.message },
    ]);
    return true;
  }

  if (error instanceof InvalidPeriodError) {
    send(res, 400, 'VALIDATION_ERROR', error.reason, [{ field: 'period', message: error.reason }]);
    return true;
  }

  if (error instanceof InvalidFilterError) {
    send(res, 400, 'VALIDATION_ERROR', error.message, [
      { field: 'filter', message: error.message },
    ]);
    return true;
  }

  /**
   * A merged ticket answers 409 with the survivor, not 404 and not a copy.
   *
   * The error already carries the survivor because the SCREENS need it — an
   * agent following a stale link must land somewhere. Reusing it here is what
   * keeps the two surfaces telling the same story about a merge (FR-010).
   */
  if (error instanceof TicketMergedError) {
    send(res, 409, 'CONFLICT', 'This ticket was merged into another.', [
      { field: 'merged_into_ticket_id', message: String(error.merged.survivorId) },
      { field: 'merged_into_reference', message: error.merged.survivorReference },
    ]);
    return true;
  }

  if (error instanceof AppError && error.code === 'NOT_FOUND') {
    notFound(res);
    return true;
  }

  return false;
}
