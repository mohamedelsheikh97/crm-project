/**
 * ONE HOST CLASSIFIER, TWO CALL SITES WITH OPPOSITE REQUIREMENTS.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * READ THIS BEFORE USING EITHER ASSERTION. THEY ARE NOT INTERCHANGEABLE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This codebase contains two rules about outbound addresses, and they are the
 * inverse of each other:
 *
 *   PHASE 9 — the customer-facing AI processor MUST be on a private address.
 *   A public one would mean customer chat leaving for a third party, which the
 *   constitution's AI processing boundary forbids structurally. Use
 *   `assertControlledInfrastructure`.
 *
 *   PHASE 11 — a webhook receiver MUST be on a public address. A private one
 *   turns delivery into a way to make this server probe its own network and
 *   report the results to whoever configured the subscription — a cloud
 *   metadata endpoint being the usual target. Use `assertPubliclyRoutable`.
 *
 * They share the CLASSIFICATION because the address ranges are the same facts,
 * and a fix to those facts should reach both. They deliberately do NOT share an
 * assertion: a helper called `checkHost()` is precisely the thing somebody would
 * call with the wrong expectation, and the direction is in each name so a
 * mistake reads wrong at the call site rather than looking fine.
 *
 * `backend/tests/webhooks/address-guard.test.ts` asserts BOTH directions over
 * the same host list, so a reversal fails loudly instead of passing one of them.
 */

/**
 * Loopback, RFC1918, link-local and the two conventional internal suffixes.
 *
 * `169.254.` matters more than the others despite looking obscure: it is where
 * cloud metadata services live (`169.254.169.254`), and it is the single most
 * valuable target for a server-side request forgery. It is not covered by any
 * RFC1918 range, so a guard that checks only "the private ranges" misses it.
 */
function isPrivateHost(host: string): boolean {
  const lowered = host.trim().toLowerCase();

  if (lowered === '') return true;

  if (lowered === 'localhost' || lowered === '::1' || lowered === '[::1]') return true;

  // IPv6 unique-local (fc00::/7) and loopback, including bracketed forms.
  const unbracketed = lowered.replace(/^\[|\]$/g, '');
  if (/^f[cd][0-9a-f]{2}:/.test(unbracketed)) return true;
  if (/^fe80:/.test(unbracketed)) return true;

  if (/^127\./.test(lowered)) return true;
  if (/^10\./.test(lowered)) return true;
  if (/^192\.168\./.test(lowered)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(lowered)) return true;
  // Link-local, including the cloud metadata address.
  if (/^169\.254\./.test(lowered)) return true;
  // 0.0.0.0/8 — "this network". Reaches the local host on several stacks.
  if (/^0\./.test(lowered)) return true;

  if (lowered.endsWith('.internal') || lowered.endsWith('.local')) return true;

  return false;
}

export type HostClass = 'private' | 'public' | 'unresolvable';

/**
 * Classifies a host taken from a URL.
 *
 * `unresolvable` is its own answer rather than being folded into one of the
 * others, because the two callers want opposite defaults and neither should get
 * a silent guess: Phase 9 treats it as not-controlled (refuse), Phase 11 treats
 * it as not-public (refuse). Both refuse, but for reasons they state
 * differently, and collapsing it would make one of them lie.
 */
export function classifyHost(host: unknown): HostClass {
  if (typeof host !== 'string' || host.trim() === '') return 'unresolvable';

  return isPrivateHost(host) ? 'private' : 'public';
}

/** Pulls the hostname out of a URL, or `null` if it is not a URL at all. */
export function hostOf(url: unknown): string | null {
  if (typeof url !== 'string' || url.trim() === '') return null;

  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export class AddressNotPermittedError extends Error {
  constructor(
    readonly reason: 'private' | 'public' | 'unresolvable' | 'not_https',
    message: string,
  ) {
    super(message);
    this.name = 'AddressNotPermittedError';
  }
}

/**
 * PHASE 9 DIRECTION — the address must be on infrastructure the organisation
 * controls.
 *
 * Used for the customer-facing AI processor. A public endpoint here would send
 * customer conversation offsite, which the constitution's AI processing boundary
 * makes a governance matter rather than a configuration one.
 */
export function assertControlledInfrastructure(url: unknown, field: string): void {
  const host = hostOf(url);
  const verdict = classifyHost(host);

  if (verdict === 'private') return;

  throw new AddressNotPermittedError(
    verdict,
    `${field} must resolve to controlled infrastructure (loopback, RFC1918, .internal or .local). ` +
      'The customer-facing assistant must not reach a public endpoint.',
  );
}

/**
 * PHASE 11 DIRECTION — the address must be somewhere on the public internet.
 *
 * Used for webhook receivers. A private address here turns delivery into a
 * server-side request forgery primitive: the subscriber names an internal
 * address, this server fetches it, and the response comes back to them.
 *
 * ALSO REQUIRES HTTPS. A plain-HTTP receiver would carry the signature and the
 * payload over the network in the clear, and the signature is only worth having
 * if it cannot be read and reused.
 *
 * CALL THIS AT DELIVERY TIME AS WELL AS AT SAVE TIME. A hostname that resolved
 * publicly when saved can be repointed at 127.0.0.1 afterwards — that is DNS
 * rebinding, and a save-time-only check does not see it.
 */
export function assertPubliclyRoutable(url: unknown, field: string): void {
  const host = hostOf(url);

  if (host === null) {
    throw new AddressNotPermittedError('unresolvable', `${field} is not a valid URL.`);
  }

  if (typeof url === 'string' && !url.toLowerCase().startsWith('https://')) {
    throw new AddressNotPermittedError(
      'not_https',
      `${field} must use HTTPS. A signature sent over plain HTTP can be read and reused.`,
    );
  }

  const verdict = classifyHost(host);

  if (verdict === 'public') return;

  throw new AddressNotPermittedError(
    verdict,
    `${field} must be publicly routable. Loopback, private, link-local and internal addresses ` +
      'are refused, because delivering to one would make this server probe its own network ' +
      "on the subscriber's behalf.",
  );
}
