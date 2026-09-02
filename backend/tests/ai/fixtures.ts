import type { AiProvider, AiRequest, AiResult } from '../../src/ai/providers/types.js';

/**
 * A fake provider (Phase 9, research.md D10).
 *
 * EVERY TEST IN THIS PHASE USES ONE. No test makes a network call, spends
 * money, or depends on what a model happens to say — which is what makes the
 * suite affordable to run and deterministic enough to assert on.
 *
 * The properties worth testing here are structural: where egress went, what
 * entered the context, what was refused, what was recorded. None of those need
 * a real model. The properties that DO need one — is the summary useful, is the
 * answer correct — are assigned to human review by SC-002, SC-006, SC-010 and
 * SC-016, because there is no automated oracle for them and pretending
 * otherwise would produce tests that pass while the feature is worthless.
 */
export interface FakeProvider extends AiProvider {
  /** Every request this provider was handed, in order. */
  readonly calls: AiRequest[];
  /** Set to make the next call throw. */
  failWith(error: Error): void;
}

export function fakeProvider(
  location: 'external' | 'local',
  respond: (request: AiRequest) => string = () => 'fake response',
): FakeProvider {
  const calls: AiRequest[] = [];
  let pendingError: Error | null = null;

  return {
    location,
    calls,

    failWith(error: Error) {
      pendingError = error;
    },

    async complete(request: AiRequest): Promise<AiResult> {
      calls.push(request);

      if (pendingError) {
        const error = pendingError;
        pendingError = null;
        throw error;
      }

      return {
        text: respond(request),
        inputTokens: 100,
        outputTokens: 50,
      };
    },
  };
}

/**
 * A provider that records what it was sent and returns it, so a test can assert
 * on the exact content that would have crossed the boundary.
 */
export function capturingProvider(location: 'external' | 'local'): FakeProvider {
  return fakeProvider(location, (request) =>
    JSON.stringify({
      system: request.system,
      messages: request.messages,
    }),
  );
}
