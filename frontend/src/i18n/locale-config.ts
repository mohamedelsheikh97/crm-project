/**
 * Locale primitives with no Vue or Pinia dependency, so both the i18n instance
 * and the locale store can read them without importing each other.
 */
export const SUPPORTED_LOCALES = ['en', 'ar'] as const;
export const LOCALE_STORAGE_KEY = 'crm.locale';

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type Direction = 'ltr' | 'rtl';

export const DEFAULT_LOCALE: SupportedLocale = 'en';

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function directionFor(locale: SupportedLocale): Direction {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/**
 * Reads the persisted choice, validating it — anything unrecognised falls back
 * to English. Storage access is guarded for private-browsing failures.
 */
export function resolveInitialLocale(): SupportedLocale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);

    if (isSupportedLocale(stored)) {
      return stored;
    }
  } catch {
    // Storage unavailable (private browsing, blocked cookies) — use the default.
  }

  return DEFAULT_LOCALE;
}
