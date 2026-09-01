<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import * as portalService from '../../services/portal.service';
import type { PortalTicket } from '../../services/portal.service';

/**
 * One request, in full (Phase 8, User Stories 4, 5 and 7).
 *
 * THERE ARE NO FIELDS THIS SCREEN CHOOSES NOT TO SHOW. Everything the server
 * sends is rendered, because the server sends only what a customer may see — the
 * projection is an allow-list built field by field, and its key set is frozen by
 * a test (FR-030). A screen that filtered would be the second place the rule
 * lived, and the second place is where the two drift apart.
 *
 * THE REPLY BOX IS ABSENT ON A CLOSED REQUEST, not disabled (FR-036). `TRANSITIONS`
 * makes reopening a closed ticket a Supervisor's act, so a customer reply cannot
 * do it; the honest answer is "raise a new request", prefilled with a reference
 * to this one so nothing is retyped.
 *
 * NO UPLOAD CONTROL on the reply either, with the same sentence in its place.
 */
const { t, d } = useI18n();
const route = useRoute();

const reference = computed(() => String(route.params.reference ?? ''));

const loading = ref(true);
const notFound = ref(false);
const ticket = ref<PortalTicket | null>(null);

const replyBody = ref('');
const replyBusy = ref(false);
const replyProblem = ref<string | null>(null);
const reopened = ref(false);

