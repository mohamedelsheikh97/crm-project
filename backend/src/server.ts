// env is imported first on purpose: config validation runs and exits before
// anything else initialises (FR-017).
import { env } from './config/env.js';
import app from './app.js';
import { assertDatabaseConnection, sequelize } from './config/database.js';
import { startScheduler, stopScheduler } from './lib/scheduler.js';
import { logger } from './middleware/request-logger.js';

async function start(): Promise<void> {
  try {
    await assertDatabaseConnection();
  } catch (error) {
    // Refuse to serve traffic in a half-broken state (FR-005, US1 Scenario 2).
    logger.fatal(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const server = app.listen(env.PORT, () => {
    logger.info(`Backend listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  // HERE, not in app.ts (research.md D4). Tests import the app, and a timer
  // started there would leak into every test run. This module is the only one
  // that owns process lifetime, which is exactly what a scheduler needs.
  startScheduler();

  const shutdown = (signal: string): void => {
    logger.info(`${signal} received, shutting down.`);
    stopScheduler();
    server.close(() => {
      void sequelize.close().finally(() => process.exit(0));
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void start();
