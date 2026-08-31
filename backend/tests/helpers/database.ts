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

// Every seeder that grants permissions or creates the development account.
// A new phase adding grants MUST add its seeder here, or every test in that
// phase fails with 403 for a reason that looks like a permission bug.
const ROLE_PERMISSIONS_SEEDER = '20260826000007-role-permissions.cjs';
const CUSTOMER_PERMISSIONS_SEEDER = '20260827000001-customer-permissions.cjs';
const TICKET_PERMISSIONS_SEEDER = '20260828000001-ticket-permissions.cjs';
const DASHBOARD_PERMISSIONS_SEEDER = '20260829000001-dashboard-permissions.cjs';
const CHANNEL_PERMISSIONS_SEEDER = '20260830000001-channel-permissions.cjs';
const ADMIN_USER_SEEDER = '20260825000002-admin-user.cjs';

/**
 * Only GRANT seeders and the development account run here.
 *
 * Phase 4's `20260829000002-starter-templates.cjs` is deliberately NOT in this
 * list, even though it ships with the application. It attributes each template
 * to the seeded administrator through a `RESTRICT` foreign key, which makes
 * that account undeletable — and several existing tests delete it to construct
 * a "last administrator" scenario. Seeding content here would break them for a
 * reason having nothing to do with what they test.
 *
 * The rule this settles for later phases: this helper seeds PERMISSIONS, not
 * CONTENT. A test that needs a template creates its own.
 */
async function reseed(): Promise<void> {
  const queryInterface = sequelize.getQueryInterface();
  await seeder(ROLE_PERMISSIONS_SEEDER).up(queryInterface);
  await seeder(CUSTOMER_PERMISSIONS_SEEDER).up(queryInterface);
  await seeder(TICKET_PERMISSIONS_SEEDER).up(queryInterface);
  await seeder(DASHBOARD_PERMISSIONS_SEEDER).up(queryInterface);
  await seeder(CHANNEL_PERMISSIONS_SEEDER).up(queryInterface);
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
