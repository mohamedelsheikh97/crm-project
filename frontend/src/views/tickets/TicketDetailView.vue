<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import CustomerContextPanel from '../../components/tickets/CustomerContextPanel.vue';
import DueDateControl from '../../components/tickets/DueDateControl.vue';
import TicketHistoryTimeline from '../../components/tickets/TicketHistoryTimeline.vue';
import MessageThread from '../../components/messages/MessageThread.vue';
import ReplyComposer from '../../components/messages/ReplyComposer.vue';
import TicketNoteComposer from '../../components/tickets/TicketNoteComposer.vue';
import TicketNoteThread from '../../components/tickets/TicketNoteThread.vue';
import TicketLinkPanel from '../../components/tickets/TicketLinkPanel.vue';
import TicketMergeDialog from '../../components/tickets/TicketMergeDialog.vue';
import TicketPriorityBadge from '../../components/tickets/TicketPriorityBadge.vue';
import TicketStatusBadge from '../../components/tickets/TicketStatusBadge.vue';
import TicketTransitionMenu from '../../components/tickets/TicketTransitionMenu.vue';
import { usePermissions } from '../../composables/usePermissions';
import * as adminUsersService from '../../services/admin-users.service';
import { ApiError } from '../../services/http';
import * as dashboardService from '../../services/dashboard.service';
import * as messagesService from '../../services/messages.service';
import * as ticketNotesService from '../../services/ticket-notes.service';
import type { TicketNote } from '../../services/ticket-notes.service';
import { useAuthStore } from '../../stores/auth.store';
import * as ticketsService from '../../services/tickets.service';
import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  type Ticket,
  type TicketCategory,
  type TicketPriority,
} from '../../services/tickets.service';

const { t, locale } = useI18n();
const { can } = usePermissions();
const route = useRoute();

const ticket = ref<Ticket | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

const timeline = ref<InstanceType<typeof TicketHistoryTimeline> | null>(null);
const mergeOpen = ref(false);
const mergeTrigger = ref<HTMLButtonElement | null>(null);

// Edit form
const editing = ref(false);
const subject = ref('');
const description = ref('');
const category = ref<TicketCategory>('general');
const priority = ref<TicketPriority>('normal');
const saving = ref(false);
const editError = ref<string | null>(null);

// Assignment
const assignableUsers = ref<Array<{ id: number; fullName: string }>>([]);
const assigneeId = ref<number | null>(null);
const assigning = ref(false);

const ticketId = computed(() => Number(route.params.id));

/** A merged ticket is a redirect: every action control is disabled (FR-042). */
const isMerged = computed(() => ticket.value?.mergedIntoTicketId !== null);
const isClosed = computed(() => ticket.value?.status === 'closed');
const canEdit = computed(() => can('tickets:update') && !isMerged.value && !isClosed.value);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    ticket.value = await ticketsService.get(ticketId.value);
    resetForm();

    // Notes and correspondence load WITH the ticket.
    //
    // `loadNotes` was previously only called after adding a note, so opening a
    // ticket showed an empty note thread until you wrote one — a Phase 4 gap
    // found while wiring the message thread beside it.
    //
    // Not awaited: the ticket itself is what the agent is waiting for, and
    // holding the whole screen for two secondary lists makes it feel slower
    // than it is. Each list carries its own loading state.
    void loadNotes();
    void loadMessages();
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : t('error.unexpected');
  } finally {
    loading.value = false;
  }
}

function resetForm(): void {
  if (!ticket.value) return;

  subject.value = ticket.value.subject;
  description.value = ticket.value.description ?? '';
  category.value = ticket.value.category;
  priority.value = ticket.value.priority;
  assigneeId.value = ticket.value.assignee?.id ?? null;
}

onMounted(async () => {
  await load();

  if (can('tickets:assign')) {
    try {
      assignableUsers.value = (
        await adminUsersService.list({ isActive: true, pageSize: 100 })
      ).items
        .filter((user) => user.isActive)
        .map((user) => ({ id: user.id, fullName: user.fullName }));
    } catch {
      // Without the list the Supervisor cannot assign from this screen, but the
      // rest of the ticket stays fully usable.
      assignableUsers.value = [];
    }
  }
});

watch(ticketId, load);

// --- Phase 5: customer correspondence -----------------------------------
//
// Held in state SEPARATE from notes, loaded by a separate service, rendered by
// a separate component. The two composers below are never one component with a
// flag: a wrong flag would send a colleague's private note to a customer, and
// SC-006 requires that mistake to be unwritable rather than unlikely.

const messages = ref<messagesService.TicketMessage[]>([]);
const messagesLoading = ref(false);
const sendingMessage = ref(false);
const composerContext = ref<messagesService.ComposerContext | null>(null);

