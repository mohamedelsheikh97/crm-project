<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import DefaultLayout from './layouts/DefaultLayout.vue';
import PortalLayout from './layouts/PortalLayout.vue';

/**
 * Phase 7 gives this component its first decision.
 *
 * The public help centre renders OUTSIDE the authenticated application shell
 * (User Story 4): no navigation into signed-in areas, no user menu, no
 * notification bell, nothing that implies an account exists. A customer looking
 * up a card reader fault is not a user of this system and must not be shown a
 * door they cannot open.
 *
 * Driven by route meta rather than by a path prefix, so the rule travels with
 * the route declaration where a reader of the router will meet it — and so a
 * later public surface opts in explicitly rather than by being named `/help`.
 */
/**
 * Phase 8 gives it a second, and the branch is now three-way.
 *
 * The customer portal is AUTHENTICATED but is not the staff application: it needs
 * a shell with a sign-out control, a language switch, and customer navigation,
 * and it must show no staff navigation and no permission-derived menu (FR-063).
 * Neither existing branch fits — `publicShell` has no session controls at all,
 * and `DefaultLayout` is the thing being kept away from customers.
 *
 * Driven by route meta for the same reason Phase 7 chose it over a path prefix.
 */
const route = useRoute();
const bare = computed(() => route.meta.publicShell === true);
const portal = computed(() => route.meta.portalShell === true);
</script>

<template>
  <RouterView v-if="bare" />

  <PortalLayout v-else-if="portal">
    <RouterView />
  </PortalLayout>

  <DefaultLayout v-else>
    <RouterView />
  </DefaultLayout>
</template>
