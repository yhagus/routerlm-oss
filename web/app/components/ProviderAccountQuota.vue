<script setup lang="ts">
import { RefreshCw } from "@lucide/vue";
import { apiErrorMessage } from "~/lib/api";
import { checkedAgo, usageResetCount } from "~/lib/quotaMeters";
import type { ProviderAccount, ProviderAccountQuota } from "~/lib/upstream";

const props = defineProps<{
  account: ProviderAccount;
  now: number;
  refresh: () => Promise<unknown>;
}>();

const { $dashboardApi } = useNuxtApp();
const { showToast } = useToast();

const isReading = ref(false);
const isUsageResetPickerOpen = ref(false);

const mainMeters = computed(() => props.account.quotaMeters.filter((meter) => !meter.scope));
const scopedMeters = computed(() => props.account.quotaMeters.filter((meter) => meter.scope));
const usageResetTotal = computed(() => props.account.usageResets?.length ?? 0);

async function handleRefresh(): Promise<void> {
  isReading.value = true;
  try {
    const reading = await $dashboardApi<ProviderAccountQuota>(
      `/provider-accounts/${props.account.id}/quota-reading`,
      { method: "POST" },
    );
    if (reading.quotaError) showToast(`Couldn't read the Quota Meters of ${props.account.name}.`);
    await props.refresh();
  } catch (error) {
    showToast(apiErrorMessage(error, `Couldn't read the Quota Meters of ${props.account.name}.`));
  } finally {
    isReading.value = false;
  }
}
</script>

<template>
  <div class="account-quota">
    <QuotaMeterBar v-for="meter in mainMeters" :key="meter.key" :meter="meter" :now="now" />
    <details v-if="scopedMeters.length" class="account-quota__scoped">
      <summary>Model group meters ({{ scopedMeters.length }})</summary>
      <QuotaMeterBar
        v-for="meter in scopedMeters"
        :key="meter.key"
        :meter="meter"
        :now="now"
        is-compact
      />
    </details>
    <p v-if="account.quotaError" class="account-quota__error" role="status">
      {{ account.quotaError }}
    </p>
    <div v-if="account.usageResets" class="account-quota__footer">
      <span class="cell-note tabular">{{ usageResetCount(usageResetTotal) }}</span>
      <button
        v-if="usageResetTotal > 0"
        class="text-button"
        type="button"
        :aria-label="`Use a usage reset on ${account.name}`"
        @click="isUsageResetPickerOpen = true"
      >
        Use a reset…
      </button>
    </div>
    <div class="account-quota__footer">
      <span class="cell-note tabular">{{ checkedAgo(account.quotaCheckedAt, now) }}</span>
      <button
        class="text-button"
        type="button"
        :disabled="isReading"
        :aria-label="`Refresh the Quota Meters of ${account.name}`"
        @click="handleRefresh"
      >
        <AppSpinner v-if="isReading" label="" />
        <RefreshCw v-else :size="12" />
        Refresh
      </button>
    </div>
    <UsageResetPickerDialog
      v-if="account.usageResets"
      v-model:open="isUsageResetPickerOpen"
      :account="account"
      :now="now"
      :refresh="refresh"
    />
  </div>
</template>
