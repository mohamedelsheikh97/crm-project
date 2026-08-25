import type { ErrorRequestHandler, RequestHandler } from 'express';

import { AppError, notFound } from '../errors/app-error.js';

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(notFound());
};

/**
 * The single place a non-2xx body is produced (FR-007). A stack trace MUST
 * NEVER appear in a response body in any environment, development included.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
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
