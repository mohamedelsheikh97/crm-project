import { createPinia } from 'pinia';
import { mount, type ComponentMountingOptions } from '@vue/test-utils';
import type { Component } from 'vue';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router';

import ar from '../../src/locales/ar.json';
import en from '../../src/locales/en.json';

const defaultRoutes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: { template: '<div/>' } },
];

/**
 * Installs the same plugins main.ts does, so a component test does not have to
 * reassemble them. Memory history keeps the router out of the URL bar.
 */
export function mountWithPlugins<C extends Component>(
  component: C,
  options: ComponentMountingOptions<C> & { locale?: 'en' | 'ar'; routes?: RouteRecordRaw[] } = {},
) {
  const { locale = 'en', routes = defaultRoutes, global = {}, ...rest } = options;

  const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: { en, ar } });
  const router = createRouter({ history: createMemoryHistory(), routes });

  return mount(component, {
    ...rest,
    global: {
      ...global,
      plugins: [createPinia(), i18n, router, ...(global.plugins ?? [])],
    },
  } as ComponentMountingOptions<C>);
}
