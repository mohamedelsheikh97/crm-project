import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sequelize } from '../../src/config/database.js';
import * as models from '../../src/models/index.js';
import { closeTestDatabase, setupTestDatabase } from '../helpers/database.js';

/**
 * Every migrated column is declared on its model (Phase 11, T019).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS EXISTS BECAUSE PHASE 9 SHIPPED THE BUG IT CATCHES.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `assistant_conversation_id` was added to `tickets` in a migration and never
 * declared on the Ticket model. Sequelize does not complain about that — it
 * silently drops the field on write. No error, no warning, no failing type: the
 * column simply stays NULL forever, and the defect surfaced much later through a
 * test that wondered why an escalated conversation had no ticket attached.
 *
 * A model missing a column is invisible in review because both files look
 * correct on their own. The only way to see it is to compare them, which is what
 * this does.
 *
 * IT ALSO CHECKS THE REVERSE — a model attribute with no column. That direction
 * fails loudly at runtime rather than silently, but it fails on the first write
 * in production rather than here.
 *
 * Scoped to the nine Phase 11 tables. Widening it to every model in the project
 * would be a bigger change than this phase should make, and would likely
 * surface historical divergences that need their own decisions.
 */
const PHASE_11_MODELS = [
  'ApiClient',
  'ApiClientSecret',
  'ApiClientPermission',
  'WebhookSubscription',
  'IntegrationEvent',
  'WebhookDeliveryAttempt',
  'ErpLink',
  'ErpSyncRun',
  'ErpSyncRecord',
] as const;

/**
 * Columns the DATABASE computes and the model must not declare.
 *
 * `running_adapter_key` is a generated column enforcing FR-048's one-run-per-
 * adapter rule. Declaring it would invite Sequelize to write it, which MySQL
 * refuses — so its absence from the model is correct rather than an oversight,
 * and it is listed here so the check stays honest about why.
 */
const GENERATED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  erp_sync_runs: ['running_adapter_key'],
};

describe('Phase 11 models match their migrations', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('covers all nine tables', () => {
    // The assertion that stops this file passing vacuously: a typo in a model
    // name would otherwise silently skip it.
    for (const name of PHASE_11_MODELS) {
      expect(models, `${name} is not exported from models/index.ts`).toHaveProperty(name);
    }

    expect(PHASE_11_MODELS.length).toBe(9);
  });

  it.each([...PHASE_11_MODELS])('%s declares every column its table has', async (name) => {
    const model = (models as unknown as Record<string, typeof models.ApiClient>)[name]!;
    const table = model.getTableName() as string;

    const described = await sequelize.getQueryInterface().describeTable(table);
    const inDatabase = new Set(Object.keys(described));

    const attributes = model.getAttributes() as Record<string, { field?: string }>;
    const onModel = new Set(
      Object.entries(attributes).map(([key, attribute]) => attribute.field ?? key),
    );

    const generated = new Set(GENERATED_COLUMNS[table] ?? []);

    const missingOnModel = [...inDatabase].filter(
      (column) => !onModel.has(column) && !generated.has(column),
    );

    /**
     * THE PHASE 9 FAILURE, as an assertion.
     *
     * A column in the table and absent from the model is dropped on write with
     * no error anywhere.
     */
    expect(
      missingOnModel,
      `${table} has columns the ${name} model does not declare — Sequelize will drop them on write`,
    ).toEqual([]);

    const missingInDatabase = [...onModel].filter((column) => !inDatabase.has(column));

    expect(missingInDatabase, `${name} declares attributes ${table} does not have`).toEqual([]);
  });
});
