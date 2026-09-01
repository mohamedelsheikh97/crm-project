<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import DefaultLayout from './layouts/DefaultLayout.vue';

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
const route = useRoute();
const bare = computed(() => route.meta.publicShell === true);
</script>

<template>
  <RouterView v-if="bare" />

  <DefaultLayout v-else>
    <RouterView />
  </DefaultLayout>
</template>
