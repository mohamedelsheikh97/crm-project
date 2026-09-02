import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiInvocation } from '../../src/models/ai-invocation.model.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

import { fakeProvider } from './fixtures.js';

/**
 * Ceilings, refusals, redaction placement, and the invocation record — the four
 * things `invoke.ts` guarantees for every feature (Phase 9, FR-005, SC-027).
 *
 * These exercise the SHARED PATH rather than any one feature, which is the
 * point of having one: a sixth feature added later inherits all of it, and
 * these assertions cover that feature too without being rewritten.
 */
const FEATURES_MODULE = '../../src/ai/features.js';

async function loadInvoke(overrides: Record<string, unknown>) {
  vi.resetModules();

  const actual = await vi.importActual<typeof import('../../src/ai/features.js')>(FEATURES_MODULE);

  vi.doMock(FEATURES_MODULE, () => ({
    ...actual,
    FEATURES: { ...actual.FEATURES, ...overrides },
    isEnabled: (key: string) =>
      ((overrides[key] as { enabled?: boolean })?.enabled ??
        actual.FEATURES[key as keyof typeof actual.FEATURES].enabled) === true,
    /**
     * `budget.ts` reads the ceiling through `ceilingFor` rather than off
     * `FEATURES` directly, so that an administrator raising a limit at runtime
     * takes effect without a deploy (US6). The mock has to override it too —
     * spreading `actual` alone would give the real function, which consults the
     * real overrides and would ignore the ceiling this test is setting.
     */
    ceilingFor: (key: string) =>
      (overrides[key] as { ceiling?: number | null })?.ceiling ??
      actual.FEATURES[key as keyof typeof actual.FEATURES].ceiling,
  }));

  return import('../../src/ai/invoke.js');
}

const request = {
  feature: 'summary' as const,
  system: 'you summarise tickets',
  messages: [{ role: 'user' as const, content: 'the customer says hello' }],
  maxOutput: 1000,
  contentLang: 'en' as const,
};

describe('the shared invocation path', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  }, 90_000);

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('refuses a disabled feature without calling the provider, and records it', async () => {
    const { invoke, AiUnavailableError } = await loadInvoke({
      summary: { key: 'summary', enabled: false, ceiling: 500, location: 'external' },
    });

    const provider = fakeProvider('external');

    await expect(invoke(provider, request)).rejects.toBeInstanceOf(AiUnavailableError);

    expect(provider.calls).toHaveLength(0);

    const rows = await AiInvocation.findAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe('refused_disabled');
  });

  it('records a success with the token counts and the processing location', async () => {
    const { invoke } = await loadInvoke({
      summary: { key: 'summary', enabled: true, ceiling: 500, location: 'external' },
    });

    const result = await invoke(fakeProvider('external'), request, {
      subjectType: 'ticket',
      subjectId: 42,
    });

    expect(result.text).toBe('fake response');

    const row = (await AiInvocation.findOne()) as AiInvocation;
    expect(row.outcome).toBe('success');
    expect(row.location).toBe('external');
    expect(row.subject_id).toBe(42);
    expect(row.input_tokens).toBe(100);
  });

  it('refuses once the daily ceiling is reached, and records the refusal', async () => {
    const { invoke, AiUnavailableError } = await loadInvoke({
      summary: { key: 'summary', enabled: true, ceiling: 1, location: 'external' },
    });

    const provider = fakeProvider('external');

    // First call consumes the allowance.
    await invoke(provider, request);
    expect(provider.calls).toHaveLength(1);

    // Second is refused BEFORE the provider is reached — an exhausted ceiling
    // must not still cost money.
    await expect(invoke(provider, request)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(provider.calls).toHaveLength(1);

    const refusals = await AiInvocation.findAll({ where: { outcome: 'refused_budget' } });
    expect(refusals).toHaveLength(1);
  });

  it('does not let a refusal that never reached a provider consume the allowance', async () => {
    const { invoke, recordRefusal } = await loadInvoke({
      summary: { key: 'summary', enabled: true, ceiling: 1, location: 'external' },
    });

    // An assistant declining below the grounding floor costs nothing. If those
    // counted, a customer asking unanswerable questions could exhaust the
    // budget for everyone without a single paid call being made.
    await recordRefusal('summary', {}, 'refused_ungrounded');
    await recordRefusal('summary', {}, 'refused_ungrounded');

    const provider = fakeProvider('external');
    await expect(invoke(provider, request)).resolves.toBeDefined();
    expect(provider.calls).toHaveLength(1);
  });

  it('redacts secrets before the provider sees them, in the shared path', async () => {
    const { invoke } = await loadInvoke({
      summary: { key: 'summary', enabled: true, ceiling: 500, location: 'external' },
    });

    const provider = fakeProvider('external');

    await invoke(provider, {
      ...request,
      messages: [
        { role: 'user', content: 'the key is sk-ant-api03-abcdefghijklmnop1234 and card 4111111111111111' },
      ],
    });

    const sent = provider.calls[0].messages[0].content;
    expect(sent).not.toContain('sk-ant-api03');
    expect(sent).not.toContain('4111111111111111');
    expect(sent).toContain('[redacted]');
  });

  it('refuses a provider whose location does not match the feature', async () => {
    const { invoke, AiUnavailableError } = await loadInvoke({
      summary: { key: 'summary', enabled: true, ceiling: 500, location: 'external' },
    });

    // Enforcement layer 3. The weakest of the three guards, asserted anyway.
    const wrong = fakeProvider('local');

    await expect(invoke(wrong, request)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(wrong.calls).toHaveLength(0);
  });

  it('records each failed attempt, so retries are visible and counted', async () => {
    const { invoke } = await loadInvoke({
      summary: { key: 'summary', enabled: true, ceiling: 500, location: 'external' },
    });

    const provider = fakeProvider('external');
    provider.failWith(new Error('boom'));

    // The first attempt fails; the bounded retry succeeds.
    await expect(invoke(provider, request)).resolves.toBeDefined();

    const outcomes = (await AiInvocation.findAll({ order: [['id', 'ASC']] })).map((r) => r.outcome);
    expect(outcomes).toEqual(['failed', 'success']);
  });
});
