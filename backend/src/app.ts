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
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use('/api', apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
