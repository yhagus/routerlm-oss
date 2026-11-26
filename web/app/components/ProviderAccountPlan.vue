<script setup lang="ts">
import { RefreshCw } from '@lucide/vue';
import { apiErrorMessage } from '~/lib/api';
import { checkedAgo } from '~/lib/quotaMeters';
import {
  AUTO_PLAN_CHOICE,
  listedPlanName,
  NO_PLAN_CHOICE,
  type Provider,
  type ProviderAccount,
} from '~/lib/upstream';

const props = defineProps<{
  provider: Provider;
  account: ProviderAccount;
  now: number;
  refresh: () => Promise<unknown>;
}>();

const { $dashboardApi } = useNuxtApp();
const { showToast } = useToast();

const isReading = ref(false);

const PAYS_PER_TOKEN_LABEL = 'No plan (pay as you go)';

interface PlanDisplay {
  label: string;
  note: string | null;
}

const hasPlanReader = computed(() => props.provider.planReader !== null);

function planName(value: string): string {
  return listedPlanName(props.provider, value) ?? value;
}

function readPlanLabel(): string {
  if (props.account.plan !== null) return planName(props.account.plan);
  return hasPlanReader.value ? PAYS_PER_TOKEN_LABEL : 'Not set';
}

function manualPlanNote(chosenPlan: string): string {
  const readPlan = props.account.plan;
  if (!hasPlanReader.value || readPlan === chosenPlan) return 'Set manually';
  const reported = readPlan === null ? 'no plan' : planName(readPlan);
  return `Set manually · the Provider reports ${reported}`;
}

const planDisplay = computed((): PlanDisplay => {
  const { planChoice } = props.account;
  if (planChoice === AUTO_PLAN_CHOICE) return { label: readPlanLabel(), note: null };
  if (planChoice === NO_PLAN_CHOICE) return { label: PAYS_PER_TOKEN_LABEL, note: null };
  const chosenName = listedPlanName(props.provider, planChoice);
  const label = chosenName ?? `${planChoice} (no longer listed)`;
  return { label, note: manualPlanNote(planChoice) };
});

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
    <span>{{ planDisplay.label }}</span>
    <span v-if="planDisplay.note" class="cell-note">{{ planDisplay.note }}</span>
    <div v-if="hasPlanReader" class="account-plan__footer">
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
