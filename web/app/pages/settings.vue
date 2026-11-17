<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { apiErrorMessage } from "~/lib/api";
import {
  ERROR_CAPTURE_RETENTION_PATH,
  type ErrorCaptureImpact,
  type ErrorCaptureRetention,
  formatDays,
  TERMS_RISK_PROVIDERS_PATH,
  type TermsRiskProvidersSetting,
} from "~/lib/settings";

useHead({ title: "Settings" });

/** A shortening that will delete Error Captures, waiting for the User to confirm. */
interface PendingShortening {
  days: number;
  deleteCount: number;
}

const { $dashboardApi } = useNuxtApp();
const { showToast } = useToast();
const {
  data: retention,
  error: loadError,
  status: retentionStatus,
  refresh,
} = useDashboardApi<ErrorCaptureRetention>(ERROR_CAPTURE_RETENTION_PATH, {
  key: ERROR_CAPTURE_RETENTION_PATH,
});

const isLoading = computed(() => retentionStatus.value === "pending" && !retention.value);

const daysInput = ref("");
watch(
  () => retention.value?.days,
  (days) => {
    if (days !== undefined) daysInput.value = String(days);
  },
  { immediate: true },
);

const enteredDays = computed(() => (daysInput.value === "" ? Number.NaN : Number(daysInput.value)));
const isEnteredDaysValid = computed(
  () =>
    retention.value !== undefined &&
    Number.isInteger(enteredDays.value) &&
    enteredDays.value >= retention.value.min &&
    enteredDays.value <= retention.value.max,
);
const isUnchanged = computed(() => enteredDays.value === retention.value?.days);
const isLengthening = computed(
  () => retention.value !== undefined && enteredDays.value > retention.value.days,
);

const {
  setting: termsRisk,
  error: termsRiskLoadError,
  status: termsRiskStatus,
  refresh: refreshTermsRisk,
} = useTermsRiskAllowed();
const isTermsRiskLoading = computed(() => termsRiskStatus.value === "pending" && !termsRisk.value);
const isTermsRiskBusy = ref(false);
const termsRiskError = ref("");
const isAllowConfirmOpen = ref(false);

async function putTermsRiskAllowed(allowed: boolean): Promise<void> {
  isTermsRiskBusy.value = true;
  termsRiskError.value = "";
  try {
    await $dashboardApi<TermsRiskProvidersSetting>(TERMS_RISK_PROVIDERS_PATH, {
      method: "PUT",
      body: { allowed },
    });
    await refreshNuxtData(TERMS_RISK_PROVIDERS_PATH);
    showToast(allowed ? "Terms-risk Providers allowed" : "Terms-risk Providers blocked");
  } catch (error) {
    termsRiskError.value = apiErrorMessage(error, "Couldn't update the setting.");
  } finally {
    isTermsRiskBusy.value = false;
    isAllowConfirmOpen.value = false;
  }
}

/** Turning on asks first; the switch only moves once the saved value changes. */
function handleTermsRiskToggle(event: Event): void {
  if (!(event.target instanceof HTMLInputElement) || !termsRisk.value) return;
  const allowed = event.target.checked;
  event.target.checked = termsRisk.value.allowed;
  if (allowed) isAllowConfirmOpen.value = true;
  else void putTermsRiskAllowed(false);
}

const isBusy = ref(false);
const saveError = ref("");
const pendingShortening = ref<PendingShortening | null>(null);
const isConfirmOpen = computed({
  get: () => pendingShortening.value !== null,
  set: (isOpen) => {
    if (!isOpen) pendingShortening.value = null;
  },
});

/** Saves at once unless the new value is shorter and would delete Error Captures. */
async function requestChange(days: number, apply: () => Promise<void>): Promise<void> {
  if (!retention.value) return;
  isBusy.value = true;
  saveError.value = "";
  try {
    if (days < retention.value.days) {
      const { deleteCount } = await $dashboardApi<ErrorCaptureImpact>(
        `${ERROR_CAPTURE_RETENTION_PATH}/impact`,
        { query: { days } },
      );
      if (deleteCount > 0) {
        pendingShortening.value = { days, deleteCount };
        return;
      }
    }
    await apply();
  } catch (error) {
    saveError.value = apiErrorMessage(error, "Couldn't update the Retention Period.");
  } finally {
    isBusy.value = false;
  }
}

async function putDays(days: number): Promise<void> {
  retention.value = await $dashboardApi<ErrorCaptureRetention>(ERROR_CAPTURE_RETENTION_PATH, {
    method: "PUT",
    body: { days },
  });
  showToast(`Retention Period set to ${formatDays(retention.value.days)}`);
}

async function deleteCustomDays(): Promise<void> {
  retention.value = await $dashboardApi<ErrorCaptureRetention>(ERROR_CAPTURE_RETENTION_PATH, {
    method: "DELETE",
  });
  showToast(`Retention Period reset to ${formatDays(retention.value.days)}`);
}

function handleSave(): void {
  if (!isEnteredDaysValid.value || isUnchanged.value) return;
  const days = enteredDays.value;
  void requestChange(days, () => putDays(days));
}

