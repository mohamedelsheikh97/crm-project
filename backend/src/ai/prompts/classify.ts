import { TICKET_CATEGORIES } from '../../tickets/taxonomy.js';
import type { AiMessage } from '../providers/types.js';

/**
 * The classification prompt (Phase 9, US4).
 *
 * CONSTRAINED TO THE EXISTING FOUR CATEGORIES, read from
 * `tickets/taxonomy.ts` rather than restated here. Phase 3 owns the taxonomy;
 * a second list in a prompt file would drift, and the drift would show up as a
 * proposal for a category the ticket cannot hold.
 *
 * SUBJECT AND FIRST INBOUND MESSAGE ONLY (contracts/grounding-contract.md). The
 * rest of the thread is a conversation about the problem, not a statement of
 * what kind of problem it is — and including it would mean reclassifying a
 * ticket on every reply, which is not what FR-044 asks for.
 *
 * ASKS FOR JSON AND A CONFIDENCE. The service treats an unparseable response,
 * an unknown category, or a low confidence identically: NO PROPOSAL (FR-048).
 * An absent proposal is a valid outcome, and it is the one this prompt should
 * produce whenever the content does not actually say.
 */
export interface ClassifyInput {
  readonly subject: string;
  readonly firstMessage: string | null;
}

const CATEGORY_LIST = TICKET_CATEGORIES.join(', ');

/**
 * One constant, in English, for both languages.
 *
 * This is the one prompt in the phase that is NOT bilingual, and the reason is
 * that its output is not prose: it returns a category key from a fixed English
 * list plus a number. The ticket content it reads may be in either language —
 * the models handle that — but there is no Arabic version of the word
 * `billing` as a database value, so a second prompt would differ only in its
 * instructions while producing identical output. FR-057 governs generated
 * CONTENT; a category key is not content.
 */
const SYSTEM = [
  'You classify incoming customer support tickets. The ticket may be written in',
  'English or Arabic; classify it either way.',
  '',
  `Choose exactly one category from this list: ${CATEGORY_LIST}.`,
  '',
  'Respond with JSON only, in this exact shape and nothing else:',
  '{"category": "<one of the list>", "confidence": <number between 0 and 1>}',
  '',
  'Set confidence to how clearly the ticket indicates that category. If the',
  'ticket is vague, mixed, or could reasonably be several of them, give a LOW',
  'confidence — a low score is more useful than a confident guess, because a',
  'human reviews these and a wrong one wastes their attention.',
].join('\n');

export function system(): string {
  return SYSTEM;
}

export function messages(input: ClassifyInput): AiMessage[] {
  const parts = [`Subject: ${input.subject}`];

  if (input.firstMessage) {
    parts.push('', 'First message:', input.firstMessage);
  }

  return [{ role: 'user', content: parts.join('\n') }];
}

export interface Classification {
  readonly category: string;
  readonly confidence: number;
}

/**
 * Parses the response, refusing anything that is not exactly what was asked
 * for.
 *
 * Returns `null` rather than throwing, because every failure here has the same
 * remedy: make no proposal. A malformed response, an invented category, and a
 * missing confidence are all "the system does not know", and FR-048 says that
 * is a valid outcome rather than an error to surface.
 */
export function parse(text: string): Classification | null {
  const match = text.match(/\{[^}]*\}/);
  if (!match) return null;

  let parsed: unknown;

  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;

  const { category, confidence } = parsed as { category?: unknown; confidence?: unknown };

  if (typeof category !== 'string') return null;
  if (!(TICKET_CATEGORIES as readonly string[]).includes(category)) return null;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return null;
  if (confidence < 0 || confidence > 1) return null;

  return { category, confidence };
}
