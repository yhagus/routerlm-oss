import { computed, type ComputedRef, type WritableComputedRef } from 'vue';
import { type ActiveFilter, listFilterTokens, textFilterTokens } from '~/lib/activeFilters';
import type { IntegrationSummary, RecordedIntegration } from '~/lib/integrations';
import { type FilterOption, isUuid, missingOptions } from '~/lib/queryFilters';

export interface OwnerFilters {
  integrationFilter: WritableComputedRef<string[]>;
  customerFilter: WritableComputedRef<string>;
  integrationOptions: ComputedRef<FilterOption[]>;
  ownerFilterTokens: ComputedRef<ActiveFilter[]>;
  clearOwnerFilters: () => void;
}

export function useOwnerFilters(
  shownRecords: () => readonly RecordedIntegration[] = () => [],
): OwnerFilters {
  const integrationFilter = useQueryList('integration', { isValid: isUuid });
  const customerFilter = useQueryParam('customer', { default: '', isValid: anyText });

  const { data: integrations } = useDashboardApi<IntegrationSummary[]>('/integrations');
  const integrationOptions = computed(() => {
    const existing = (integrations.value ?? []).map((integration) => ({
      value: integration.id,
      label: integration.name,
    }));
    const deleted = deletedIntegrationOptions(integrationFilter.value, existing, shownRecords());
    const known = [...existing, ...deleted];
    return [...known, ...missingOptions(integrationFilter.value, known)];
  });

  const ownerFilterTokens = computed(() => [
    ...listFilterTokens('Integration', integrationFilter, integrationOptions.value),
    ...textFilterTokens('Customer', customerFilter),
  ]);

  function clearOwnerFilters(): void {
    integrationFilter.value = [];
    customerFilter.value = '';
  }

  return {
    integrationFilter,
    customerFilter,
    integrationOptions,
    ownerFilterTokens,
    clearOwnerFilters,
  };
}

function deletedIntegrationOptions(
  picked: readonly string[],
  existing: readonly FilterOption[],
  records: readonly RecordedIntegration[],
): FilterOption[] {
  return picked
    .filter((id) => !existing.some((option) => option.value === id))
    .flatMap((id) => {
      const name = records.find((record) => record.integrationId === id)?.integrationName;
      return name ? [{ value: id, label: `${name} (deleted)` }] : [];
    });
}
