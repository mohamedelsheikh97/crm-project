import { env } from '../../config/env.js';
import { classifyHost } from '../../lib/net-address.js';

import { localProvider } from './local.js';
import { AiProviderError, type AiProvider } from './types.js';

/**
 * THE CONTROLLED-INFRASTRUCTURE PROVIDER — the only one the assistant may use.
 *
 * FAILS CLOSED (research D2). If the base URL is missing or points anywhere
 * that is not controlled infrastructure, this throws at construction rather
 * than returning a provider that would work. There is no fallback branch to the
 * external provider, here or anywhere: FR-008b requires the assistant to become
 * unavailable instead, and FR-042 keeps the customer's route to a ticket open.
 *
 * `env.ts` already refuses to start on both conditions. This is the second
 * check, on the grounds that the one which stops customer content leaving the
 * building is worth asserting twice.
 */
/**
 * Delegated to `lib/net-address.ts` (Phase 11, research D10).
 *
 * The regex this replaces did not cover link-local (`169.254.`), which is where
 * cloud metadata services live. Sharing the classifier with Phase 11's webhook
 * guard means that gap is closed in both directions at once — and the two
 * directions are opposite, so they use separately named assertions rather than a
 * shared `checkHost()` somebody could call backwards.
 */
const isPrivateHost = (host: string): boolean => classifyHost(host) === 'private';

export function localProviderFor(): AiProvider {
  if (!env.AI_LOCAL_BASE_URL) {
    throw new AiProviderError(
      'local_not_configured',
      'AI_LOCAL_BASE_URL is not set; the assistant cannot run',
    );
  }

  let host: string;

  try {
    host = new URL(env.AI_LOCAL_BASE_URL).hostname;
  } catch {
    throw new AiProviderError('local_not_configured', 'AI_LOCAL_BASE_URL is not a valid URL');
  }

  // `.internal` and `.local` are part of the classifier now, so this is one
  // call rather than three conditions that could diverge from env.ts's.
  const controlled = isPrivateHost(host);

  if (!controlled) {
    throw new AiProviderError(
      'local_not_controlled',
      'AI_LOCAL_BASE_URL is not controlled infrastructure; the assistant refuses to run',
    );
  }

  return localProvider;
}
