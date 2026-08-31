import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';

import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requestLogger } from './middleware/request-logger.js';
import apiRouter from './routes/index.js';

const app = express();

// Middleware order is fixed. The two error handlers MUST stay last, in this order.
app.disable('x-powered-by');
app.use(requestLogger);
// Explicit origin plus credentials — never '*'. Credentialed CORS forbids the
// wildcard, and env.ts rejects it at startup (contracts/auth-api.md).
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
// The `verify` callback stashes the RAW bytes (Phase 5, research.md D5).
//
// A provider signs the exact bytes it sent. Re-serialising a parsed object
// changes key order and whitespace, so verifying against it fails
// intermittently — which is worse than failing always, because it looks like a
// provider problem. Webhook routes verify against this buffer before anything
// parses or trusts the payload (FR-054, FR-064).
//
// Four lines here rather than mounting webhook routers ahead of the parser,
// which would split the fixed middleware order below that Phases 0-4 have all
// respected.
//
// The limit is raised from 100kb because a webhook carrying media metadata for
// a batch of messages exceeds it, and a body silently truncated at the parser
// fails signature verification for a reason nothing in the logs explains.
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buffer) => {
      (req as express.Request).rawBody = Buffer.from(buffer);
    },
  }),
);
app.use(cookieParser());
app.use('/api', apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
