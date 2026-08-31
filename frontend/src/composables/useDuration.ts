import { useI18n } from 'vue-i18n';

/**
 * FORMATTING A DURATION — Phase 6's hardest i18n problem, in one place.
 *
 * A countdown is a number, a unit, and often a direction word: "3 working hours
 * left", "متأخر بيومين". Three rules govern it, and all three are
 * non-negotiable (FR-084, Principle I):
 *
 * 1. THE SERVER NEVER FORMATS. It returns `remainingMinutes: 45` and a state.
 *    A formatted string cannot be right in two languages, and a server that
 *    formats has decided the reader's language at write time — the mistake
 *    Phase 4's notification table was designed to avoid.
 *
 * 2. THE CLIENT NEVER CONCATENATES. No `${value} ${unit}`. Every phrase is one
 *    vue-i18n message with named interpolation and pluralisation, so word order
 *    and plural forms belong to the locale file. Arabic has its own plural
 *    categories, and a concatenating client cannot express them at all.
 *
 * 3. NUMERALS FOLLOW THE LOCALE, through `Intl.NumberFormat`, in one helper
 *    rather than in every component.
 *
 * BIDIRECTIONAL ISOLATION is the fourth rule and the one most easily missed. A
 * Latin-digit number inside an Arabic sentence can reorder its surroundings,
 * producing "left 3 hours working" — a bug that looks like a translation error
 * and is a Unicode bidi one. Every number rendered inside translated prose is
 * wrapped in U+2068 FIRST STRONG ISOLATE / U+2069 POP DIRECTIONAL ISOLATE.
 */

/** U+2068 / U+2069. Isolates a run so it cannot reorder its neighbours. */
const FSI = '⁨';
const PDI = '⁩';

const MINUTES_PER_HOUR = 60;

export interface DurationParts {
  /** The i18n message key to render. */
  key: string;
  /** Named parameters, already locale-formatted and bidi-isolated. */
  params: { count: number; value: string };
}

/**
 * Choose the unit a duration reads best in, and return the KEY plus the count.
 *
 * The count is returned unformatted as well as formatted, because vue-i18n
 * needs the raw number to select a plural form — a formatted string with
 * Eastern Arabic numerals is not a number it can pluralise on.
 */
export function durationParts(minutes: number, locale: string): DurationParts {
  const absolute = Math.max(0, Math.round(minutes));

  if (absolute < MINUTES_PER_HOUR) {
    return { key: 'sla.duration.minutes', params: partsFor(absolute, locale) };
  }

  const hours = Math.round(absolute / MINUTES_PER_HOUR);

  // "Working days" rather than calendar days: an SLA day is the calendar's
  // working day, and calling it anything else would misdescribe the promise.
  if (hours < 8) {
    return { key: 'sla.duration.hours', params: partsFor(hours, locale) };
  }

  const days = Math.round(hours / 8);

  return { key: 'sla.duration.days', params: partsFor(days, locale) };
}

function partsFor(count: number, locale: string): { count: number; value: string } {
  return { count, value: isolate(formatNumber(count, locale)) };
}

/** Locale-appropriate numerals, decided in one place. */
export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

/**
 * Wrap a run so it cannot reorder the text around it.
 *
 * Exported because every number rendered inside translated prose needs it, not
 * only durations — a reference like "TKT-01042" inside an Arabic sentence has
 * exactly the same problem.
 */
export function isolate(text: string): string {
  return `${FSI}${text}${PDI}`;
}

/**
 * The composable a component uses.
 *
 * Returns rendered strings rather than parts, so no component is ever tempted
 * to assemble one itself.
 */
export function useDuration(): {
  duration: (minutes: number) => string;
  remaining: (minutes: number) => string;
  overdueBy: (minutes: number) => string;
  number: (value: number) => string;
} {
  const { t, locale } = useI18n();

  const duration = (minutes: number): string => {
    const parts = durationParts(minutes, locale.value);
    return t(parts.key, parts.params, parts.params.count);
  };

  return {
    duration,
    // Composed as ONE message with the duration interpolated, not as two
    // strings joined — "left" comes before the number in some languages.
    remaining: (minutes: number) => t('sla.remaining', { duration: duration(minutes) }),
    overdueBy: (minutes: number) => t('sla.overdueBy', { duration: duration(minutes) }),
    number: (value: number) => formatNumber(value, locale.value),
  };
}
