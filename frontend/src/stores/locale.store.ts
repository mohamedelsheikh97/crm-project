import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { applyDocumentLocale } from '../composables/useDirection';
import i18n from '../i18n';
import {
  LOCALE_STORAGE_KEY,
  directionFor,
  isSupportedLocale,
  resolveInitialLocale,
  type Direction,
  type SupportedLocale,
} from '../i18n/locale-config';

export {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  resolveInitialLocale,
  type SupportedLocale,
} from '../i18n/locale-config';

export const useLocaleStore = defineStore('locale', () => {
  const locale = ref<SupportedLocale>(resolveInitialLocale());

  const direction = computed<Direction>(() => directionFor(locale.value));

  function setLocale(next: SupportedLocale): void {
    if (!isSupportedLocale(next)) {
      return;
    }

    locale.value = next;

    try {
      // Only the locale code is persisted — nothing else (frontend-shell.md).
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // A failed write must not break the switch itself.
    }

    i18n.global.locale.value = next;
    applyDocumentLocale(next);
  }

  return { locale, direction, setLocale };
});
