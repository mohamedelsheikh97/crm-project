import { computed, type ComputedRef } from 'vue';

import { useAuthStore } from '../stores/auth.store';

/**
 * `can()` governs DISPLAY ONLY.
 *
 * Hiding a control is required by FR-020, but it is never the barrier. Every
 * action it guards is enforced server-side by requirePermission middleware
 * (FR-015). If a 403 ever reaches the client, that is a real defect — the
 * interface offered something the server refused — not an expected state to
 * swallow quietly.
 */
export function usePermissions(): {
  can: (key: string) => boolean;
  canAny: (keys: string[]) => boolean;
  permissions: ComputedRef<Set<string>>;
} {
  const auth = useAuthStore();

  const permissions = computed(() => auth.permissions);

  return {
    can: (key: string) => permissions.value.has(key),
    canAny: (keys: string[]) => keys.some((key) => permissions.value.has(key)),
    permissions,
  };
}
