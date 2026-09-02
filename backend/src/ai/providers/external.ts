import Anthropic from '@anthropic-ai/sdk';

import { env } from '../../config/env.js';

import { AiProviderError, type AiProvider, type AiRequest, type AiResult } from './types.js';

/**
 * Staff-facing AI processing, through the Anthropic API.
 *
 * PERMITTED TO LEAVE THE SYSTEM (Clarifications Q1). Staff features process
 * content an employee is already accountable for and has already read; the
 * customer-facing assistant is a different matter and uses `local.ts`.
 *
 * This module must never be reachable from the assistant. Three guards say so:
 * the `no-restricted-imports` rule in eslint.config.js, the import-graph read in
 * `backend/tests/ai/egress.test.ts`, and the location assertion in `invoke.ts`.
 */
const MODEL = 'claude-opus-5';

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: env.AI_EXTERNAL_API_KEY });
  }
  return client;
}

export const externalProvider: AiProvider = {
  location: 'external',

  async complete(request: AiRequest): Promise<AiResult> {
    let response;

    try {
      response = await anthropic().beta.messages.create({
        model: MODEL,
        max_tokens: request.maxOutput,

        // Adaptive thinking is the current API; `budget_tokens` is rejected on
        // this model family. Effort is `medium` because these are summarising
        // and drafting tasks over material already in context, not the
        // long-horizon reasoning that repays `high`.
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },

        // A policy decline would otherwise simply stop the request. Ticket
        // threads contain complaints, security reports, and whatever a customer
        // pasted in — content that can trip a classifier while being ordinary
        // support work. Routing by refusal category is more robust than a model
        // list we would have to maintain.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',

        // The system prefix is stable per feature and language, so it caches;
        // the volatile ticket content sits after it in `messages`, which is the
        // order the cache requires.
        system: [
          { type: 'text', text: request.system, cache_control: { type: 'ephemeral' } },
        ],
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      });
    } catch (error) {
      throw new AiProviderError(
        'provider_unreachable',
        error instanceof Error ? error.name : 'unknown',
      );
    }

    // A refusal is a 200 with `stop_reason: 'refusal'`, not a thrown error, and
    // reading `content` without checking would hand a caller an empty string as
    // though it were an answer (FR-003).
    if (response.stop_reason === 'refusal') {
      throw new AiProviderError('provider_refused', 'the model declined this request');
    }

    const text = response.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    if (!text) {
      throw new AiProviderError('empty_response', 'the model returned no text');
    }

    return {
      text,
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
    };
  },
};
