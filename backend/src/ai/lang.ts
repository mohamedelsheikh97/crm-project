/**
 * Which language generated content should be WRITTEN IN (Phase 9, research D9,
 * FR-057).
 *
 * `contentLang` is NOT the reader's interface locale, and the two are named
 * separately throughout this phase so they cannot quietly become one. A single
 * `lang` threaded through both concerns is how the customer's Arabic words come
 * back as English — and the resulting bug looks like correct i18n to a reviewer
 * who does not read Arabic.
 *
 * The rule: content follows the SOURCE, chrome follows the READER.
 */
export type ContentLang = 'ar' | 'en';

/**
 * Arabic script ranges, as NUMERIC CODE POINTS rather than a character class.
 *
 * A literal `/[...]/` class covering these ranges contains invisible marks —
 * U+061C ARABIC LETTER MARK sits inside the main block — which are unreadable
 * in a diff, survive copy-paste into other files, and are rejected by lint as
 * irregular whitespace. Numbers are the only form a reviewer can actually
 * check.
 *
 * Deliberately does not distinguish Arabic from Persian or Urdu: this system
 * supports two languages, so the only question is Arabic script or Latin.
 */
const ARABIC_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0600, 0x06ff], // Arabic
  [0x0750, 0x077f], // Arabic Supplement
  [0xfb50, 0xfdff], // Arabic Presentation Forms-A
  [0xfe70, 0xfeff], // Arabic Presentation Forms-B
];

function isArabic(codePoint: number): boolean {
  return ARABIC_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high);
}

function isLatinLetter(codePoint: number): boolean {
  return (codePoint >= 0x41 && codePoint <= 0x5a) || (codePoint >= 0x61 && codePoint <= 0x7a);
}

/**
 * The predominant language of a body of text.
 *
 * COUNTS CHARACTERS RATHER THAN GUESSING FROM THE FIRST ONE. Mixed threads are
 * normal here — a customer writing Arabic and an agent replying in English —
 * and a first-character heuristic would flip the summary's language based on
 * whoever happened to send the most recent message.
 *
 * Ties go to English only because something must, and an English summary of a
 * genuinely half-and-half thread is the less surprising default for an agent
 * team whose interface language is configurable.
 */
export function predominantLang(text: string): ContentLang {
  let arabic = 0;
  let latin = 0;

  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;

    if (isArabic(codePoint)) arabic += 1;
    else if (isLatinLetter(codePoint)) latin += 1;
  }

  return arabic > latin ? 'ar' : 'en';
}

/**
 * The language of a whole conversation, weighted toward what the CUSTOMER
 * wrote.
 *
 * An agent may reply in English to an Arabic customer — Phase 5 permits it and
 * it happens. Summarising that thread in English because the agent's replies
 * were longer would hand the next agent a translation of the customer's words
 * that nobody labelled, which is exactly what FR-057 forbids.
 */
export function conversationLang(
  messages: ReadonlyArray<{ direction: 'inbound' | 'outbound'; body: string }>,
): ContentLang {
  const inbound = messages.filter((message) => message.direction === 'inbound');
  const source = (inbound.length > 0 ? inbound : messages).map((m) => m.body).join(' ');

  return predominantLang(source);
}
