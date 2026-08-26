import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { sequelize } from '../../src/config/database.js';

const run = promisify(execFile);
const backendRoot = path.resolve(import.meta.dirname, '../..');

/**
 * Tests run against a dedicated schema so a run can never touch development
 * data. NODE_ENV=test and DB_NAME=crm_support_test must be set before the
 * process starts — see vitest.config.ts and the CI workflow.
 */
async function sequelizeCli(...args: string[]): Promise<void> {
  await run('npx', ['sequelize-cli', ...args], {
    cwd: backendRoot,
    shell: true,
    env: process.env,
  });
}

export async function setupTestDatabase(): Promise<void> {
  await sequelize.query('CREATE DATABASE IF NOT EXISTS `crm_support_test`;');
  await sequelizeCli('db:migrate');
  await sequelizeCli('db:seed:all');
}

/**
 * Empties every table except SequelizeMeta between tests. Roles and their
 * default grants are re-seeded, because every test assumes they exist.
 */
export async function truncateAll(): Promise<void> {
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 0;');

  const [tables] = (await sequelize.query(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name NOT IN ('SequelizeMeta', 'SequelizeData')`,
  )) as [Array<{ name: string }>, unknown];

  for (const { name } of tables) {
    await sequelize.query(`TRUNCATE TABLE \`${name}\`;`);
  }

  await sequelize.query('SET FOREIGN_KEY_CHECKS = 1;');
  await sequelizeCli('db:seed:all');
}

export async function closeTestDatabase(): Promise<void> {
  await sequelize.close();
}
