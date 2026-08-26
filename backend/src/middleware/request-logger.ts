import { pinoHttp } from 'pino-http';

import { env } from '../config/env.js';

/**
 * pino-http logs method, path, status and response time out of the box, which
 * is exactly FR-008. Redaction is a requirement, not a nicety (research.md D7):
 * credentials must never reach log storage.
 */
export const requestLogger = pinoHttp({
  level: env.LOG_LEVEL,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password'],
    censor: '[REDACTED]',
  },
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true, singleLine: true } } }
    : {}),
});

export const logger = requestLogger.logger;
