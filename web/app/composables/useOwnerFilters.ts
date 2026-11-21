import { computed, type ComputedRef, type WritableComputedRef } from "vue";
import { type ActiveFilter, listFilterTokens, textFilterTokens } from "~/lib/activeFilters";
import type { IntegrationSummary } from "~/lib/integrations";
import { type FilterOption, isUuid, missingOptions } from "~/lib/queryFilters";

export interface OwnerFilters {
  /** Integration ids; a row matches any of them. */
  integrationFilter: WritableComputedRef<string[]>;
  /** A Customer id, matched exactly; "" for any Customer. */
  customerFilter: WritableComputedRef<string>;
  integrationOptions: ComputedRef<FilterOption[]>;
  /** The Integration and Customer tokens for the active-filters row. */
  ownerFilterTokens: ComputedRef<ActiveFilter[]>;
  clearOwnerFilters: () => void;
}

/**
 * The Integration and Customer id filters, held in the URL
 * (?integration=…,…&customer=…) like a page's other filters.
 */
export function useOwnerFilters(): OwnerFilters {
  const integrationFilter = useQueryList("integration", { isValid: isUuid });
  const customerFilter = useQueryParam("customer", { default: "", isValid: anyText });

  const { data: integrations } = useDashboardApi<IntegrationSummary[]>("/integrations");
  const integrationOptions = computed(() => {
    const known = (integrations.value ?? []).map((integration) => ({
      value: integration.id,
      label: integration.name,
    }));
    return [...known, ...missingOptions(integrationFilter.value, known)];
  });

  const ownerFilterTokens = computed(() => [
    ...listFilterTokens("Integration", integrationFilter, integrationOptions.value),
    ...textFilterTokens("Customer", customerFilter),
  ]);

  function clearOwnerFilters(): void {
    integrationFilter.value = [];
    customerFilter.value = "";
  }

  return {
    integrationFilter,
    customerFilter,
    integrationOptions,
    ownerFilterTokens,
    clearOwnerFilters,
  };
}
