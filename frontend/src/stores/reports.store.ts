import { defineStore } from 'pinia';
import { ref } from 'vue';

/**
 * The reporting period and the user's dashboard layout (Phase 10).
 *
 * HOLDS THE PERIOD, NOT THE FIGURES. Caching figures here would reintroduce
 * exactly the staleness Clarifications Q3 rejected — a stored number that looks
 * current is this phase's central hazard — so figures live in the component
 * that fetched them and are discarded with it.
 *
 * The period lives here because FR-038 requires one filter to apply to every
 * figure on a surface, and a period held per-component is how two figures end
 * up showing different months.
 */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export const useReportsStore = defineStore('reports', () => {
  const from = ref(firstOfMonth());
  const to = ref(today());
  const layout = ref<string[]>([]);
  const layoutLoaded = ref(false);

  function setPeriod(nextFrom: string, nextTo: string): void {
    from.value = nextFrom;
    to.value = nextTo;
  }

  function setLayout(next: string[]): void {
    layout.value = next;
    layoutLoaded.value = true;
  }

  return { from, to, layout, layoutLoaded, setPeriod, setLayout };
});