async function loadMessages(): Promise<void> {
  if (!ticket.value) return;

  messagesLoading.value = true;

  try {
    const [page, context] = await Promise.all([
      messagesService.fetchMessages(ticket.value.id),
      messagesService.fetchComposerContext(ticket.value.id),
    ]);

    messages.value = page.items;
    // Fetched with the thread rather than on focus, so an opt-out or a closed
    // reply window is on screen before the agent starts writing (FR-051).
    composerContext.value = context;
  } finally {
    messagesLoading.value = false;
  }
}

async function sendMessage(body: string): Promise<void> {
  if (!ticket.value) return;

  sendingMessage.value = true;

  try {
    await messagesService.sendMessage(ticket.value.id, body);
    await loadMessages();
    // A sent reply writes a history entry, so the timeline is stale.
    void timeline.value?.reload();
  } finally {
    sendingMessage.value = false;
  }
}

// --- Phase 4: notes, mentions, and the due date -------------------------

const auth = useAuthStore();

const notes = ref<TicketNote[]>([]);
const notesLoading = ref(false);
const savingNote = ref(false);
const composer = ref<InstanceType<typeof TicketNoteComposer> | null>(null);
const savingDueDate = ref(false);

async function loadNotes(): Promise<void> {
  if (!ticket.value) return;

  notesLoading.value = true;

  try {
    notes.value = (await ticketNotesService.fetchNotes(ticket.value.id)).items;
  } finally {
    notesLoading.value = false;
  }
}

async function addNote(body: string): Promise<void> {
  if (!ticket.value) return;

  savingNote.value = true;

  try {
    await ticketNotesService.createNote(ticket.value.id, body);
    composer.value?.clear();
    await loadNotes();
    // A note produces a history entry, so the timeline is stale until reloaded.
    void timeline.value?.reload();
  } catch (error) {
    // Handed to the composer rather than shown as a page error: it keeps the
    // text the agent wrote and names the mention that was refused. Losing a
    // paragraph would be a worse failure than the rejection itself.
    composer.value?.reportError(error);
  } finally {
    savingNote.value = false;
  }
}

async function saveDueDate(dueAt: string | null): Promise<void> {
  if (!ticket.value) return;

  savingDueDate.value = true;

  try {
    applyUpdate(await dashboardService.setDueDate(ticket.value.id, dueAt, ticket.value.version));
  } catch (error) {
    editError.value = error instanceof ApiError ? error.message : 'error.unexpected';
  } finally {
    savingDueDate.value = false;
  }
}

/**
 * Follow-ups still open on a ticket that was just closed (FR-064).
 *
 * The server sends these only on the response to such a close. It is a NOTICE,
 * never a refusal — the ticket is already closed by the time this renders. The
 * person closing may well know the task is moot, and blocking them would teach
 * everyone to stop recording follow-ups.
 */
const outstandingOnClose = ref<NonNullable<Ticket['outstandingTasks']>>([]);

function applyUpdate(updated: Ticket): void {
  ticket.value = updated;
  resetForm();
  editing.value = false;
  outstandingOnClose.value = updated.outstandingTasks ?? [];
  void timeline.value?.reload();
}

async function save(): Promise<void> {
  if (!ticket.value) return;

  saving.value = true;
  editError.value = null;

  try {
    applyUpdate(
      await ticketsService.update(ticket.value.id, {
        subject: subject.value,
        description: description.value || null,
        category: category.value,
        priority: priority.value,
        version: ticket.value.version,
      }),
    );
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'CONFLICT') {
      // The edit is PRESERVED and reloading is the user's choice. Discarding
      // what they typed to resolve a conflict they did not cause is the wrong
      // trade, and Phase 2 settled it this way.
      editError.value = t('ticket.edit.conflict');
    } else {
      editError.value = cause instanceof ApiError ? cause.message : t('error.unexpected');
    }
  } finally {
    saving.value = false;
  }
}

async function assign(): Promise<void> {
  if (!ticket.value) return;

  assigning.value = true;

  try {
    applyUpdate(
      await ticketsService.assign(ticket.value.id, {
        userId: assigneeId.value,
        version: ticket.value.version,
      }),
    );
  } catch (cause) {
    editError.value = cause instanceof ApiError ? cause.message : t('error.unexpected');
  } finally {
    assigning.value = false;
  }
}

function onMerged(updated: Ticket): void {
  mergeOpen.value = false;
  applyUpdate(updated);
  // Focus returns to the control that opened the dialog.
  mergeTrigger.value?.focus();
}

function closeMerge(): void {
  mergeOpen.value = false;
  mergeTrigger.value?.focus();
}

const formatter = computed(
  () => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }),
);
</script>

