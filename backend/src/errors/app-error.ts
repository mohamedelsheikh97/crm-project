export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_CREDENTIALS'
  | 'UNAUTHENTICATED'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
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
