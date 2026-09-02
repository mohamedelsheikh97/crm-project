import { env } from '../../config/env.js';

import { externalProvider } from './external.js';
import { AiProviderError, type AiProvider } from './types.js';

/**
 * THE EXTERNAL PROVIDER, REACHABLE ONLY FROM STAFF-FACING SERVICES.
 *
 * Importable by `ai-summary.service.ts`, `ai-draft.service.ts`, and
 * `ai-classify.service.ts`. NOT by anything under the assistant.
 *
 * This module exists so the egress boundary is a matter of WHICH FILE A SERVICE
 * IMPORTS rather than a value someone can edit (research D2, FR-008a). A
 * `provider: 'external' | 'local'` setting would satisfy the letter of "the
 * boundary exists" and fail the requirement completely: the boundary becomes a
 * string in a settings table, one careless migration away from sending customer
 * chat to a third party, with nothing failing and no error raised.
 *
 * Phase 7 recorded this argument for its `audience` literal and Phase 8 applied
 * it again. This is its third application, to the strongest boundary here.
 */
export function externalProviderFor(): AiProvider {
  if (!env.AI_EXTERNAL_API_KEY) {
    throw new AiProviderError(
      'external_not_configured',
      'AI_EXTERNAL_API_KEY is not set; env.ts should have refused to start',
    );
  }

  return externalProvider;
}
