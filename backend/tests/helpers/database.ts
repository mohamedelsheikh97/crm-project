import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';

import { sequelize } from '../../src/config/database.js';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const backendRoot = path.resolve(import.meta.dirname, '../..');

/**
 * Tests run against a dedicated schema so a run can never touch development
 * data. NODE_ENV=test and DB_NAME=crm_support_test are set by vitest.config.ts,
 * and dotenv does not override variables that are already present.
 */
async function sequelizeCli(...args: string[]): Promise<void> {
  await run('npx', ['sequelize-cli', ...args], {
    cwd: backendRoot,
    shell: true,
    env: process.env,
  });
}

/**
 * Seeders are invoked directly rather than through the CLI. Spawning a process
 * between every test cost seconds each; requiring the module is instant and
 * still runs the same code, so the defaults cannot drift from production.
 */
function seeder(file: string): { up: (qi: unknown) => Promise<void> } {
  return require(path.join(backendRoot, 'src/db/seeders', file));
}

const ROLE_PERMISSIONS_SEEDER = '20260826000007-role-permissions.cjs';
const ADMIN_USER_SEEDER = '20260825000002-admin-user.cjs';

async function reseed(): Promise<void> {
  const queryInterface = sequelize.getQueryInterface();
  await seeder(ROLE_PERMISSIONS_SEEDER).up(queryInterface);
  await seeder(ADMIN_USER_SEEDER).up(queryInterface);
}

export async function setupTestDatabase(): Promise<void> {
  // Migrations still go through the CLI: they are stateful and ordered, and
  // running them once per suite is cheap.
  await sequelizeCli('db:migrate');
  await reseed();
}

/**
 * Tables that must survive truncation.
 *
 * `roles` is created AND populated by a migration, not a seeder — FR-021 makes
 * the three roles immutable reference data the schema depends on. Truncating it
 * would destroy rows no seeder can restore, and break the users.role_id foreign
 * key with it. `role_permissions` is seeder-owned, so it is safe to truncate
 * and re-seed.
 */
const PRESERVED_TABLES = ['SequelizeMeta', 'SequelizeData', 'roles'];

export async function truncateAll(): Promise<void> {
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 0;');

  const preserved = PRESERVED_TABLES.map((name) => `'${name}'`).join(', ');

  const [tables] = (await sequelize.query(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name NOT IN (${preserved})`,
  )) as [Array<{ name: string }>, unknown];

  for (const { name } of tables) {
    await sequelize.query(`TRUNCATE TABLE \`${name}\`;`);
  }

  await sequelize.query('SET FOREIGN_KEY_CHECKS = 1;');

  await reseed();
}

export async function closeTestDatabase(): Promise<void> {
  await sequelize.close();
}
