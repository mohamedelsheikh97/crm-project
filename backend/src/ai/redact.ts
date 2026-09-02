/**
 * Strips secret-shaped content before anything is transmitted for AI
 * processing (Phase 9, FR-010, SC-025).
 *
 * RUNS IN THE SHARED PATH, FOR BOTH PROVIDERS. Two decisions worth stating:
 *
 * It lives in `invoke.ts`'s path rather than in each feature, so a sixth AI
 * feature added in a later phase inherits the protection without its author
 * remembering it exists. This is research D1's argument applied to safety
 * rather than bookkeeping.
 *
 * It runs for the LOCAL provider too. "Controlled infrastructure" is a
 * boundary, not a licence to relax — and the spec's own edge case, a customer
 * pasting a card number into chat, travels the local path. A card number should
 * not be in a model's context or an inference server's log regardless of who
 * owns the hardware.
 *
 * REPLACED, NEVER DROPPED. A summary that says a number was removed is more
 * useful than one with an unexplained gap, and an agent reading `[redacted]`
 * knows to look at the thread.
 */
const MARKER = '[redacted]';

interface Rule {
  readonly name: string;
  readonly pattern: RegExp;
}

const RULES: readonly Rule[] = [
  // Provider API keys. `sk-ant-`, `sk-`, and the general long opaque token.
  { name: 'api-key', pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { name: 'bearer', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi },

  // JWTs — three base64url segments. Portal and staff tokens both match.
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },

  // key/secret/password assignments in pasted config or logs.
  {
    name: 'assignment',
    pattern: /\b(api[_-]?key|secret|password|passwd|token)\b\s*[:=]\s*\S+/gi,
  },

  // Card-shaped and national-ID-shaped digit runs. Deliberately broad: a
  // false positive costs a reader one `[redacted]` in a summary, a false
  // negative puts a card number in a third party's context window.
  { name: 'long-digits', pattern: /\b(?:\d[ -]?){13,19}\b/g },

  // bcrypt/argon hashes, in case a record is ever pasted into a thread.
  { name: 'hash', pattern: /\$(?:2[aby]|argon2[id]{1,2})\$[^\s]{16,}/g },
];

export interface RedactionResult {
  readonly text: string;
  /** Which rules fired. Recorded nowhere; used by tests and by nothing else. */
  readonly applied: readonly string[];
}

export function redact(input: string): RedactionResult {
  let text = input;
  const applied: string[] = [];

  for (const rule of RULES) {
    // `test` with a /g regex is stateful; construct a fresh one per call rather
    // than carrying lastIndex between inputs.
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);

    if (pattern.test(text)) {
      applied.push(rule.name);
      text = text.replace(new RegExp(rule.pattern.source, rule.pattern.flags), MARKER);
    }
  }

  return { text, applied };
}
