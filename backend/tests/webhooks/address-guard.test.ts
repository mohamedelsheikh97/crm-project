import { describe, expect, it } from 'vitest';

import {
  AddressNotPermittedError,
  assertControlledInfrastructure,
  assertPubliclyRoutable,
  classifyHost,
  hostOf,
} from '../../src/lib/net-address.js';

/**
 * Both directions of the address rule, over ONE host list (Phase 11, FR-034,
 * SC-015, research D10).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS CODEBASE HAS TWO OPPOSITE RULES ABOUT OUTBOUND ADDRESSES.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   PHASE 9  — the customer-facing AI processor MUST be private. A public
 *              address there sends customer chat offsite.
 *   PHASE 11 — a webhook receiver MUST be public. A private address there makes
 *              this server probe its own network and report to whoever
 *              configured the subscription.
 *
 * A test that checked only one direction would pass while the other was
 * reversed, and a reversal is the specific mistake two opposite rules invite.
 * So every host below is asserted TWICE — once for each requirement — from the
 * same table. If somebody swaps the assertions, both halves fail rather than one
 * quietly agreeing.
 *
 * The complement matters as much as the check: a guard that refuses everything
 * passes every "must refuse" assertion, so each direction also asserts what it
 * must ACCEPT.
 */
const HOSTS: ReadonlyArray<{ url: string; expected: 'private' | 'public'; why: string }> = [
  { url: 'http://localhost:4567/hook', expected: 'private', why: 'loopback by name' },
  { url: 'http://127.0.0.1/hook', expected: 'private', why: 'loopback' },
  { url: 'http://127.5.5.5/hook', expected: 'private', why: 'the whole 127/8 block' },
  { url: 'http://[::1]/hook', expected: 'private', why: 'IPv6 loopback' },
  { url: 'http://10.0.0.5/hook', expected: 'private', why: 'RFC1918 10/8' },
  { url: 'http://192.168.1.10/hook', expected: 'private', why: 'RFC1918 192.168/16' },
  { url: 'http://172.16.0.1/hook', expected: 'private', why: 'RFC1918 172.16/12 lower bound' },
  { url: 'http://172.31.255.254/hook', expected: 'private', why: 'RFC1918 172.16/12 upper bound' },
  {
    url: 'http://169.254.169.254/latest/meta-data/',
    expected: 'private',
    /**
     * THE ONE THAT MATTERS MOST, and the one a guard written from memory misses.
     *
     * Link-local is not an RFC1918 range, so a check listing only "the private
     * ranges" lets it through — and this exact address is the cloud metadata
     * endpoint, which is the single most valuable target for a server-side
     * request forgery. The regex this classifier replaced in
     * `ai/providers/local-factory.ts` did not cover it.
     */
    why: 'link-local — the cloud metadata address',
  },
  { url: 'http://0.0.0.0/hook', expected: 'private', why: '0/8 reaches the local host' },
  { url: 'http://api.acme.internal/hook', expected: 'private', why: '.internal suffix' },
  { url: 'http://printer.local/hook', expected: 'private', why: '.local suffix' },
  { url: 'http://[fd00::1]/hook', expected: 'private', why: 'IPv6 unique-local' },
  { url: 'http://[fe80::1]/hook', expected: 'private', why: 'IPv6 link-local' },

  { url: 'https://hooks.example.com/incoming', expected: 'public', why: 'ordinary public host' },
  { url: 'https://8.8.8.8/hook', expected: 'public', why: 'a public IP literal' },
  { url: 'https://172.15.0.1/hook', expected: 'public', why: 'just below the 172.16/12 block' },
  { url: 'https://172.32.0.1/hook', expected: 'public', why: 'just above the 172.16/12 block' },
  { url: 'https://11.0.0.1/hook', expected: 'public', why: 'adjacent to 10/8 and not in it' },
];

