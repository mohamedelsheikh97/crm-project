<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';

import { ApiError } from '../../services/http';
import { fetchCustomerContext, type CustomerContext } from '../../services/dashboard.service';
import TicketStatusBadge from './TicketStatusBadge.vue';

/**
 * Who the customer is, beside the ticket rather than one click behind it.
 *
 * This panel is the half of PLAN.md's Definition of done that says "without
 * navigating away". An agent who has to open a second screen to see who they
 * are talking to has been given a bookmark, not a workspace.
 *
 * IT IS AN ENHANCEMENT, NEVER A GATE (FR-018). A caller without
 * `customers:view` gets a 403 here, and the correct response is to render
 * nothing and stay silent — the ticket beside it remains fully workable, so
 * surfacing this as an error would report a problem the agent does not have.
 */
const props = defineProps<{ ticketId: number }>();

const context = ref<CustomerContext | null>(null);
const loading = ref(false);
/** True when the caller may not view customers. Not an error state. */
const withheld = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  withheld.value = false;

  try {
    context.value = await fetchCustomerContext(props.ticketId);
  } catch (error) {
    context.value = null;

    if (error instanceof ApiError && error.status === 403) {
      withheld.value = true;
      return;
    }

    // Any other failure also leaves the panel absent rather than breaking the
    // ticket screen around it.
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => props.ticketId, load);
</script>

<template>
  <!-- Rendered as an <aside>: it is supporting context for the ticket, and
       screen-reader users navigating by landmark should be able to skip it. -->
  <aside v-if="!withheld" :aria-label="$t('context.title')" class="space-y-4">
    <p v-if="loading" class="text-sm text-slate-500">{{ $t('table.loading') }}</p>

    <template v-else-if="context">
      <section>
        <h2 class="text-sm font-medium">{{ $t('context.customer') }}</h2>

        <RouterLink
          :to="{ name: 'customer-profile', params: { id: context.customer.id } }"
          class="mt-1 block rounded text-blue-700 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-blue-300"
        >
          {{ context.customer.displayName }}
        </RouterLink>

        <p v-if="context.customer.company" class="text-sm text-slate-600 dark:text-slate-400">
          {{ context.customer.company }}
        </p>

        <!-- Reported, never a blocker: a deactivated customer's ticket stays
             workable (FR-016). -->
        <p v-if="!context.customer.isActive" class="mt-1 text-sm font-medium text-amber-700">
          {{ $t('context.customerInactive') }}
        </p>

        <ul class="mt-2 space-y-1 text-sm">
          <li v-for="contact in context.customer.contacts" :key="contact.id">
            <span class="text-slate-500">{{ $t(`customerForm.kind.${contact.kind}`) }}:</span>
            <!-- The RAW value, as the customer gave it. The normalised form
                 exists for duplicate matching and would be unhelpful to read
                 aloud. -->
            <span class="ms-1">{{ contact.value }}</span>
            <span v-if="contact.isPrimary" class="ms-1 text-xs text-slate-500">
              ({{ $t('customerForm.primary') }})
            </span>
          </li>
        </ul>
      </section>

      <section>
        <h2 class="text-sm font-medium">{{ $t('context.otherTickets') }}</h2>

        <p
          v-if="context.otherTickets.length === 0"
          class="mt-1 text-sm text-slate-600 dark:text-slate-400"
        >
          {{ $t('context.noOtherTickets') }}
        </p>

        <ul v-else class="mt-1 space-y-1">
          <li v-for="other in context.otherTickets" :key="other.id" class="text-sm">
            <RouterLink
              :to="{ name: 'ticket-detail', params: { id: other.id } }"
              class="rounded font-mono text-blue-700 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-blue-300"
            >
              {{ other.reference }}
            </RouterLink>
            <span class="ms-2">{{ other.subject }}</span>
            <TicketStatusBadge class="ms-2" :status="other.status" />
          </li>
        </ul>
      </section>

      <section>
        <h2 class="text-sm font-medium">{{ $t('context.recentNotes') }}</h2>

        <p
          v-if="context.recentNotes.length === 0"
          class="mt-1 text-sm text-slate-600 dark:text-slate-400"
        >
          {{ $t('context.noNotes') }}
        </p>

        <ul v-else class="mt-1 space-y-2">
          <li v-for="note in context.recentNotes" :key="note.id" class="text-sm">
            <p class="whitespace-pre-wrap break-words">{{ note.body }}</p>
            <p class="mt-0.5 text-xs text-slate-500">
              {{ note.author?.fullName ?? $t('audit.actor.anonymous') }}
            </p>
          </li>
        </ul>
      </section>
    </template>
  </aside>
</template>
