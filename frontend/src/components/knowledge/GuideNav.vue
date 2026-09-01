<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * Where the reader is in a guide, and how to move (FR-011c).
 *
 * LINKS, NOT A "CONTINUE" BUTTON. A continue button hides where the reader is:
 * it tells them there is more without telling them how much, and gives them no
 * way back. Somebody halfway through a five-step setup needs to know they are
 * halfway through a five-step setup — that is the difference between following
 * instructions and being led.
 *
 * So this renders the position in words AND offers both directions, and it
 * appears above and below the article rather than only at the end. A reader who
 * arrives at step 4 from a search result should learn immediately that steps
 * 1-3 exist.
 */

const props = defineProps<{
  /** 1-based, as the reader counts. */
  position: number;
  total: number;
  previous: { slug: string; title: string } | null;
  next: { slug: string; title: string } | null;
  /** Route name to build links against, so this works on both surfaces. */
  routeName: string;
}>();

const { t } = useI18n();

const positionLabel = computed(() =>
  t('kb.guide.position', { position: props.position, total: props.total }),
);
</script>

<template>
  <nav :aria-label="t('kb.guide.nav')" class="flex flex-wrap items-center justify-between gap-3">
    <!--
      A live region is wrong here (the position does not change under the
      reader), but the position must be readable text rather than a progress bar
      alone — a bar with no number is a shape, not information.
    -->
    <p class="text-sm font-medium text-slate-700">{{ positionLabel }}</p>

    <div class="flex flex-wrap items-center gap-4 text-sm">
      <!--
        Both directions, always rendered when they exist. The titles are shown
        rather than "previous"/"next" alone, because a reader deciding whether
        to go back wants to know what is back there.
      -->
      <RouterLink
        v-if="previous"
        :to="{ name: routeName, params: { slug: previous.slug } }"
        class="underline"
      >
        <span aria-hidden="true">←</span>
        {{ t('kb.guide.previous', { title: previous.title }) }}
      </RouterLink>

      <RouterLink
        v-if="next"
        :to="{ name: routeName, params: { slug: next.slug } }"
        class="underline"
      >
        {{ t('kb.guide.next', { title: next.title }) }}
        <span aria-hidden="true">→</span>
      </RouterLink>

      <!--
        The end of a guide is worth saying. A reader who reaches the last step
        and sees nothing cannot tell whether they finished or the page broke.
      -->
      <span v-if="!next" class="text-slate-600">{{ t('kb.guide.last') }}</span>
    </div>
  </nav>
</template>
