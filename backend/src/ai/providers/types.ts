import type { AiFeatureKey } from '../features.js';

/**
 * The AI provider boundary (research D1, contracts/provider-contract.md).
 *
 * One interface, two implementations, and NOTHING ELSE crosses it. `channels/`
 * is the precedent: `ChannelAdapter` with six implementations and a registry,
 * which is what buys every channel identity resolution, threading, and the
 * ledger for free rather than per-channel.
 *
 * WHAT IS DELIBERATELY ABSENT: no model id, no temperature, no provider name,
 * no streaming handle, no tool definitions. Those are implementation concerns,
 * and a service able to set them would be a service able to change where and
 * how customer content is processed — which is exactly the decision the caller
 * must not make (FR-008a).
 */
export type AiLocation = 'external' | 'local';

export interface AiMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface AiRequest {
  readonly feature: AiFeatureKey;
  /**
   * The stable, per-language constant for this feature. It is a CONSTANT: no
   * runtime string from any request is interpolated into it, which is what
   * makes customer input data rather than instructions (FR-039).
   */
  readonly system: string;
  readonly messages: readonly AiMessage[];
  readonly maxOutput: number;
  /**
   * The language the model should WRITE IN — derived from the material, not
   * from the reader's interface locale (research D9, FR-057).
   *
   * Named `contentLang` rather than `lang` on purpose. A single `lang` threaded
   * through both concerns is how content language and interface language
   * silently become one, and the resulting bug — the customer's Arabic words
   * returned as English — looks like correct i18n to a reviewer who does not
   * read Arabic.
   */
  readonly contentLang: 'ar' | 'en';
}

export interface AiResult {
  readonly text: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

export interface AiProvider {
  readonly location: AiLocation;
  complete(request: AiRequest): Promise<AiResult>;
}

/**
 * Thrown when a provider cannot produce usable output.
 *
 * Carries a CODE, never the provider's own message: a provider message can
 * echo the submitted content back, and FR-065 forbids storing that anywhere.
 */
export class AiProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}
