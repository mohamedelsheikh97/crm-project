import type { ErrorRequestHandler, RequestHandler } from 'express';

import {
  AppError,
  ChannelWindowClosedError,
  DuplicateCustomerError,
  MentionNotVisibleError,
  TicketMergedError,
  TransitionNotAllowedError,
  notFound,
} from '../errors/app-error.js';
import { RateLimitedError } from '../lib/rate-limit.js';

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

  // Phase 4, same rule again. The composer has to tell the author WHICH person
  // it refused and why, and a list of user summaries does not fit the
  // {field, message} shape `details` has a defined meaning for.
  if (err instanceof MentionNotVisibleError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
      mentions: err.mentions,
    });
    return;
  }

  // Phase 5, same sibling rule. The composer has to know what the channel
  // permits BEFORE the agent writes, so the permitted templates and the reopen
  // time ride beside the envelope rather than inside details[].
  if (err instanceof ChannelWindowClosedError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
      window: err.window,
    });
    return;
  }

  // Retry-After is the header a well-behaved client already knows how to obey,
  // and the public endpoints this guards are reached by things that are not our
  // interface (FR-105).
  if (err instanceof RateLimitedError) {
    res.setHeader('Retry-After', String(err.retryAfterSeconds));
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
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
