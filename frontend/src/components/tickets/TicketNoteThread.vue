<script setup lang="ts">
import { computed } from 'vue';

import {
  MENTION_TOKEN,
  type NoteMention,
  type TicketNote,
} from '../../services/ticket-notes.service';

/**
 * The conversation on a ticket, oldest first — so it reads as a story rather
 * than a stack, the same choice Phase 3 made for history.
 *
 * Mention tokens are rendered from each note's `mentions` array, NEVER from
 * text stored in the body. That is the whole reason the body holds
 * `@[user:12]`: a display name stored inline goes stale on rename and
 * misattributes after deactivation (FR-035, FR-041).
 */
const props = defineProps<{ notes: TicketNote[]; loading: boolean; currentUserId: number }>();

const emit = defineEmits<{ (event: 'edit', note: TicketNote): void }>();

interface Segment {
  text: string;
  mention: NoteMention | null;
}

/** Splits a body into plain text and resolved mentions, in order. */
function segments(note: TicketNote): Segment[] {
  const byId = new Map(note.mentions.map((mention) => [mention.id, mention]));
  const parts: Segment[] = [];
  let cursor = 0;

  // A fresh regex per call: /g regexes carry lastIndex between uses, and a
  // shared one would skip mentions on every second note.
  const pattern = new RegExp(MENTION_TOKEN.source, 'g');
  let match = pattern.exec(note.body);

  while (match !== null) {
    if (match.index > cursor) {
      parts.push({ text: note.body.slice(cursor, match.index), mention: null });
    }

    const mention = byId.get(Number(match[1])) ?? null;

    // An unresolvable token renders as literal text rather than vanishing: a
    // note must never silently lose a word it was written with.
    parts.push({ text: mention ? `@${mention.fullName}` : match[0], mention });

    cursor = match.index + match[0].length;
    match = pattern.exec(note.body);
  }

  if (cursor < note.body.length) {
    parts.push({ text: note.body.slice(cursor), mention: null });
  }

  return parts;
}

const hasNotes = computed(() => props.notes.length > 0);
</script>

<template>
  <section :aria-label="$t('ticketNote.title')">
    <p v-if="loading" class="py-4 text-sm text-slate-500">{{ $t('table.loading') }}</p>

    <p v-else-if="!hasNotes" class="py-4 text-sm text-slate-600 dark:text-slate-400">
      {{ $t('ticketNote.empty') }}
    </p>

    <ul v-else class="space-y-3">
      <li
        v-for="note in notes"
        :key="note.id"
        class="rounded border border-slate-200 p-3 dark:border-slate-700"
      >
        <p class="whitespace-pre-wrap break-words text-sm">
          <template v-for="(segment, index) in segments(note)" :key="index">
            <!-- A mention is visually distinguished AND names a real user
                 (FR-041). A deactivated one is marked rather than removed, so
                 the note keeps its meaning (FR-035). -->
            <span
              v-if="segment.mention"
              class="rounded bg-blue-100 px-1 font-medium text-blue-900 dark:bg-blue-900 dark:text-blue-100"
              :class="segment.mention.isActive ? '' : 'line-through opacity-75'"
              :title="segment.mention.isActive ? undefined : $t('ticketNote.mention.inactive')"
              >{{ segment.text }}</span
            >
            <template v-else>{{ segment.text }}</template>
          </template>
        </p>

        <p class="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>{{ note.author?.fullName ?? $t('audit.actor.anonymous') }}</span>
          <span v-if="note.author && !note.author.isActive">
            ({{ $t('users.status.inactive') }})
          </span>
          <i18n-d
            tag="span"
            :value="new Date(note.createdAt)"
            :format="{ dateStyle: 'medium', timeStyle: 'short' }"
          />
          <!-- Shown because a silently rewritten note is worse than no note. -->
          <span v-if="note.editedAt">· {{ $t('notes.edited') }}</span>

          <button
            v-if="note.author?.id === currentUserId"
            type="button"
            class="rounded text-blue-700 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-blue-300"
            @click="emit('edit', note)"
          >
            {{ $t('action.edit') }}
          </button>
        </p>
      </li>
    </ul>
  </section>
</template>
