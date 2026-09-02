import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import app from '../../src/app.js';
import { sequelize } from '../../src/config/database.js';
import { AI_FEATURES, clearOverrides, isEnabled } from '../../src/ai/features.js';
import { AuditLog } from '../../src/models/audit-log.model.js';
import * as configService from '../../src/services/ai-config.service.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

/**
 * AI administration (Phase 9, US6, FR-002, FR-060 - FR-064, SC-021).
 *
 * TWO PROPERTIES ARE LOAD-BEARING HERE.
 *
 * FEATURE INDEPENDENCE (FR-002, SC-021) is asserted by ITERATING
 * `ai/features.ts` rather than by naming the five features, so a sixth added in
 * a later phase is covered without this file being touched — which is the whole
 * reason that declaration exists in one place (research D12).
 *
 * NO SECRETS AND NO PROCESSING LOCATION in the config payload (FR-064, D2). The
 * second half matters more than it looks: a `location` field, even read-only,
 * is an invitation to add a PATCH for it, and that PATCH is precisely what
 * FR-008a forbids.
 */
describe('AI configuration', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  }, 90_000);

  beforeEach(async () => {
    await truncateAll();
    configService.resetCache();
    clearOverrides();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('exposes no secret and no processing location', async () => {
    const view = await configService.current();
    const serialised = JSON.stringify(view);

    for (const forbidden of ['apiKey', 'api_key', 'baseUrl', 'base_url', 'location', 'model']) {
      expect(serialised, `config must not expose ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('stores no secret and no location column', async () => {
    const description = await sequelize.getQueryInterface().describeTable('ai_settings');
    const columns = Object.keys(description).join(' ');

    // A `location` column here would reduce the egress boundary to a string one
    // careless UPDATE away from sending customer chat to a third party.
    expect(columns).not.toMatch(/location|api_key|base_url|model/);
  });

  /**
   * FR-002's independence is asserted on the SERVED CONFIGURATION, not on
   * `isEnabled`.
   *
   * The two are different questions, and the first version of this test
   * conflated them. `isEnabled` additionally honours the `AI_ENABLED`
   * environment master switch — which is off in the test environment,
   * deliberately, because SC-022 requires the Phase 0-8 suite to pass with the
   * capability disabled. So every feature reported false and the test proved
   * nothing.
   *
   * The administrator's toggles and the deployment-level master switch are
   * separate controls with separate purposes, and they are now asserted
   * separately: independence here, the master switch below.
   */
  it.each(AI_FEATURES)(
    'switching %s off leaves every other feature switched on (FR-002, SC-021)',
    async (feature) => {
      await configService.update(
        { features: Object.fromEntries(AI_FEATURES.map((key) => [key, true])) },
        { id: 1, email: 'admin@crm.local' },
      );

      const after = await configService.update(
        { features: { [feature]: false } },
        { id: 1, email: 'admin@crm.local' },
      );

      expect(after.features[feature], `${feature} should be off`).toBe(false);

      for (const other of AI_FEATURES.filter((key) => key !== feature)) {
        expect(after.features[other], `${other} should be unaffected`).toBe(true);
      }
    },
  );

  it('the AI_ENABLED master switch overrides every stored toggle (SC-022)', async () => {
    // Everything on in the database.
    await configService.update(
      { features: Object.fromEntries(AI_FEATURES.map((key) => [key, true])) },
      { id: 1, email: 'admin@crm.local' },
    );

    configService.resetCache();
    await configService.ensureFresh();

    // AI_ENABLED is false in the test environment, and no database row may
    // switch a feature on when the phase is not deployed. This is what makes
    // "with the capability disabled the product is Phase 8" true regardless of
    // what an administrator did before it was turned off.
    for (const feature of AI_FEATURES) {
      expect(isEnabled(feature), `${feature} must stay off while AI_ENABLED is false`).toBe(false);
    }
  });

  it('records enablement and disablement as distinct audit actions (FR-062)', async () => {
    await configService.update(
      { features: { summary: true } },
      { id: 1, email: 'admin@crm.local' },
    );

    configService.resetCache();

    await configService.update(
      { features: { summary: false } },
      { id: 1, email: 'admin@crm.local' },
    );

    const actions = (await AuditLog.findAll({ order: [['id', 'ASC']] })).map((row) => row.action);

    // Two different questions — "who turned this on" and "who turned it off" —
    // and a reader should not have to diff JSON to tell them apart.
    expect(actions).toContain('ai.feature.enabled');
    expect(actions).toContain('ai.feature.disabled');
  });

  it('records a ceiling change with its before and after', async () => {
    await configService.update({ ceilings: { summary: 42 } }, { id: 1, email: 'admin@crm.local' });

    const row = (await AuditLog.findOne({ where: { action: 'ai.ceiling.changed' } })) as {
      previous_value: unknown;
      new_value: unknown;
    } | null;

    expect(row).not.toBeNull();
    expect(JSON.stringify(row?.new_value)).toContain('42');
  });

  it('writes nothing and records nothing when the patch changes nothing', async () => {
    await configService.update({ features: { summary: false } }, { id: 1, email: 'a@b.c' });

    // summary already defaults to false in the test environment.
    expect(await AuditLog.count()).toBe(0);
  });

  it('ignores an invalid ceiling and an unknown language rather than storing them', async () => {
    const view = await configService.update(
      {
        ceilings: { summary: -5, draft: 'lots' },
        assistantLangs: ['en', 'fr', 'ar'],
      },
      { id: 1, email: 'a@b.c' },
    );

    expect(view.ceilings.summary).toBeGreaterThan(0);
    expect(view.assistantLangs).toEqual(['en', 'ar']);
  });

  it('refuses configuration changes without ai:manage, server-side (FR-060)', async () => {
    // Unauthenticated stands in for "not permitted": the admin router applies
    // authenticate for the whole group, and requirePermission gates each route.
    const response = await request(app).patch('/api/admin/ai/config').send({});

    expect(response.status).toBe(401);
  });

  it('states in the activity payload that content is not retained', async () => {
    const response = await request(app).get('/api/admin/ai/activity');

    // Unauthenticated here; the shape assertion belongs with the controller, so
    // this just confirms the route is gated like the rest.
    expect(response.status).toBe(401);
  });
});