describe('the shared host classifier', () => {
  it.each([...HOSTS])('classifies $url as $expected ($why)', ({ url, expected }) => {
    expect(classifyHost(hostOf(url))).toBe(expected);
  });

  it('treats an unparseable URL as unresolvable rather than guessing', () => {
    // Its own answer, because the two callers want opposite defaults and
    // neither should get a silent guess. Both refuse — for reasons they state
    // differently.
    expect(hostOf('not a url')).toBeNull();
    expect(classifyHost(hostOf('not a url'))).toBe('unresolvable');
    expect(classifyHost('')).toBe('unresolvable');
    expect(classifyHost(undefined)).toBe('unresolvable');
  });
});

describe('PHASE 11 direction — a webhook receiver must be publicly routable', () => {
  const privateHosts = HOSTS.filter((host) => host.expected === 'private');
  const publicHosts = HOSTS.filter((host) => host.expected === 'public');

  it('has both kinds of host to test, so neither half passes vacuously', () => {
    expect(privateHosts.length).toBeGreaterThan(5);
    expect(publicHosts.length).toBeGreaterThan(2);
  });

  it.each([...privateHosts])('REFUSES $url ($why)', ({ url }) => {
    expect(() => assertPubliclyRoutable(url, 'url')).toThrow(AddressNotPermittedError);
  });

  it.each([...publicHosts])('ACCEPTS $url ($why)', ({ url }) => {
    // The complement. A guard that refused everything would pass every
    // assertion above.
    expect(() => assertPubliclyRoutable(url, 'url')).not.toThrow();
  });

  it('refuses plain HTTP even for a public host', () => {
    /**
     * A signature carried over plain HTTP can be read and reused, which makes
     * the signature worthless — so HTTPS is part of the same assertion rather
     * than a separate check somebody could forget.
     */
    expect(() => assertPubliclyRoutable('http://hooks.example.com/incoming', 'url')).toThrow(
      /HTTPS/,
    );
  });

  it('states WHY it refused, so an administrator can act on it', () => {
    try {
      assertPubliclyRoutable('https://169.254.169.254/', 'url');
      throw new Error('should have refused');
    } catch (caught) {
      expect(caught).toBeInstanceOf(AddressNotPermittedError);
      expect((caught as AddressNotPermittedError).reason).toBe('private');
      expect((caught as Error).message).toMatch(/publicly routable/);
    }
  });
});

describe('PHASE 9 direction — the AI processor must be controlled infrastructure', () => {
  const privateHosts = HOSTS.filter((host) => host.expected === 'private');
  const publicHosts = HOSTS.filter((host) => host.expected === 'public');

  it.each([...privateHosts])('ACCEPTS $url ($why)', ({ url }) => {
    expect(() => assertControlledInfrastructure(url, 'AI_LOCAL_BASE_URL')).not.toThrow();
  });

  it.each([...publicHosts])('REFUSES $url ($why)', ({ url }) => {
    expect(() => assertControlledInfrastructure(url, 'AI_LOCAL_BASE_URL')).toThrow(
      AddressNotPermittedError,
    );
  });

  it('still refuses an unparseable URL', () => {
    // Phase 9's original comment: "an unparseable URL is not controlled
    // infrastructure". Preserved through the refactor.
    expect(() => assertControlledInfrastructure('nonsense', 'AI_LOCAL_BASE_URL')).toThrow();
  });
});

describe('the two assertions are genuinely opposite', () => {
  it('accepts exactly what the other refuses, over the whole list', () => {
    /**
     * THE ASSERTION THAT CATCHES A REVERSAL.
     *
     * For every host, exactly one of the two assertions passes. If somebody
     * swaps the implementations — or writes a shared `checkHost()` and calls it
     * with the wrong expectation — this fails on every row rather than on none.
     */
    for (const { url, why } of HOSTS) {
      const publicOk = (() => {
        try {
          // Compare on classification alone: the HTTPS requirement is Phase 11's
          // own and would otherwise make every `http://` host fail both.
          return classifyHost(hostOf(url)) === 'public';
        } catch {
          return false;
        }
      })();

      const controlledOk = (() => {
        try {
          assertControlledInfrastructure(url, 'url');
          return true;
        } catch {
          return false;
        }
      })();

      expect(publicOk, `${url} (${why}) satisfied both or neither`).toBe(!controlledOk);
    }
  });
});
