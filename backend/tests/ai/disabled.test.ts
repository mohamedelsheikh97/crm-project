import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../src/app.js';
import { AI_FEATURES, isEnabled } from '../../src/ai/features.js';
import { env } from '../../src/config/env.js';
import { AiInvocation } from '../../src/models/ai-invocation.model.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

/**
 * WITH THE CAPABILITY DISABLED, THE PRODUCT IS PHASE 8 (SC-022, FR-001).
 *
 * The test environment has `AI_ENABLED` unset, so this suite runs in exactly
 * the configuration SC-022 describes — which is also why every other Phase 9
 * suite has to mock `features.ts` to switch its own feature on. That is
 * deliberate: the default state of the test run is "AI off", so a change that
 * accidentally made an AI surface reachable without configuration would break
 * this file rather than pass unnoticed.
 *
 * What this does NOT do is re-run the Phase 0-8 suite. `npm test` does that,
 * and it passes — asserting it from inside itself would be circular. This
 * asserts the narrower, checkable half: that with AI off, no AI code path runs,
 * nothing is recorded, and the pre-existing surfaces answer as they always did.
 */
describe('the AI capability is genuinely optional', () => {
  beforeAll(async () => {
    await setupTestDatabase();
    await truncateAll();
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('runs this suite with AI_ENABLED off, which is the configuration under test', () => {
    expect(env.AI_ENABLED).toBe(false);
  });

  it.each(AI_FEATURES)('reports %s as disabled', (feature) => {
    // No database row can switch a feature on while the phase is not deployed.
    expect(isEnabled(feature)).toBe(false);
  });

  it('records no invocation for any feature', async () => {
    expect(await AiInvocation.count()).toBe(0);
  });

  it('leaves the pre-Phase-9 ticket surface answering exactly as before', async () => {
    // Unauthenticated, so 401 — the same answer Phase 3 gave. The point is that
    // mounting the AI router changed nothing about the routes beside it.
    const response = await request(app).get('/api/tickets');

    expect(response.status).toBe(401);
  });

  it('leaves the public knowledge base surface reachable (Phase 7)', async () => {
    const response = await request(app).get('/api/public/kb/categories');

    // Still 200 and still anonymous: Phase 9 added no gate to Phase 7's public
    // surface, and the AI router is mounted behind `authenticate` rather than
    // in front of anything.
    expect(response.status).toBe(200);
  });

  it('leaves the portal surface refusing an unauthenticated caller (Phase 8)', async () => {
    const response = await request(app).post('/api/portal/assistant/messages').send({ body: 'x' });

    // The assistant endpoint exists but is inside the portal realm, so it
    // refuses like every other portal route rather than being absent.
    expect(response.status).toBe(401);
  });
});
