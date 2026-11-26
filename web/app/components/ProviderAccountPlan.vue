<script setup lang="ts">
import { RefreshCw } from '@lucide/vue';
import { apiErrorMessage } from '~/lib/api';
import { checkedAgo } from '~/lib/quotaMeters';
import type { ProviderAccount } from '~/lib/upstream';

const props = defineProps<{
  account: ProviderAccount;
  now: number;
  refresh: () => Promise<unknown>;
}>();

const { $dashboardApi } = useNuxtApp();
const { showToast } = useToast();

const isReading = ref(false);

const planLabel = computed(() => props.account.plan ?? 'No plan (pay as you go)');

async function handleRefresh(): Promise<void> {
  const failureMessage = `Couldn't read the Plan of ${props.account.name}.`;
  isReading.value = true;
  try {
    const updated = await $dashboardApi<ProviderAccount>(
      `/provider-accounts/${props.account.id}/plan`,
      { method: 'POST' },
    );
    const isPlanUnread = updated.planCheckedAt === props.account.planCheckedAt;
    if (isPlanUnread) showToast(failureMessage);
    await props.refresh();
  } catch (error) {
    showToast(apiErrorMessage(error, failureMessage));
  } finally {
    isReading.value = false;
  }
}
</script>

<template>
  <div class="account-plan">
    <span>{{ planLabel }}</span>
    <div class="account-plan__footer">
      <span class="cell-note tabular">{{ checkedAgo(account.planCheckedAt, now) }}</span>
      <button
        class="text-button"
        type="button"
        :disabled="isReading"
        :aria-label="`Refresh the Plan of ${account.name}`"
        @click="handleRefresh"
      >
        <AppSpinner v-if="isReading" label="" />
        <RefreshCw v-else :size="12" />
        Refresh plan
      </button>
    </div>
  </div>
</template>