function handleReset(): void {
  if (!retention.value) return;
  void requestChange(retention.value.defaultDays, deleteCustomDays);
}

async function confirmShortening(): Promise<void> {
  const shortening = pendingShortening.value;
  if (!shortening || !retention.value) return;
  isBusy.value = true;
  saveError.value = "";
  try {
    if (shortening.days === retention.value.defaultDays) await deleteCustomDays();
    else await putDays(shortening.days);
    pendingShortening.value = null;
  } catch (error) {
    saveError.value = apiErrorMessage(error, "Couldn't update the Retention Period.");
    pendingShortening.value = null;
  } finally {
    isBusy.value = false;
  }
}
</script>

<template>
  <div class="page-view">
    <PageHeading
      title="Settings"
      description="Gateway behaviour you can change without a restart."
    />

    <section class="panel settings-panel" aria-labelledby="error-captures-heading">
      <div class="panel-heading">
        <div>
          <h2 id="error-captures-heading">Error Captures</h2>
          <p>How long failed requests are kept before they are deleted.</p>
        </div>
      </div>

      <AppSpinner v-if="isLoading" label="Loading settings" />
      <div v-else-if="loadError || !retention" class="settings-panel__body">
        <p class="form__error" role="alert">Couldn't load the Retention Period.</p>
        <button class="button" type="button" @click="() => refresh()">Try again</button>
      </div>
      <form v-else class="form settings-panel__body" @submit.prevent="handleSave">
        <label class="field">
          <span class="field__label">Retention Period</span>
          <NumberInput
            v-model="daysInput"
            class="text-input settings-panel__days"
            whole
            :min="retention.min"
            :max="retention.max"
            suffix="days"
            required
          />
        </label>
        <p class="model-choices__hint">
          Allowed: {{ retention.min }} to {{ retention.max }} days. The default is
          {{ formatDays(retention.defaultDays) }};
          {{ retention.isDefault ? "this is the default." : "a custom value is set." }}
        </p>
        <p class="model-choices__hint">
          Error Captures older than this are deleted by the hourly clean-up. Lengthening it never
          brings back captures that were already deleted.
        </p>
        <p v-if="isLengthening" class="model-choices__hint">
          Lengthening keeps captures longer from now on only.
        </p>
        <p v-if="saveError" class="form__error" role="alert">{{ saveError }}</p>
        <div class="settings-panel__actions">
          <button
            class="button"
            type="button"
            :disabled="isBusy || retention.isDefault"
            @click="handleReset"
          >
            Reset to default
          </button>
          <button
            class="button button--primary"
            type="submit"
            :disabled="isBusy || !isEnteredDaysValid || isUnchanged"
          >
            Save
          </button>
        </div>
      </form>
    </section>

    <section class="panel settings-panel" aria-labelledby="terms-risk-heading">
      <div class="panel-heading">
        <div>
          <h2 id="terms-risk-heading">Terms risk</h2>
          <p>Whether Providers marked Terms risk can be used.</p>
        </div>
      </div>

      <AppSpinner v-if="isTermsRiskLoading" label="Loading setting" />
      <div v-else-if="termsRiskLoadError || !termsRisk" class="settings-panel__body">
        <p class="form__error" role="alert">Couldn't load the setting.</p>
        <button class="button" type="button" @click="() => refreshTermsRisk()">Try again</button>
      </div>
      <div v-else class="settings-panel__body">
        <label class="check-field">
          <input
            type="checkbox"
            role="switch"
            :checked="termsRisk.allowed"
            :disabled="isTermsRiskBusy"
            @change="handleTermsRiskToggle"
          />
          Allow terms-risk providers
        </label>
        <p class="model-choices__hint">
          Providers marked Terms risk, such as Kimi Code and MiniMax M Plan, may breach their
          provider's terms of use when used through a gateway. While this is off they cannot be
          used; they are not disabled, and turning this on makes them usable again.
        </p>
        <p v-if="termsRiskError" class="form__error" role="alert">{{ termsRiskError }}</p>
      </div>
    </section>

    <AppDialog
      v-model:open="isAllowConfirmOpen"
      title="Allow terms-risk providers?"
      description="Using these Providers through a gateway may breach their terms of use, which can put the accounts behind them at risk."
    >
      <div class="dialog__actions">
        <button class="button" type="button" @click="isAllowConfirmOpen = false">Cancel</button>
        <button
          class="button button--danger"
          type="button"
          :disabled="isTermsRiskBusy"
          @click="putTermsRiskAllowed(true)"
        >
          Allow
        </button>
      </div>
    </AppDialog>

    <AppDialog
      v-if="pendingShortening"
      v-model:open="isConfirmOpen"
      title="Delete older Error Captures?"
      :description="`${pendingShortening.deleteCount} Error Captures older than ${formatDays(pendingShortening.days)} will be permanently deleted at the next hourly run. This can't be undone.`"
    >
      <div class="dialog__actions">
        <button class="button" type="button" @click="pendingShortening = null">Cancel</button>
        <button
          class="button button--danger"
          type="button"
          :disabled="isBusy"
          @click="confirmShortening"
        >
          Shorten and delete
        </button>
      </div>
    </AppDialog>
  </div>
</template>
