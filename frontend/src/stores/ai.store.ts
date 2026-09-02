import { defineStore } from 'pinia';
import { ref } from 'vue';

/**
 * Which AI features are available, and what each surface is currently doing
 * (Phase 9, FR-002).
 *
 * HOLDS AVAILABILITY, NOT CONTENT. No summary, draft, or proposal is cached
 * here: they are computed on read and thrown away (research D7, FR-065b,
 * FR-065c), and a store that kept them would quietly reintroduce the staleness
 * the design removed — a cached summary of a ticket that has since received
 * three messages is worse than an empty panel, because it looks current.
 *
 * Availability is read once and reused across screens, so a disabled feature
 * costs one request per session rather than one per ticket.
 */
export interface AiAvailability {
  summary: boolean;
  draft: boolean;
  classify: boolean;
  similar: boolean;
  assistant: boolean;
}

const NOTHING_AVAILABLE: AiAvailability = {
  summary: false,
  draft: false,
  classify: false,
  similar: false,
  assistant: false,
};

export const useAiStore = defineStore('ai', () => {
  /**
   * Defaults to everything OFF. With the capability disabled or unreachable,
   * the product is Phase 8 (FR-001) — so the safe default is the one where no
   * surface is offered, and a failed availability read degrades to that rather
   * than to a screen full of buttons that error.
   */
  const availability = ref<AiAvailability>({ ...NOTHING_AVAILABLE });
  const loaded = ref(false);

  function set(next: Partial<AiAvailability>): void {
    availability.value = { ...NOTHING_AVAILABLE, ...next };
    loaded.value = true;
  }

  function clear(): void {
    availability.value = { ...NOTHING_AVAILABLE };
    loaded.value = false;
  }

  function isOn(feature: keyof AiAvailability): boolean {
    return availability.value[feature];
  }

  return { availability, loaded, set, clear, isOn };
});
