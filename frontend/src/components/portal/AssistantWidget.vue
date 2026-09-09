<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import AssistantChat from './AssistantChat.vue';

/**
 * The assistant as a popup, anchored to the bottom corner of every portal page
 * (Phase 9, US3).
 *
 * WHY A POPUP RATHER THAN A ROUTE. `/portal/assistant` was reachable only by
 * typing it: no portal navigation ever linked to it, so in practice the feature
 * did not exist for a customer. A launcher that follows them across the request
 * list, a request, and the help centre is the difference between an assistant
 * they can find and one they cannot.
 *
 * THE CONVERSATION LIVES IN `AssistantChat`, not here. This file is a frame:
 * open state, focus, and where it sits on the screen. That separation is what
 * makes the popup a presentation decision rather than a rewrite — a future page
 * can render the same conversation without inheriting any of this positioning.
 *
 * STATE SURVIVES CLOSING. The panel is hidden with `v-show`, not `v-if`, so
 * closing the popup mid-conversation and reopening it does not silently discard
 * what was said — including a `conversationId` the server is holding. `v-if`
 * here would destroy the component and start a second conversation on the next
 * message, which reads to the customer as the assistant forgetting them.
 *
 * KEYBOARD AND SCREEN READER (the Phase 5 rule for the chat widget, FR-077,
 * applied here because a customer meets this the same way):
 *   - the launcher says whether it is expanded, and what it controls
 *   - focus moves into the panel on open and returns to the launcher on close,
 *     including when Escape closes it
 *   - focus is trapped while open, so Tab cannot wander into the page behind
 *   - the conversation's own `aria-live="polite"` region announces replies
 *     without stealing focus — it stays in `AssistantChat`, where the messages
 *     are
 *
 * RTL comes from `inset-inline-end`, so Arabic mirrors the launcher to the left
 * without a second rule (FR-107).
 */
const { t } = useI18n();

const open = ref(false);
const launcher = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableInPanel(): HTMLElement[] {
  if (!panel.value) return [];

  return Array.from(panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    // `offsetParent` is null for anything `display: none`, which is how the
    // unavailable branch and the composer swap places without this list going
    // stale.
    (element) => element.offsetParent !== null,
  );
}

function close(): void {
  if (!open.value) return;

  open.value = false;
  // Returned deliberately: a customer who pressed Escape is left where they
  // were, not at the top of the document.
  launcher.value?.focus();
}

function toggle(): void {
  if (open.value) {
    close();
    return;
  }

  open.value = true;
}

function onKeydown(event: KeyboardEvent): void {
  if (!open.value) return;

  if (event.key === 'Escape') {
    event.stopPropagation();
    close();
    return;
  }

  if (event.key !== 'Tab') return;

  const focusable = focusableInPanel();
  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  // Wrap at both ends. Without this the next Tab lands on the page behind the
  // panel, which for a customer mid-question is indistinguishable from the
  // popup having closed itself.
  if (event.shiftKey && (active === first || active === panel.value)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

watch(open, async (isOpen) => {
  if (!isOpen) return;

  await nextTick();
  // The composer, not the panel: a customer who opened this wants to type.
  const input = panel.value?.querySelector<HTMLElement>('#assistant-input');
  (input ?? focusableInPanel()[0] ?? panel.value)?.focus();
});

function onDocumentKeydown(event: KeyboardEvent): void {
  // Escape works even when focus has slipped outside the panel — a click on the
  // page behind leaves the popup open with focus elsewhere, and the customer
  // still expects Escape to shut it.
  if (event.key === 'Escape' && open.value) close();
}

document.addEventListener('keydown', onDocumentKeydown);

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocumentKeydown);
});
</script>

<template>
  <div class="widget" @keydown="onKeydown">
    <section
      v-show="open"
      id="portal-assistant-panel"
      ref="panel"
      class="widget__panel"
      role="dialog"
      :aria-label="t('portal.assistant.title')"
      tabindex="-1"
    >
      <header class="widget__header">
        <h2 class="widget__title">{{ t('portal.assistant.title') }}</h2>
        <button
          type="button"
          class="widget__close"
          :aria-label="t('portal.assistant.close')"
          @click="close"
        >
          <span aria-hidden="true">&times;</span>
        </button>
      </header>

      <div class="widget__body">
        <AssistantChat @navigate="close" />
      </div>
    </section>

    <button
      ref="launcher"
      type="button"
      class="widget__launcher"
      :aria-expanded="open"
      aria-controls="portal-assistant-panel"
      @click="toggle"
    >
      {{ open ? t('portal.assistant.close') : t('portal.assistant.launch') }}
    </button>
  </div>
</template>

<style scoped>
.widget {
  /* THE ONE z-index IN THIS COMPONENT, and the only one the portal needs. The
     portal has no modals, no sticky header and no toasts, so a single layer
     above the page is enough — and keeping it to one value is what stops the
     next addition starting an escalation. */
  position: fixed;
  z-index: 40;
  inset-block-end: 1rem;
  /* Logical, so Arabic mirrors this to the left with no second rule (FR-107). */
  inset-inline-end: 1rem;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.75rem;
}

.widget__launcher {
  /* 44px minimum target, as everywhere else in the portal (T127). */
  min-height: 2.75rem;
  padding-inline: 1.25rem;
  border: 1px solid #1d4ed8;
  border-radius: 9999px;
  background: #1d4ed8;
  color: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 6px 16px rgb(15 23 42 / 25%);
}

.widget__panel {
  display: flex;
  flex-direction: column;
  /* Wide enough for a cited-article list to read as a list, capped so it never
     covers a phone entirely — the request behind it stays visible, which is
     usually what the question is about. */
  width: min(24rem, calc(100vw - 2rem));
  max-height: min(32rem, calc(100vh - 6rem));
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 0.75rem;
  box-shadow: 0 12px 32px rgb(15 23 42 / 20%);
  overflow: hidden;
}

.widget__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.75rem 0.5rem 0.75rem 1rem;
  border-bottom: 1px solid #e5e7eb;
}

.widget__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.widget__close {
  min-height: 2.75rem;
  min-width: 2.75rem;
  border: 0;
  border-radius: 0.375rem;
  background: transparent;
  color: #4b5563;
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
}

.widget__close:hover {
  background: #f3f4f6;
}

.widget__body {
  /* `min-height: 0` so the conversation's own scroll area is what scrolls,
     rather than the flex item refusing to shrink and pushing the composer off
     the bottom of the panel. */
  min-height: 0;
  overflow: hidden;
  display: flex;
  padding: 0.75rem;
}

.widget__body > * {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
