import { createRouter, createWebHistory } from 'vue-router';

import i18n from '../i18n';
import HomeView from '../views/HomeView.vue';
import NotFoundView from '../views/NotFoundView.vue';

const router = createRouter({
  // History mode (FR-013).
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
      // An i18n key, never a literal — navigation is translatable from the
      // first route onward (frontend-shell.md).
      meta: { titleKey: 'route.home.title' },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: NotFoundView,
      meta: { titleKey: 'route.notFound.title' },
    },
  ],
});

router.afterEach((to) => {
  const titleKey = to.meta.titleKey;

  if (typeof titleKey === 'string') {
    document.title = i18n.global.t(titleKey);
  }
});

export default router;
