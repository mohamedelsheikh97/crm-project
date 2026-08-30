<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import { fetchMentionableUsers, type NoteMention } from '../../services/ticket-notes.service';

/**
 * The mention picker.
 *
 * It only ever offers users who CAN VIEW THIS TICKET, because the server
 * filters them that way (FR-036 with FR-037). An interface that offers a choice
 * its own save will then reject is worse than one that offers fewer choices.
 *
 * FULLY KEYBOARD-OPERABLE (FR-082): arrows move, Enter selects, Escape
 * dismisses, and `aria-activedescendant` tells a screen reader which option is
 * current without moving real focus out of the composer.
 */
const props = defineProps<{ ticketId: number; query: string; open: boolean }>();

const emit = defineEmits<{
  (event: 'select', user: NoteMention): void;
  (event: 'close'): void;
}>();

const items = ref<NoteMention[]>([]);
const activeIndex = ref(0);
const listId = 'mention-picker-list';

const activeId = computed(() =>
  items.value.length > 0 ? `mention-option-${items.value[activeIndex.value]?.id}` : undefined,
);

watch(
  () => [props.query, props.open] as const,
  async ([query, open]) => {
    if (!open) return;

    items.value = (await fetchMentionableUsers(props.ticketId, query)).items;
    activeIndex.value = 0;
    await nextTick();
  },
  { immediate: true },
);

/**
 * Called by the composer's keydown handler rather than bound here, so the
 * caret stays in the textarea while the list is being navigated.
 */
function handleKey(event: KeyboardEvent): boolean {
  if (!props.open || items.value.length === 0) return false;

  switch (event.key) {
    case 'ArrowDown':
      activeIndex.value = (activeIndex.value + 1) % items.value.length;
      return true;
    case 'ArrowUp':
      activeIndex.value = (activeIndex.value - 1 + items.value.length) % items.value.length;
      return true;
    case 'Enter':
    case 'Tab':
      emit('select', items.value[activeIndex.value]);
      return true;
    case 'Escape':
      emit('close');
      return true;
    default:
      return false;
  }
}

defineExpose({ handleKey, listId });
</script>

<template>
  <ul
    v-if="open && items.length > 0"
    :id="listId"
    role="listbox"
    :aria-activedescendant="activeId"
    :aria-label="$t('ticketNote.mention.label')"
    class="absolute z-20 mt-1 max-h-48 w-64 overflow-y-auto rounded border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900"
  >
    <li
      v-for="(user, index) in items"
      :id="`mention-option-${user.id}`"
      :key="user.id"
      role="option"
      :aria-selected="index === activeIndex"
      class="cursor-pointer px-3 py-1.5 text-sm"
      :class="index === activeIndex ? 'bg-blue-100 dark:bg-slate-700' : ''"
      @mousedown.prevent="emit('select', user)"
    >
      {{ user.fullName }}
    </li>
  </ul>

  <p
    v-else-if="open"
    class="absolute z-20 mt-1 w-64 rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 shadow-lg dark:border-slate-700 dark:bg-slate-900"
  >
    {{ $t('ticketNote.mention.noMatches') }}
  </p>
</template>
