<script setup lang="ts">
import { apiErrorMessage } from "~/lib/api";
import { usageResetExpiry } from "~/lib/quotaMeters";
import type { ProviderAccount, ProviderAccountQuota } from "~/lib/upstream";

/**
 * Picks one of a Provider Account's Usage Resets, soonest expiry first, and
 * spends it. When spending fails, the account is reloaded so the list shows
 * what the Provider still offers.
 */
const props = defineProps<{
  account: ProviderAccount;
  /** The time expiries count from, in epoch milliseconds. */
  now: number;
  /** Reloads the account list. */
  refresh: () => Promise<unknown>;
}>();
const isOpen = defineModel<boolean>("open", { required: true });

const { $dashboardApi } = useNuxtApp();
const { showToast } = useToast();

const usageResets = computed(() => props.account.usageResets ?? []);
/** The operator's pick; null until they pick, which leaves the first one chosen. */
const pickedResetId = ref<string | null>(null);
/** Falls back to the first reset when the pick is gone from a reloaded list. */
const chosenResetId = computed(() => {
  const isPickListed = usageResets.value.some((reset) => reset.id === pickedResetId.value);
  return isPickListed ? pickedResetId.value : (usageResets.value[0]?.id ?? null);
});
const isUsing = ref(false);
const useError = ref("");
/**
 * One key per reset per opening, so a double click or a retry after a failed
 * request can never spend a second reset.
 */
const idempotencyKeys = new Map<string, string>();

watch(isOpen, (open) => {
  if (!open) return;
  pickedResetId.value = null;
  useError.value = "";
  idempotencyKeys.clear();
});

function idempotencyKeyFor(resetId: string): string {
  const key = idempotencyKeys.get(resetId) ?? crypto.randomUUID();
  idempotencyKeys.set(resetId, key);
  return key;
}

async function handleUse(): Promise<void> {
  if (chosenResetId.value === null || isUsing.value) return;
  isUsing.value = true;
  useError.value = "";
  try {
    await $dashboardApi<ProviderAccountQuota>(
      `/provider-accounts/${props.account.id}/usage-resets/${chosenResetId.value}/use`,
      { method: "POST", body: { idempotencyKey: idempotencyKeyFor(chosenResetId.value) } },
    );
    await props.refresh();
    isOpen.value = false;
    showToast(`Used a usage reset on ${props.account.name}`);
  } catch (error) {
    useError.value = apiErrorMessage(error, "Couldn't use the usage reset.");
    await props.refresh();
  } finally {
    isUsing.value = false;
  }
}
</script>

<template>
  <AppDialog
    v-model:open="isOpen"
    :title="`Use a usage reset on ${account.name}`"
    description="The Provider restores this account's Quota Meters early. A usage reset can be used only once."
  >
    <fieldset class="usage-reset-choices">
      <legend class="sr-only">Usage reset to use</legend>
      <label v-for="reset in usageResets" :key="reset.id" class="usage-reset-choice">
        <input
          type="radio"
          name="usage-reset"
          :value="reset.id"
          :checked="reset.id === chosenResetId"
          @change="pickedResetId = reset.id"
        />
        <span class="usage-reset-choice__title">{{ reset.title }}</span>
        <span class="usage-reset-choice__expiry tabular">{{
          usageResetExpiry(reset.expiresAt, now)
        }}</span>
      </label>
      <p v-if="usageResets.length === 0" class="field__note">No usage resets left.</p>
    </fieldset>
    <p v-if="useError" class="form__error" role="alert">{{ useError }}</p>
    <div class="dialog__actions">
      <button class="button" type="button" @click="isOpen = false">Cancel</button>
      <button
        class="button button--primary"
        type="button"
        :disabled="isUsing || chosenResetId === null"
        @click="handleUse"
      >
        <AppSpinner v-if="isUsing" label="" />
        Use reset
      </button>
    </div>
  </AppDialog>
</template>