const score = ref<number | null>(null);
const comment = ref('');
const ratingBusy = ref(false);
const ratingProblem = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;

  try {
    ticket.value = await portalService.getRequest(reference.value);
  } catch {
    // 404 covers every refusal — another customer's request, a colleague's, one
    // with no recorded requester, and one that never existed. The screen says
    // the same thing for all of them, because the server does.
    notFound.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function sendReply(): Promise<void> {
  replyBusy.value = true;
  replyProblem.value = null;

  try {
    const result = await portalService.reply(reference.value, replyBody.value);
    replyBody.value = '';
    reopened.value = result.reopened;
    await load();
  } catch (error) {
    const code = (error as { code?: string }).code;
    replyProblem.value =
      code === 'TICKET_SETTLED'
        ? t('portal.error.ticketSettled')
        : ((error as { details?: Array<{ message: string }> }).details?.[0]?.message ??
          'portal.error.unexpected');
  } finally {
    replyBusy.value = false;
  }
}

async function sendRating(): Promise<void> {
  if (score.value === null) {
    ratingProblem.value = t('portal.rating.error.scoreRequired');
    return;
  }

  ratingBusy.value = true;
  ratingProblem.value = null;

  try {
    await portalService.rate(reference.value, score.value, comment.value);
    await load();
  } catch (error) {
    const code = (error as { code?: string }).code;
    ratingProblem.value =
      code === 'ALREADY_RECORDED' ? t('portal.rating.already') : t('portal.error.unexpected');
    if (code === 'ALREADY_RECORDED') await load();
  } finally {
    ratingBusy.value = false;
  }
}

async function download(attachmentId: number, fileName: string): Promise<void> {
  const blob = await portalService.downloadAttachment(reference.value, attachmentId);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div>
    <RouterLink
      :to="{ name: 'portal-requests' }"
      class="text-sm text-slate-600 underline hover:text-slate-900"
    >
      {{ t('portal.request.back') }}
    </RouterLink>

    <p v-if="loading" role="status" class="mt-6 text-sm text-slate-600">{{ t('table.loading') }}</p>

    <div
      v-else-if="notFound || !ticket"
      role="alert"
      class="mt-6 rounded-md border border-slate-200 bg-white p-6"
    >
      <h1 class="text-lg font-semibold">{{ t('portal.request.notFound.title') }}</h1>
      <p class="mt-2 text-sm text-slate-600">{{ t('portal.request.notFound.hint') }}</p>
    </div>

    <template v-else>
      <header class="mt-4">
        <h1 class="text-xl font-semibold">{{ ticket.subject }}</h1>
        <p class="mt-1 text-sm text-slate-500">
          {{ ticket.reference }} ·
          <!-- A customer state, from the declared mapping. Never the internal
               status string (FR-028). -->
          <span class="font-medium text-slate-700">{{ t(`portal.state.${ticket.state}`) }}</span>
          · {{ t('portal.request.raised') }} {{ d(new Date(ticket.raisedAt), 'short') }}
        </p>
        <p class="mt-1 text-xs text-slate-500">
          {{ t('portal.request.category') }}: {{ t(`ticket.category.${ticket.category}`) }} ·
          {{ t('portal.request.priority') }}: {{ t(`ticket.priority.${ticket.priority}`) }}
        </p>
      </header>

      <section v-if="ticket.description" class="mt-6">
        <h2 class="text-sm font-semibold">{{ t('portal.request.description') }}</h2>
        <p class="mt-1 whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-3 text-sm">
          {{ ticket.description }}
        </p>
      </section>

      <!-- ONE CHRONOLOGICAL HISTORY ACROSS CHANNELS (FR-029). A real list with a
           heading structure, so a screen reader can move between entries rather
           than through one wall of text. -->
      <section class="mt-6">
        <h2 class="text-sm font-semibold">{{ t('portal.request.conversation') }}</h2>

        <p v-if="ticket.messages.length === 0" class="mt-2 text-sm text-slate-600">
          {{ t('portal.request.conversation.empty') }}
        </p>

        <ol v-else class="mt-2 space-y-3">
          <li
            v-for="(message, index) of ticket.messages"
            :key="index"
            class="rounded-md border p-3"
            :class="
              message.direction === 'inbound'
                ? 'border-slate-200 bg-white'
                : 'border-slate-300 bg-slate-100'
            "
          >
            <h3 class="text-xs font-semibold text-slate-600">
              {{
                message.direction === 'inbound'
                  ? t('portal.request.from.you')
                  : t('portal.request.from.us')
              }}
              <span class="font-normal text-slate-500">
                · {{ t(`messages.channel.${message.channel}`) }} ·
                {{ d(new Date(message.occurredAt), 'short') }}
              </span>
            </h3>

            <!-- TEXT, never HTML. `body_format: 'html_source'` exists for inbound
                 email, and rendering stored HTML here would be a stored-XSS
                 surface for the price of prettier quoting. -->
            <p class="mt-1 whitespace-pre-wrap text-sm">{{ message.body }}</p>

            <ul v-if="message.attachments.length > 0" class="mt-2 space-y-1">
              <li v-for="file of message.attachments" :key="file.id">
                <button
                  type="button"
                  class="text-sm text-slate-700 underline hover:text-slate-900"
                  @click="download(file.id, file.fileName)"
                >
                  {{ t('portal.request.attachments.download', { name: file.fileName }) }}
                </button>
              </li>
            </ul>
          </li>
        </ol>
      </section>

      <!-- THE REPLY BOX, present only where the state allows it. -->
      <section v-if="ticket.replyOffered" class="mt-6">
        <h2 class="text-sm font-semibold">{{ t('portal.reply.heading') }}</h2>

        <p v-if="reopened" role="status" class="mt-2 text-sm text-slate-700">
          {{ t('portal.reply.reopened') }}
        </p>

        <p
          v-if="replyProblem"
          role="alert"
          class="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {{ replyProblem }}
        </p>

        <form class="mt-2" novalidate @submit.prevent="sendReply">
          <label for="reply-body" class="sr-only">{{ t('portal.reply.heading') }}</label>
          <textarea
            id="reply-body"
            v-model="replyBody"
            rows="4"
            :placeholder="t('portal.reply.placeholder')"
            class="w-full rounded-md border border-slate-300 px-3 py-2"
          />

          <p class="mt-2 text-xs text-slate-500">{{ t('portal.noUploads') }}</p>

          <button
            type="submit"
            :disabled="replyBusy"
            class="mt-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {{ replyBusy ? t('portal.reply.sending') : t('portal.reply.send') }}
          </button>
        </form>
      </section>

      <!-- CLOSED: no reply box at all, and a route onward rather than a dead end. -->
      <section v-else class="mt-6 rounded-md border border-slate-200 bg-white p-4">
        <h2 class="text-sm font-semibold">{{ t('portal.reply.closed.title') }}</h2>
        <p class="mt-1 text-sm text-slate-600">{{ t('portal.reply.closed.hint') }}</p>

        <RouterLink
          :to="{
            name: 'portal-new-request',
            query: { subject: t('portal.reply.closed.prefill', { reference: ticket.reference }) },
          }"
          class="mt-3 inline-block rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white"
        >
          {{ t('portal.reply.closed.raiseNew') }}
        </RouterLink>
      </section>

      <!-- THE RATING. A page section, never a modal, and it never nags: ignoring
           it costs nothing and creates nothing (FR-051). -->
      <section
        v-if="ticket.ratingOffered"
        class="mt-6 rounded-md border border-slate-200 bg-white p-4"
      >
        <h2 class="text-sm font-semibold">{{ t('portal.rating.title') }}</h2>

        <template v-if="ticket.satisfaction">
          <p role="status" class="mt-2 text-sm text-slate-700">
            {{
              t('portal.rating.recorded', {
                score: ticket.satisfaction.score,
                date: d(new Date(ticket.satisfaction.submittedAt), 'short'),
              })
            }}
          </p>
          <p v-if="ticket.satisfaction.comment" class="mt-1 text-sm text-slate-600">
            {{ ticket.satisfaction.comment }}
          </p>
        </template>

        <template v-else>
          <p class="mt-1 text-sm text-slate-600">{{ t('portal.rating.prompt') }}</p>

          <p
            v-if="ratingProblem"
            role="alert"
            class="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {{ ratingProblem }}
          </p>

          <form class="mt-3" novalidate @submit.prevent="sendRating">
            <!-- A RADIO GROUP, not a row of clickable icons. Keyboard operable
                 and announced as a single labelled choice (Principle IV). -->
            <fieldset>
              <legend class="text-sm font-medium text-slate-700">
                {{ t('portal.rating.score.label') }}
              </legend>

              <div class="mt-2 flex flex-wrap gap-3">
                <label
                  v-for="value of [1, 2, 3, 4, 5]"
                  :key="value"
                  class="flex items-center gap-2 text-sm"
                >
                  <input v-model="score" type="radio" name="score" :value="value" />
                  {{ t(`portal.rating.score.${value}`) }}
                </label>
              </div>
            </fieldset>

            <label for="rating-comment" class="mt-3 block text-sm font-medium text-slate-700">
              {{ t('portal.rating.comment') }}
            </label>
            <textarea
              id="rating-comment"
              v-model="comment"
              rows="3"
              class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />

            <button
              type="submit"
              :disabled="ratingBusy"
              class="mt-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {{ t('portal.rating.submit') }}
            </button>
          </form>
        </template>
      </section>
    </template>
  </div>
</template>