<template>
  <div class="space-y-6">
    <p v-if="loading">{{ t('table.loading') }}</p>
    <p
      v-else-if="error"
      class="rounded-md bg-red-50 p-3 text-red-900 dark:bg-red-950 dark:text-red-100"
    >
      {{ error }}
    </p>

    <template v-else-if="ticket">
      <!-- FIRST IN THE DOM, so a screen reader meets the explanation before the
           fields it explains (FR-042, FR-046). -->
      <div
        v-if="isMerged"
        role="status"
        class="rounded-md bg-amber-50 p-4 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
      >
        <p class="font-medium">{{ t('ticket.merged.banner') }}</p>
        <p class="mt-1 text-sm">
          {{ t('ticket.merged.explanation') }}
          <RouterLink
            v-if="ticket.survivor"
            :to="{ name: 'ticket-detail', params: { id: ticket.survivor.id } }"
            class="font-mono underline"
            dir="ltr"
          >
            {{ ticket.survivor.reference }}
          </RouterLink>
        </p>
      </div>

      <div
        v-else-if="isClosed"
        role="status"
        class="rounded-md bg-slate-100 p-4 text-slate-800 dark:bg-slate-800 dark:text-slate-100"
      >
        <!-- Says WHY the controls are unavailable rather than leaving them
             mysteriously inert (FR-009). -->
        {{ t('ticket.closed.notice') }}
      </div>

      <header class="space-y-2">
        <div class="flex flex-wrap items-center gap-3">
          <span class="font-mono text-lg" dir="ltr">{{ ticket.reference }}</span>
          <TicketStatusBadge :status="ticket.status" />
          <TicketPriorityBadge :priority="ticket.priority" />
        </div>
        <h1 class="text-2xl font-semibold">{{ ticket.subject }}</h1>
        <p class="text-sm text-slate-600 dark:text-slate-300">
          {{ t('ticket.detail.category') }}: {{ t(`ticket.category.${ticket.category}`) }}
          ·
          {{ t('ticket.detail.created') }}: {{ formatter.format(new Date(ticket.createdAt)) }}
          <template v-if="ticket.createdBy"> · {{ ticket.createdBy.fullName }}</template>
        </p>
      </header>

      <p
        v-if="ticket.escalationReason"
        class="rounded-md bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
      >
        <strong>{{ t('ticket.escalation.current') }}:</strong> {{ ticket.escalationReason }}
      </p>

      <!-- Phase 4 replaces the bare customer link with the full context panel:
           identity, contacts, other tickets, and recent notes, all beside the
           ticket rather than one click behind it. That is PLAN.md's "without
           navigating away" (FR-013).

           It renders nothing at all for a caller without `customers:view`, and
           the ticket around it stays fully workable (FR-018). -->
      <CustomerContextPanel :ticket-id="ticket.id" />

      <section>
        <h2 class="text-lg font-semibold">{{ t('ticket.detail.description') }}</h2>

        <p v-if="!editing" class="whitespace-pre-line">
          {{ ticket.description || t('ticket.detail.noDescription') }}
        </p>

        <button
          v-if="!editing && canEdit"
          type="button"
          class="mt-2 rounded-md border px-3 py-2 text-sm"
          @click="editing = true"
        >
          {{ t('action.edit') }}
        </button>

        <form v-if="editing" class="mt-3 space-y-3" @submit.prevent="save">
          <p
            v-if="editError"
            class="rounded-md bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
          >
            {{ editError }}
          </p>

          <div>
            <label class="block text-sm font-medium" for="edit-subject">
              {{ t('ticketForm.field.subject') }}
            </label>
            <input
              id="edit-subject"
              v-model="subject"
              type="text"
              class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-start dark:border-slate-600 dark:bg-slate-800"
            />
          </div>

          <div>
            <label class="block text-sm font-medium" for="edit-description">
              {{ t('ticketForm.field.description') }}
            </label>
            <textarea
              id="edit-description"
              v-model="description"
              rows="6"
              class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-start dark:border-slate-600 dark:bg-slate-800"
            ></textarea>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <div>
              <label class="block text-sm font-medium" for="edit-category">
                {{ t('ticketForm.field.category') }}
              </label>
              <select
                id="edit-category"
                v-model="category"
                class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-start dark:border-slate-600 dark:bg-slate-800"
              >
                <option v-for="value in TICKET_CATEGORIES" :key="value" :value="value">
                  {{ t(`ticket.category.${value}`) }}
                </option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium" for="edit-priority">
                {{ t('ticketForm.field.priority') }}
              </label>
              <select
                id="edit-priority"
                v-model="priority"
                class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-start dark:border-slate-600 dark:bg-slate-800"
              >
                <option v-for="value in TICKET_PRIORITIES" :key="value" :value="value">
                  {{ t(`ticket.priority.${value}`) }}
                </option>
              </select>
            </div>
          </div>

          <div class="flex gap-2">
            <button
              type="submit"
              class="rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
              :disabled="saving"
            >
              {{ t('action.save') }}
            </button>
            <button
              type="button"
              class="rounded-md border px-4 py-2 text-sm"
              @click="
                editing = false;
                resetForm();
              "
            >
              {{ t('action.cancel') }}
            </button>
          </div>
        </form>
      </section>

      <section v-if="!isMerged">
        <h2 class="text-lg font-semibold">{{ t('ticket.detail.actions') }}</h2>
        <TicketTransitionMenu :ticket="ticket" @moved="applyUpdate" />

        <!-- FR-064. Surfaced, not blocking: the close has already happened.
             role="status" so it is announced without interrupting anything —
             the same politeness the notification live region uses. -->
        <div
          v-if="outstandingOnClose.length > 0"
          role="status"
          class="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          <p class="font-medium">{{ t('task.outstandingOnClose') }}</p>
          <ul class="mt-1 list-inside list-disc">
            <li v-for="task in outstandingOnClose" :key="task.id">{{ task.title }}</li>
          </ul>
        </div>
      </section>

      <!-- Hidden ENTIRELY for a caller without tickets:assign. An Agent cannot
           assign to anyone, including themselves (Clarifications Q3). -->
      <section v-if="can('tickets:assign') && !isMerged">
        <h2 class="text-lg font-semibold">{{ t('ticket.assignment.title') }}</h2>
        <div class="mt-2 flex flex-wrap items-end gap-2">
          <div>
            <label class="block text-sm font-medium" for="assignee">
              {{ t('ticket.assignment.assignee') }}
            </label>
            <select
              id="assignee"
              v-model.number="assigneeId"
              class="mt-1 rounded-md border border-slate-300 px-3 py-2 text-start dark:border-slate-600 dark:bg-slate-800"
            >
              <option :value="null">{{ t('tickets.filter.unassigned') }}</option>
              <option v-for="user in assignableUsers" :key="user.id" :value="user.id">
                {{ user.fullName }}
              </option>
            </select>
          </div>
          <button
            type="button"
            class="rounded-md border px-3 py-2 text-sm"
            :disabled="assigning"
            @click="assign"
          >
            {{ t('ticket.assignment.save') }}
          </button>
        </div>
      </section>

      <section v-else-if="!can('tickets:assign')">
        <h2 class="text-lg font-semibold">{{ t('ticket.assignment.title') }}</h2>
        <p class="text-sm">
          {{ ticket.assignee?.fullName ?? t('tickets.filter.unassigned') }}
        </p>
      </section>

      <TicketLinkPanel :ticket="ticket" @changed="applyUpdate" />

      <section v-if="can('tickets:merge') && !isMerged">
        <button
          ref="mergeTrigger"
          type="button"
          class="rounded-md border border-red-700 px-3 py-2 text-sm text-red-800 dark:text-red-300"
          @click="mergeOpen = true"
        >
          {{ t('ticket.merge.open') }}
        </button>
      </section>

      <!-- Phase 4. The due date sits with the ticket's other fields; the note
           thread is what turns this screen from a record view into a place
           colleagues talk. -->
      <section v-if="!isMerged">
        <DueDateControl
          :due-at="ticket.dueAt ?? null"
          :can-edit="can('tickets:set_due_date')"
          :saving="savingDueDate"
          @save="saveDueDate"
        />
      </section>

      <!-- CORRESPONDENCE, above the internal notes. Deliberate: the customer's
           own words are what an agent came to read, and the note thread is
           commentary on them. -->
      <section>
        <MessageThread :messages="messages" :loading="messagesLoading" />

        <ReplyComposer
          v-if="can('messages:send') && !isMerged"
          class="mt-3"
          :context="composerContext"
          :sending="sendingMessage"
          @send="sendMessage"
        />
      </section>

      <section>
        <h2 class="text-lg font-semibold">{{ t('ticketNote.title') }}</h2>
        <p class="mb-2 text-sm text-slate-600 dark:text-slate-400">
          {{ t('ticketNote.internalNotice') }}
        </p>

        <TicketNoteThread
          :notes="notes"
          :loading="notesLoading"
          :current-user-id="auth.user?.id ?? 0"
        />

        <TicketNoteComposer
          v-if="can('ticket_notes:create') && !isMerged"
          ref="composer"
          class="mt-3"
          :ticket-id="ticket.id"
          :submitting="savingNote"
          @submit="addNote"
        />
      </section>

      <TicketHistoryTimeline
        ref="timeline"
        :ticket-id="ticket.id"
        :ticket-reference="ticket.reference"
      />

      <TicketMergeDialog
        :open="mergeOpen"
        :ticket="ticket"
        @close="closeMerge"
        @merged="onMerged"
      />
    </template>
  </div>
</template>
