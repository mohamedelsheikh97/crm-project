import { env } from '../../config/env.js';

import { AiProviderError, type AiProvider, type AiRequest, type AiResult } from './types.js';

/**
 * Customer-facing AI processing, on infrastructure the organisation controls.
 *
 * MUST NOT LEAVE THE BOUNDARY (Clarifications Q1, FR-008). This is the surface
 * where an unauthenticated or lightly-authenticated stranger types free text,
 * at volume, with no colleague reviewing it — and where a customer pastes a
 * card number into what looks like a support box.
 *
 * Speaks the OpenAI-compatible chat-completions wire format over `fetch`, and
 * adds NO DEPENDENCY (research D4). Every self-hostable inference server —
 * vLLM, Ollama, llama.cpp, TGI — already exposes that shape, so targeting it
 * keeps the choice of server an operational decision rather than a TypeScript
 * import. Swapping the model is an environment variable.
 */
interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export const localProvider: AiProvider = {
  location: 'local',

  async complete(request: AiRequest): Promise<AiResult> {
    // Asserted again here rather than trusted from construction: this is the
    // last point before content would go over the wire.
    if (!env.AI_LOCAL_BASE_URL) {
      throw new AiProviderError('local_not_configured', 'AI_LOCAL_BASE_URL is not set');
    }

    let response: Response;

    try {
      response = await fetch(`${env.AI_LOCAL_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'local',
          max_tokens: request.maxOutput,
          // Low but not zero: the assistant should phrase an answer naturally
          // while staying close to the retrieved material.
          temperature: 0.2,
          messages: [
            { role: 'system', content: request.system },
            ...request.messages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
          ],
        }),
      });
    } catch (error) {
      // No fallback to the external provider exists, here or anywhere: FR-008b
      // requires the assistant to become unavailable rather than cross the
      // boundary, and the customer keeps the Phase 8 route to a ticket.
      throw new AiProviderError(
        'local_unreachable',
        error instanceof Error ? error.name : 'unknown',
      );
    }

    if (!response.ok) {
      throw new AiProviderError('local_http_error', `status ${response.status}`);
    }

    let payload: ChatCompletionResponse;

    try {
      payload = (await response.json()) as ChatCompletionResponse;
    } catch {
      throw new AiProviderError('local_bad_json', 'response was not JSON');
    }

    const text = payload.choices?.[0]?.message?.content?.trim() ?? '';

    if (!text) {
      throw new AiProviderError('empty_response', 'the model returned no text');
    }

    return {
      text,
      inputTokens: payload.usage?.prompt_tokens ?? null,
      outputTokens: payload.usage?.completion_tokens ?? null,
    };
  },
};
