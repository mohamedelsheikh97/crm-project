/**
 * What SMS actually costs and permits, kept in one place because both the
 * gateway adapter and the simulator must agree — and because the composer shows
 * it to an agent BEFORE they send (FR-063).
 */

const GSM7_SINGLE = 160;
const GSM7_MULTI = 153;
const UCS2_SINGLE = 70;
const UCS2_MULTI = 67;

/**
 * Arabic is not representable in the GSM 7-bit alphabet, so every Arabic
 * message is UCS-2 and fits 70 characters rather than 160. In a bilingual
 * product that is not an edge case — it is half the traffic, and an agent
 * writing in Arabic needs to see a limit that reflects it.
 */
const GSM7 = /^[A-Za-z0-9@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà \r\n]*$/;

export interface Segmentation {
  characters: number;
  segments: number;
  encoding: 'gsm7' | 'ucs2';
  /** Characters left in the current segment. */
  remaining: number;
}

export function segmentsFor(body: string): Segmentation {
  const encoding = GSM7.test(body) ? 'gsm7' : 'ucs2';
  const single = encoding === 'gsm7' ? GSM7_SINGLE : UCS2_SINGLE;
  const multi = encoding === 'gsm7' ? GSM7_MULTI : UCS2_MULTI;

  const characters = [...body].length;

  if (characters === 0) {
    return { characters: 0, segments: 0, encoding, remaining: single };
  }

  const segments = characters <= single ? 1 : Math.ceil(characters / multi);
  const capacity = segments === 1 ? single : segments * multi;

  return { characters, segments, encoding, remaining: capacity - characters };
}

/**
 * The standard opt-out keywords (FR-065).
 *
 * Matched on the WHOLE trimmed message, not as a substring: a customer writing
 * "please stop sending me the wrong invoice" is asking a question, not
 * unsubscribing, and treating it as an opt-out would silence a live complaint.
 */
const OPT_OUT_KEYWORDS = new Set([
  'stop',
  'stopall',
  'unsubscribe',
  'cancel',
  'end',
  'quit',
  // The Arabic equivalents customers here actually send.
  'الغاء',
  'إلغاء',
  'توقف',
]);

export function isOptOutKeyword(body: string): boolean {
  return OPT_OUT_KEYWORDS.has(body.trim().toLowerCase());
}
