export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_CREDENTIALS'
  | 'UNAUTHENTICATED'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DUPLICATE_CUSTOMER'
  | 'TICKET_CLOSED'
  | 'TICKET_MERGED'
  | 'TRANSITION_NOT_ALLOWED'
  | 'CUSTOMER_INACTIVE'
  // Phase 4 — Agent Dashboard.
  | 'MENTION_NOT_VISIBLE'
  | 'MENTION_LIMIT'
  | 'TEMPLATE_LANGUAGE_REQUIRED'
  | 'TEMPLATE_RETIRED'
  | 'INTERNAL_ERROR';

export interface ErrorDetail {
  field: string;
  message: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ErrorDetail[];

  constructor(code: ErrorCode, status: number, message: string, details: ErrorDetail[] = []) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function validationError(details: ErrorDetail[]): AppError {
  return new AppError('VALIDATION_ERROR', 400, 'The request payload is invalid.', details);
}

/**
 * Fixed here rather than at each call site on purpose: wrong password, unknown
 * account, locked account, and inactive account must produce byte-identical
 * responses, or the API leaks which accounts exist (FR-030, quickstart V5).
 */
export function invalidCredentials(): AppError {
  return new AppError('INVALID_CREDENTIALS', 401, 'Email or password is incorrect.');
}

/**
 * Also returned for a deactivated user. A deactivated user is not
 * "authenticated but forbidden" — their session is void, and a 403 would
 * confirm a valid session existed (contracts/authorization.md).
 */
export function unauthenticated(): AppError {
  return new AppError('UNAUTHENTICATED', 401, 'Authentication is required.');
}

export function passwordChangeRequired(): AppError {
  return new AppError(
    'PASSWORD_CHANGE_REQUIRED',
    403,
    'You must set a new password before continuing.',
  );
}

/**
 * Returned regardless of whether the target exists — deciding permission before
 * existence is what stops the status code leaking (FR-019).
 */
export function forbidden(): AppError {
  return new AppError('FORBIDDEN', 403, 'You do not have permission to perform this action.');
}

export function notFound(): AppError {
  return new AppError('NOT_FOUND', 404, 'The requested resource was not found.');
}

export function conflict(message: string, details: ErrorDetail[] = []): AppError {
  return new AppError('CONFLICT', 409, message, details);
}

/** The optimistic-locking failure (research.md D11). */
export function staleRecord(): AppError {
  return conflict('This record changed since you loaded it. Reload and try again.');
}

/**
 * A save that would introduce a duplicate customer.
 *
 * The matches travel on the error itself so the handler can serialise them as
 * a SIBLING of the error envelope, never inside details[] — that field is
 * {field, message} pairs with a defined meaning, and a customer summary does
 * not fit it (research.md D5).
 *
 * This is a QUESTION, not a refusal (FR-023). Resubmitting with
 * acknowledgeDuplicates succeeds and records the decision.
 */
export class DuplicateCustomerError extends AppError {
  readonly duplicates: unknown[];

  constructor(duplicates: unknown[]) {
    super(
      'DUPLICATE_CUSTOMER',
      409,
      'One or more contact details already belong to an existing customer.',
    );
    this.name = 'DuplicateCustomerError';
    this.duplicates = duplicates;
  }
}

export function duplicateCustomer(duplicates: unknown[]): DuplicateCustomerError {
  return new DuplicateCustomerError(duplicates);
}

/**
 * Phase 3 refusals that carry structure a caller must act on.
 *
 * `details` is {field, message} pairs with a defined meaning, and a reachable
 * status set does not fit it. So these travel as a SIBLING of the error
 * envelope, exactly as Phase 2 established with `duplicates` (research.md D5).
 * contracts/ticket-api.md describes them as `details.*`; this is the same data
 * in the place the existing envelope has room for it.
 */
export class TransitionNotAllowedError extends AppError {
  readonly transition: { from: string; to: string; allowed: string[] };

  constructor(from: string, to: string, allowed: string[]) {
    super('TRANSITION_NOT_ALLOWED', 422, `A ticket in status '${from}' cannot move to '${to}'.`);
    this.name = 'TransitionNotAllowedError';
    this.transition = { from, to, allowed };
  }
}

/**
 * A refusal that names nothing leaves the user guessing. `allowed` is the
 * reachable set AFTER permission filtering, so the message never offers a move
 * the caller could not make (FR-017).
 */
export function transitionNotAllowed(
  from: string,
  to: string,
  allowed: string[],
): TransitionNotAllowedError {
  return new TransitionNotAllowedError(from, to, allowed);
}

/** Every workable action on a merged ticket is refused, and says where to go. */
export class TicketMergedError extends AppError {
  readonly merged: { survivorId: number; survivorReference: string };

  constructor(survivorId: number, survivorReference: string) {
    super(
      'TICKET_MERGED',
      422,
      `This ticket was merged into ${survivorReference} and can no longer be worked on.`,
    );
    this.name = 'TicketMergedError';
    this.merged = { survivorId, survivorReference };
  }
}

export function ticketMerged(survivorId: number, survivorReference: string): TicketMergedError {
  return new TicketMergedError(survivorId, survivorReference);
}

/** Editing a closed ticket (FR-009). Reopening is the way back, not an edit. */
export function ticketClosed(): AppError {
  return new AppError(
    'TICKET_CLOSED',
    422,
    'This ticket is closed. Reopen it before making changes.',
  );
}

/** Creating a ticket against a deactivated customer (FR-007). */
export function customerInactive(): AppError {
  return new AppError(
    'CUSTOMER_INACTIVE',
    422,
    'This customer is deactivated and cannot have new tickets raised against them.',
  );
}

/**
 * A note named someone who cannot open the ticket (Phase 4, FR-037).
 *
 * Refused at COMPOSITION time rather than accepted-and-silently-dropped. The
 * alternative leaves the author believing they asked a colleague for help who
 * was never told — the worst possible outcome for a collaboration feature.
 *
 * `mentions` rides BESIDE the envelope, not inside `details`, for the reason
 * Phase 2 established with `duplicates`: `{field, message}` has a defined
 * meaning that a list of user summaries does not fit.
 */
export interface MentionSummary {
  id: number;
  fullName: string;
  isActive: boolean;
}

export class MentionNotVisibleError extends AppError {
  readonly mentions: MentionSummary[];

  constructor(mentions: MentionSummary[]) {
    super('MENTION_NOT_VISIBLE', 400, 'One or more mentioned users cannot view this ticket.');
    this.name = 'MentionNotVisibleError';
    this.mentions = mentions;
  }
}

export function mentionNotVisible(mentions: MentionSummary[]): MentionNotVisibleError {
  return new MentionNotVisibleError(mentions);
}

/** More people named in one note than the limit allows (FR-038). */
export function mentionLimit(limit: number): AppError {
  return new AppError('MENTION_LIMIT', 400, `A note may mention at most ${limit} people.`, [
    { field: 'body', message: `ticketNote.error.mentionLimit:${limit}` },
  ]);
}

/**
 * A template with neither a complete English nor a complete Arabic pair
 * (Phase 4, FR-070). Validated here rather than in the schema so the message
 * can say which half is missing.
 */
export function templateLanguageRequired(details: ErrorDetail[] = []): AppError {
  return new AppError(
    'TEMPLATE_LANGUAGE_REQUIRED',
    400,
    'A template needs a title and body in at least one language.',
    details,
  );
}

/** Retired templates leave the picker; they do not come back through the API. */
export function templateRetired(): AppError {
  return new AppError('TEMPLATE_RETIRED', 409, 'This template has been retired.');
}
