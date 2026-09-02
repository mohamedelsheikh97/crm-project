import { env } from '../../config/env.js';

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
const PRIVATE_HOST =
  /^(localhost|::1|127\..*|10\..*|192\.168\..*|172\.(1[6-9]|2\d|3[01])\..*)$/;

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

  const controlled =
    PRIVATE_HOST.test(host) || host.endsWith('.internal') || host.endsWith('.local');

  if (!controlled) {
    throw new AiProviderError(
      'local_not_controlled',
      'AI_LOCAL_BASE_URL is not controlled infrastructure; the assistant refuses to run',
    );
  }

  return localProvider;
}
