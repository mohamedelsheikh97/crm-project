<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import LanguageBadge from './LanguageBadge.vue';
import type { KbLanguage } from '../../services/knowledge.service';

/**
 * Reading an article (FR-055, FR-056, and the accessibility half of this phase).
 *
 * THIS IS THE FIRST SURFACE IN THIS PROJECT DESIGNED TO BE READ RATHER THAN
 * OPERATED. Every other screen is a list, a form, or a queue — things somebody
 * scans and acts on. This one is prose somebody works through while a card
 * reader is broken in front of them, and it is held on a phone.
 *
 * THE DIRECTION RULE, which is the subtle part:
 *
 *   Interface CHROME follows the INTERFACE. Navigation, buttons, labels — they
 *   inherit the document root, exactly as every phase before this one.
 *
 *   Article CONTENT follows the ARTICLE. The body carries its own `dir` and
 *   `lang`. This is NOT the per-component direction flipping Principle I
 *   prohibits: Principle I forbids a component overriding a shared root for
 *   CHROME, and this is content whose direction is a property of the text —
 *   the same argument Phase 5 made for the chat widget on a foreign page.
 *
 * Under Clarifications Q3 a one-language article is legitimate, so an English
 * article inside an Arabic help centre is normal rather than exceptional. Left
 * to inherit RTL, its paragraphs would render right-aligned with punctuation in
 * the wrong place — readable, but wrong in a way that looks like a bug.
 *
 * A REAL HEADING HIERARCHY, not styled paragraphs. That is the difference
 * between a document a screen-reader user can navigate and a wall of text they
 * must listen to from the top. Markdown-style `##` lines become `h3`s under the
 * article's `h2` title, so the outline is genuine.
 */

const props = defineProps<{
  title: string;
  body: string;
  lang: KbLanguage;
  availableLanguages: KbLanguage[];
  categoryName?: string | null;
}>();

const { t } = useI18n();

const direction = computed(() => (props.lang === 'ar' ? 'rtl' : 'ltr'));

interface Block {
  kind: 'heading' | 'paragraph' | 'code';
  text: string;
}

/**
 * Turn the stored body into blocks with real semantics.
 *
 * A deliberately small vocabulary — headings, paragraphs, and fenced code —
 * rather than full markdown. Every construct rendered is one somebody could
 * have meant; anything richer would need sanitising, and an article body is
 * text an author typed rather than markup this phase asked them to learn.
 *
 * NO HTML IS EVER INTERPRETED. The body is rendered as text through Vue's
 * interpolation, so an author who types a tag sees a tag. That removes stored
 * cross-site scripting from a surface strangers read.
 */
const blocks = computed<Block[]>(() => {
  const result: Block[] = [];
  let fenced: string[] | null = null;

  for (const line of props.body.split('\n')) {
    if (line.trim().startsWith('```')) {
      if (fenced) {
        result.push({ kind: 'code', text: fenced.join('\n') });
        fenced = null;
      } else {
        fenced = [];
      }
      continue;
    }

    if (fenced) {
      fenced.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (trimmed === '') continue;

    if (trimmed.startsWith('#')) {
      result.push({ kind: 'heading', text: trimmed.replace(/^#+\s*/, '') });
    } else {
      result.push({ kind: 'paragraph', text: trimmed });
    }
  }

  if (fenced) result.push({ kind: 'code', text: fenced.join('\n') });

  return result;
});
</script>

<template>
  <article>
    <header class="mb-4">
      <div class="flex flex-wrap items-center gap-3">
        <!--
          `dir` and `lang` from the ARTICLE, on the title as on the body. A
          title is content too.
        -->
        <h2 :lang="lang" :dir="direction" class="text-2xl font-semibold tracking-tight">
          {{ title }}
        </h2>
        <!-- Always, never conditionally. See LanguageBadge. -->
        <LanguageBadge :languages="availableLanguages" :showing="lang" />
      </div>

      <p v-if="categoryName" class="mt-1 text-sm text-slate-600">{{ categoryName }}</p>
    </header>

    <!--
      `max-w-prose` because this is READING. A line of body text running the
      width of a desktop window is measurably harder to follow, and this is the
      one screen in the project where that matters.
    -->
    <div :lang="lang" :dir="direction" class="max-w-prose space-y-4 text-base leading-relaxed">
      <template v-for="(block, index) in blocks" :key="index">
        <!-- A REAL h3, under the h2 title. Navigable, not merely bold. -->
        <h3 v-if="block.kind === 'heading'" class="text-lg font-semibold">{{ block.text }}</h3>

        <!--
          `bdi` isolates a run of text whose direction may differ from the
          paragraph around it. Latin product names and identifiers inside Arabic
          prose would otherwise reorder the sentence containing them — the same
          hazard Phase 6's countdowns had, and the reason bidirectional
          isolation is applied rather than hoped for.
        -->
        <pre
          v-else-if="block.kind === 'code'"
          dir="ltr"
          class="overflow-x-auto rounded bg-slate-100 p-3 text-sm"
        ><code>{{ block.text }}</code></pre>

        <p v-else>
          <bdi>{{ block.text }}</bdi>
        </p>
      </template>

      <p v-if="blocks.length === 0" class="text-slate-600">{{ t('kb.article.empty') }}</p>
    </div>
  </article>
</template>
