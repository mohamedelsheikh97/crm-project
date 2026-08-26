import { createPinia, setActivePinia } from 'pinia';
import { createApp } from 'vue';

import App from './App.vue';
import { restoreSession } from './services/auth.service';
import { applyDocumentLocale } from './composables/useDirection';
import i18n from './i18n';
import { resolveInitialLocale } from './i18n/locale-config';
import router from './router';
import './style.css';

const app = createApp(App);

// Order matters: Pinia before any store is used, and the locale applied before
// mount so the first paint is already in the right direction (FR-014, D11).
const pinia = createPinia();
app.use(pinia);
// restoreSession() runs outside any component, so the active Pinia must be set
// explicitly rather than relying on app.use having done it.
setActivePinia(pinia);
app.use(i18n);
app.use(router);

applyDocumentLocale(resolveInitialLocale());

// Restore any existing session BEFORE mounting, so the first route guard sees
// the real authentication state. Mounting first would bounce a signed-in user
// to the login screen for the moment it takes /auth/me to answer.
restoreSession().finally(() => {
  app.mount('#app');
});
