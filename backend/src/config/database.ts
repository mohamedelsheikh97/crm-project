import { Sequelize } from 'sequelize';

import { env } from './env.js';

export const sequelize = new Sequelize(env.DB_NAME, env.DB_USER, env.DB_PASSWORD, {
  host: env.DB_HOST,
  port: env.DB_PORT,
  dialect: 'mysql',
  logging: false,
  define: {
    // Produces created_at / updated_at rather than createdAt / updatedAt,
    // matching data-model.md.
    underscored: true,
    timestamps: true,
  },
});

/**
 * Fail-fast check used at startup (FR-005). Throws a message naming the
 * database host and port so the operator knows what to fix.
 */
export async function assertDatabaseConnection(): Promise<void> {
  try {
    await sequelize.authenticate();
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `Cannot reach the database at ${env.DB_HOST}:${env.DB_PORT} ` +
        `(database "${env.DB_NAME}", user "${env.DB_USER}"): ${reason}`,
      { cause },
    );
  }
}

/**
 * Non-throwing variant for the health endpoint, which must degrade to 503
 * rather than take the process down.
 */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await sequelize.authenticate();
    return true;
  } catch {
    return false;
  }
}
