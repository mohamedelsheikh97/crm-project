import { AiInvocation, type AiInvocationOutcome } from '../models/ai-invocation.model.js';

import * as budget from './budget.js';
import { FEATURES, isEnabled, type AiFeatureKey } from './features.js';
import { redact } from './redact.js';
import {
  AiProviderError,
  type AiProvider,
  type AiRequest,
  type AiResult,
} from './providers/types.js';

/**
 * THE SINGLE PATH EVERY AI FEATURE CALLS (Phase 9, research.md D1).
 *
 * Nothing calls a provider directly. Routing every feature through one function
 * is what makes the feature flag, the ceiling, redaction, the location
 * assertion, and the invocation record impossible to skip — a sixth feature
 * added in a later phase gets all five without its author remembering them.
 *
 * `channels/registry.ts` is the precedent, and Phase 5's comment on the chat
 * adapter says why it matters: entering through the same door buys identity
 * resolution, threading, the ledger, and opt-out checking for free, and "a chat
 * implementation that bypassed the boundary would be a second intake path to
 * keep in step, and the first one to drift."
 */
const TIMEOUTS: Readonly<Record<AiFeatureKey, number>> = {
  summary: 10_000,
  draft: 15_000,
  classify: 8_000,
  similar: 0,
  assistant: 20_000,
};

/** Bounded, per FR-006. Each attempt counts against the same ceiling. */
const MAX_ATTEMPTS = 2;

export interface InvokeContext {
  readonly subjectType?: 'ticket' | 'conversation' | 'none';
  readonly subjectId?: number | null;
  readonly requestedBy?: number | null;
  readonly portalAccountId?: number | null;
}

export class AiUnavailableError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'AiUnavailableError';
  }
}

async function record(
  feature: AiFeatureKey,
  context: InvokeContext,
  location: 'external' | 'local' | 'none',
  outcome: AiInvocationOutcome,
  extra: { inputTokens?: number | null; outputTokens?: number | null; durationMs?: number | null; errorCode?: string | null } = {},
): Promise<void> {
  // Best-effort and never allowed to fail the caller's request: an accounting
  // write must not turn a working summary into an error. Phase 7 took the same
  // position on its read counter.
  try {
    await AiInvocation.create({
      feature,
      subject_type: context.subjectType ?? 'none',
      subject_id: context.subjectId ?? null,
      requested_by: context.requestedBy ?? null,
      portal_account_id: context.portalAccountId ?? null,
      location,
      outcome,
      input_tokens: extra.inputTokens ?? null,
      output_tokens: extra.outputTokens ?? null,
      duration_ms: extra.durationMs ?? null,
      error_code: extra.errorCode ?? null,
    });
  } catch {
    // Swallowed deliberately. See above.
  }
}

/**
 * Records an outcome for a call that was never made.
 *
 * Used by the assistant when retrieval scores below the grounding floor
 * (research D3 step 2). The refusal is the feature working correctly, and
 * SC-015's deflection rate is computed from these rows.
 */
export async function recordRefusal(
  feature: AiFeatureKey,
  context: InvokeContext,
  outcome: Extract<AiInvocationOutcome, 'refused_ungrounded' | 'refused_disabled'>,
): Promise<void> {
  await record(feature, context, FEATURES[feature].location, outcome);
}

export async function invoke(
  provider: AiProvider,
  request: AiRequest,
  context: InvokeContext = {},
): Promise<AiResult> {
  const feature = request.feature;

  // Pull the stored configuration into `features.ts` before anything reads it,
  // so a feature an administrator switched off moments ago is off here too
  // (FR-002, SC-021). Imported lazily to keep `ai/` free of a dependency on
  // `services/` in the other direction.
  try {
    const config = await import('../services/ai-config.service.js');
    await config.ensureFresh();
  } catch {
    // Environment defaults stand. A settings read that fails must not turn
    // a feature on that somebody turned off.
  }

  if (!isEnabled(feature)) {
    await record(feature, context, provider.location, 'refused_disabled');
    throw new AiUnavailableError('ai_feature_disabled');
  }

  /**
   * THE EGRESS ASSERTION — enforcement layer 3 (research D2, FR-008a).
   *
   * The weakest of the three guards, and it is here anyway. Lint and the
   * import-graph test in `backend/tests/ai/egress.test.ts` are what actually
   * make the wrong wiring impossible; this catches a provider passed at
   * runtime, and it is the layer a refactor can delete while every test stays
   * green — which is precisely why it is not the only one.
   */
  const expected = FEATURES[feature].location;

  if (expected !== 'none' && provider.location !== expected) {
    throw new AiUnavailableError('ai_location_mismatch');
  }

  const verdict = await budget.check(feature);

  if (!verdict.allowed) {
    await record(feature, context, provider.location, 'refused_budget');
    throw new AiUnavailableError('ai_budget_exhausted');
  }

  // Redaction applies to everything leaving this process, both providers
  // (FR-010, SC-025).
  const redacted: AiRequest = {
    ...request,
    system: redact(request.system).text,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: redact(message.content).text,
    })),
  };

  const started = Date.now();
  let lastCode = 'unknown';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await withTimeout(provider.complete(redacted), TIMEOUTS[feature]);

      await record(feature, context, provider.location, 'success', {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        durationMs: Date.now() - started,
      });

      return result;
    } catch (error) {
      lastCode = error instanceof AiProviderError ? error.code : 'timeout';

      // Each attempt is recorded, so retries are visible in the activity view
      // and count against tomorrow's understanding of what this costs.
      await record(feature, context, provider.location, 'failed', {
        durationMs: Date.now() - started,
        errorCode: lastCode,
      });

      // A refusal or a misconfiguration will not resolve itself on a second
      // attempt; only transport failures are worth retrying.
      if (lastCode === 'provider_refused' || lastCode.endsWith('_not_configured')) {
        break;
      }
    }
  }

  throw new AiUnavailableError(lastCode === 'provider_refused' ? 'ai_refused' : 'ai_unavailable');
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) return promise;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new AiProviderError('timeout', `exceeded ${ms}ms`)),
      ms,
    );

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new AiProviderError('unknown', 'unknown'));
      },
    );
  });
}
