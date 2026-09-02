import { createPinia, setActivePinia } from 'pinia';
import { createApp } from 'vue';

import App from './App.vue';
import { ensureSessionRestored } from './services/auth.service';
import { applyDocumentLocale } from './composables/useDirection';
import i18n from './i18n';
import { resolveInitialLocale } from './i18n/locale-config';
import router from './router';
import './style.css';
import './assets/viz-palette.css';
import './print.css';

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

// Restore any existing session before mounting, so the first paint is already
// the right screen rather than a login form that vanishes.
//
// THE GUARD DOES NOT DEPEND ON THIS ORDERING, and must not: `app.use(router)`
// above already started the initial navigation from inside `install()`, so the
// first `beforeEach` ran before this line. Correctness lives in the guard,
// which awaits the same single-flight promise; this call only makes sure the
// work has started by the time we mount. Both share one `/auth/me`.
ensureSessionRestored().finally(() => {
  app.mount('#app');
});
