import { defineStore } from 'pinia';
import { ref } from 'vue';

/**
 * Search and filter state for the customer list, kept in a store so returning
 * from a profile does not lose what the user had typed — an Agent on a call
 * should not have to search twice.
 */
export const useCustomersStore = defineStore('customers', () => {
  const search = ref('');
  const company = ref('');
  const includeInactive = ref(false);
  const page = ref(1);

  function reset(): void {
    search.value = '';
    company.value = '';
    includeInactive.value = false;
    page.value = 1;
  }

  return { search, company, includeInactive, page, reset };
});
