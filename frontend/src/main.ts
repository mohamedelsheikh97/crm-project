import { createPinia } from 'pinia';
import { createApp } from 'vue';

import App from './App.vue';
import { applyDocumentLocale } from './composables/useDirection';
import i18n from './i18n';
import { resolveInitialLocale } from './i18n/locale-config';
import router from './router';
import './style.css';

const app = createApp(App);

// Order matters: Pinia before any store is used, and the locale applied before
// mount so the first paint is already in the right direction (FR-014, D11).
app.use(createPinia());
app.use(i18n);
app.use(router);

applyDocumentLocale(resolveInitialLocale());

app.mount('#app');
