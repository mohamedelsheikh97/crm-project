import { describe, expect, it } from 'vitest';

import { redact } from '../../src/ai/redact.js';

/**
 * Nothing secret-shaped leaves this process (Phase 9, FR-010, SC-025).
 *
 * These are pure-function tests: redaction runs in the shared adapter path, so
 * proving the function is what proves both providers are covered. The path
 * placement itself is asserted by reading `invoke.ts`'s behaviour in
 * `budget.test.ts`.
 */
describe('redaction strips secret-shaped content', () => {
  it('removes an Anthropic-style API key', () => {
    const { text } = redact('the key is sk-ant-api03-abcdefghijklmnop1234 here');

    expect(text).not.toContain('sk-ant-api03');
    expect(text).toContain('[redacted]');
  });

  it('removes a bearer token', () => {
    const { text } = redact('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456');

    expect(text).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
  });

  it('removes a JWT', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

    expect(redact(`token=${jwt}`).text).not.toContain('dozjgNryP4J3');
  });

  it('removes a card-shaped number', () => {
    const { text } = redact('my card is 4111 1111 1111 1111 please help');

    expect(text).not.toContain('4111');
    expect(text).toContain('[redacted]');
  });

  it('removes a password assignment', () => {
    expect(redact('password: hunter2seventeen').text).not.toContain('hunter2seventeen');
  });

  it('removes a bcrypt hash', () => {
    const hash = '$2b$12$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';

    expect(redact(`hash ${hash}`).text).not.toContain('abcdefghijklmnop');
  });

  it('REPLACES rather than drops, so a reader knows something was removed', () => {
    const { text } = redact('the card 4111111111111111 was declined');

    // The surrounding sentence survives — a summary with an unexplained gap is
    // worse than one that says a number was removed.
    expect(text).toContain('the card');
    expect(text).toContain('was declined');
    expect(text).toContain('[redacted]');
  });

  it('leaves ordinary support text untouched', () => {
    const ordinary =
      'The customer reports that order 4471 has not arrived and would like an update.';

    expect(redact(ordinary).text).toBe(ordinary);
  });

  it('leaves Arabic text untouched', () => {
    const arabic = 'العميل يقول إن الطلب لم يصل بعد ويريد تحديثاً للحالة.';

    expect(redact(arabic).text).toBe(arabic);
  });

  it('reports which rules fired, for the tests and for nobody else', () => {
    const { applied } = redact('sk-ant-api03-abcdefghijklmnop1234 and 4111 1111 1111 1111');

    expect(applied).toContain('api-key');
    expect(applied).toContain('long-digits');
  });
});
