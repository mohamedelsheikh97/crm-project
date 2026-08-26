export type ErrorCode =
  'VALIDATION_ERROR' | 'INVALID_CREDENTIALS' | 'UNAUTHENTICATED' | 'NOT_FOUND' | 'INTERNAL_ERROR';

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
 * Fixed here rather than at each call site on purpose: the "no such user" and
 * "wrong password" paths must produce byte-identical responses, or the API
 * leaks which accounts exist (quickstart V5).
 */
export function invalidCredentials(): AppError {
  return new AppError('INVALID_CREDENTIALS', 401, 'Email or password is incorrect.');
}

export function unauthenticated(): AppError {
  return new AppError('UNAUTHENTICATED', 401, 'Authentication is required.');
}

export function notFound(): AppError {
  return new AppError('NOT_FOUND', 404, 'The requested resource was not found.');
}
