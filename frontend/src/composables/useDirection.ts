import { computed, type ComputedRef } from 'vue';

import { directionFor, type Direction, type SupportedLocale } from '../i18n/locale-config';
import { useLocaleStore } from '../stores/locale.store';

export type { Direction };

/**
 * Both attributes live on <html>, never on a wrapper div: Tailwind's logical
 * utilities resolve against the root direction (FR-022, research.md D10).
 */
export function applyDocumentLocale(locale: SupportedLocale): void {
  const root = document.documentElement;
  root.lang = locale;
  root.dir = directionFor(locale);
}

export function useDirection(): {
  direction: ComputedRef<Direction>;
  isRtl: ComputedRef<boolean>;
} {
  const localeStore = useLocaleStore();

  return {
    direction: computed(() => localeStore.direction),
    isRtl: computed(() => localeStore.direction === 'rtl'),
  };
}
