import type { ErrorRequestHandler, RequestHandler } from 'express';

import {
  AppError,
  DuplicateCustomerError,
  TicketMergedError,
  TransitionNotAllowedError,
  notFound,
} from '../errors/app-error.js';

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(notFound());
};

/**
 * The single place a non-2xx body is produced (FR-007). A stack trace MUST
 * NEVER appear in a response body in any environment, development included.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof DuplicateCustomerError) {
    // `duplicates` is a SIBLING of `error`, not part of it. The envelope's
    // error object is untouched, so every existing consumer keeps working.
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
      duplicates: err.duplicates,
    });
    return;
  }

  // Phase 3 follows the same rule: structured data a caller must act on rides
  // BESIDE the envelope, never inside details[].
  if (err instanceof TransitionNotAllowedError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
      transition: err.transition,
    });
    return;
  }

  if (err instanceof TicketMergedError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
      merged: err.merged,
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  req.log?.error({ err }, 'Unhandled error');

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      details: [],
    },
  });
};
