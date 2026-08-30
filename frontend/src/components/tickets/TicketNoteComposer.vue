<script setup lang="ts">
import { computed, ref } from 'vue';

import { ApiError } from '../../services/http';
import type { NoteMention } from '../../services/ticket-notes.service';
import type { ReplyTemplate } from '../../services/templates.service';
import MentionPicker from './MentionPicker.vue';
import TemplatePicker from '../templates/TemplatePicker.vue';

/**
 * Writing an internal note.
 *
 * Two pickers open from here — mentions and reply templates — and both insert
 * into this textarea. That is what "a template inserts into the internal note
 * composer" means in practice (Clarifications Q2): there is no send button,
 * because there is nowhere to send until Phase 5.
 */
defineProps<{ ticketId: number; submitting: boolean }>();

const emit = defineEmits<{ (event: 'submit', body: string): void }>();

const body = ref('');
const textarea = ref<HTMLTextAreaElement | null>(null);
const picker = ref<InstanceType<typeof MentionPicker> | null>(null);

const mentionQuery = ref<string | null>(null);
const templatePickerOpen = ref(false);

/** Errors that name PEOPLE, not fields — see MENTION_NOT_VISIBLE. */
const rejectedMentions = ref<NoteMention[]>([]);
const errorKey = ref<string | null>(null);

const mentionOpen = computed(() => mentionQuery.value !== null);

/**
 * Tracks an in-progress `@…` immediately before the caret.
 *
 * Recomputed from the text rather than kept as state, so pasting, undo, and
 * clicking elsewhere in the textarea all behave correctly without extra cases.
 */
function syncMentionQuery(): void {
  const element = textarea.value;

  if (!element) return;

  const upToCaret = body.value.slice(0, element.selectionStart);
  const match = /@([\p{L}\p{N} ]{0,30})$/u.exec(upToCaret);

  mentionQuery.value = match ? match[1] : null;
}

function insertMention(user: NoteMention): void {
  const element = textarea.value;

  if (!element) return;

  const caret = element.selectionStart;
  const before = body.value.slice(0, caret).replace(/@([\p{L}\p{N} ]{0,30})$/u, '');

  // The TOKEN goes into the body, never the display name — that is what keeps
  // an old note correct after the person is renamed (FR-041).
  body.value = `${before}@[user:${user.id}] ${body.value.slice(caret)}`;
  mentionQuery.value = null;

  element.focus();
}

function insertTemplate(_template: ReplyTemplate, text: string): void {
  const element = textarea.value;
  const caret = element?.selectionStart ?? body.value.length;

  // Inserted as ordinary editable text (FR-068). A template is a starting
  // point, never a locked message — nothing here makes it read-only.
  body.value = `${body.value.slice(0, caret)}${text}${body.value.slice(caret)}`;
  templatePickerOpen.value = false;

  element?.focus();
}

function onKeydown(event: KeyboardEvent): void {
  // The picker gets first refusal on navigation keys, so arrows and Enter move
  // through the list instead of moving the caret — without focus ever leaving
  // the textarea (FR-082).
  if (picker.value?.handleKey(event)) {
    event.preventDefault();
    return;
  }

  if (event.key === 'Escape') {
    mentionQuery.value = null;
    templatePickerOpen.value = false;
  }
}

function submit(): void {
  const text = body.value.trim();

  rejectedMentions.value = [];
  errorKey.value = null;

  if (text === '') {
    errorKey.value = 'ticketNote.error.bodyRequired';
    return;
  }

  emit('submit', text);
}

/**
 * Called by the parent after a failed save, so the composer keeps the text the
 * agent wrote. Losing a paragraph to a rejected mention would be a worse
 * failure than the rejection itself.
 */
function reportError(error: unknown): void {
  if (!(error instanceof ApiError)) {
    errorKey.value = 'error.unexpected';
    return;
  }

  if (error.code === 'MENTION_NOT_VISIBLE') {
    rejectedMentions.value = (error.payload.mentions as NoteMention[]) ?? [];
    errorKey.value = 'ticketNote.error.mentionNotVisible';
    return;
  }

  if (error.code === 'MENTION_LIMIT') {
    errorKey.value = error.details[0]?.message ?? 'ticketNote.error.mentionLimitGeneric';
    return;
  }

  errorKey.value = error.details[0]?.message ?? 'error.unexpected';
}

function clear(): void {
  body.value = '';
  rejectedMentions.value = [];
  errorKey.value = null;
}

defineExpose({ reportError, clear });
</script>

<template>
  <form class="relative space-y-2" @submit.prevent="submit">
    <label for="note-body" class="block text-sm font-medium">{{ $t('ticketNote.add') }}</label>

    <textarea
      id="note-body"
      ref="textarea"
      v-model="body"
      rows="3"
      class="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-600 dark:bg-slate-900"
      :placeholder="$t('ticketNote.placeholder')"
      :aria-invalid="errorKey !== null"
      :aria-describedby="errorKey ? 'note-error' : undefined"
      :aria-controls="mentionOpen ? picker?.listId : undefined"
      :aria-expanded="mentionOpen"
      @input="syncMentionQuery"
      @click="syncMentionQuery"
      @keydown="onKeydown"
    />

    <MentionPicker
      ref="picker"
      :ticket-id="ticketId"
      :query="mentionQuery ?? ''"
      :open="mentionOpen"
      @select="insertMention"
      @close="mentionQuery = null"
    />

    <!-- role="alert": a refusal that is only red is invisible to a screen
         reader, and this one has to name the person it refused (FR-083). -->
    <div v-if="errorKey" id="note-error" role="alert" class="text-sm text-red-700">
      <p>{{ $t(errorKey) }}</p>
      <ul v-if="rejectedMentions.length > 0" class="mt-1 list-inside list-disc">
        <li v-for="mention in rejectedMentions" :key="mention.id">{{ mention.fullName }}</li>
      </ul>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <button
        type="submit"
        :disabled="submitting"
        class="rounded bg-blue-700 px-3 py-1.5 text-sm text-white disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      >
        {{ $t('notes.save') }}
      </button>

      <button
        type="button"
        class="rounded border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-600"
        @click="templatePickerOpen = !templatePickerOpen"
      >
        {{ $t('template.insert') }}
      </button>
    </div>

    <TemplatePicker
      v-if="templatePickerOpen"
      @insert="insertTemplate"
      @close="templatePickerOpen = false"
    />
  </form>
</template>
