import { createI18n } from 'vue-i18n';

import ar from '../locales/ar.json';
import en from '../locales/en.json';

import { resolveInitialLocale } from './locale-config';

const i18n = createI18n({
  // Composition API mode.
  legacy: false,
  locale: resolveInitialLocale(),
  // Covers US3 Scenario 4: a missing or corrupted locale entry falls back to
  // English rather than rendering a raw key.
  fallbackLocale: 'en',
  messages: { en, ar },
});

export default i18n;
