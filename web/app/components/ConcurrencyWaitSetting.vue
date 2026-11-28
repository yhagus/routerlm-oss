<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { apiErrorMessage } from '~/lib/api';
import { CONCURRENCY_WAIT_PATH, type ConcurrencyWaitSetting, formatSeconds } from '~/lib/settings';

const { $dashboardApi } = useNuxtApp();
const { showToast } = useToast();
const {
  data: setting,
  error: loadError,
  status,
  refresh,
} = useDashboardApi<ConcurrencyWaitSetting>(CONCURRENCY_WAIT_PATH, {
  key: CONCURRENCY_WAIT_PATH,
});

const isLoading = computed(() => status.value === 'pending' && !setting.value);

const secondsInput = ref('');
watch(
  () => setting.value?.seconds,
  (seconds) => {
    if (seconds !== undefined) secondsInput.value = String(seconds);
  },
  { immediate: true },
);

const enteredSeconds = computed(() =>
  secondsInput.value === '' ? Number.NaN : Number(secondsInput.value),
);
const isEnteredSecondsValid = computed(
  () =>
    setting.value !== undefined &&
    Number.isInteger(enteredSeconds.value) &&
    enteredSeconds.value >= setting.value.min &&
    enteredSeconds.value <= setting.value.max,
);
const isUnchanged = computed(() => enteredSeconds.value === setting.value?.seconds);

const isBusy = ref(false);
const saveError = ref('');

async function applyChange(change: () => Promise<string>): Promise<void> {
  isBusy.value = true;
  saveError.value = '';
  try {
    showToast(await change());
  } catch (error) {
    saveError.value = apiErrorMessage(error, "Couldn't update the Concurrency wait.");
  } finally {
    isBusy.value = false;
  }
}

function handleSave(): void {
  if (!isEnteredSecondsValid.value || isUnchanged.value) return;
  const seconds = enteredSeconds.value;
  void applyChange(async () => {
    setting.value = await $dashboardApi<ConcurrencyWaitSetting>(CONCURRENCY_WAIT_PATH, {
      method: 'PUT',
      body: { seconds },
    });
    return `Concurrency wait set to ${formatSeconds(setting.value.seconds)}`;
  });
}

function handleReset(): void {
  void applyChange(async () => {
    setting.value = await $dashboardApi<ConcurrencyWaitSetting>(CONCURRENCY_WAIT_PATH, {
      method: 'DELETE',
    });
    return `Concurrency wait reset to ${formatSeconds(setting.value.seconds)}`;
  });
}
</script>

<template>
  <section class="panel settings-panel" aria-labelledby="concurrency-wait-heading">
    <div class="panel-heading">
      <div>
        <h2 id="concurrency-wait-heading">Concurrency Limits</h2>
        <p>How long a request may wait for a free slot before it is refused.</p>
      </div>
    </div>

    <AppSpinner v-if="isLoading" label="Loading setting" />
    <div v-else-if="loadError || !setting" class="settings-panel__body">
      <p class="form__error" role="alert">Couldn't load the setting.</p>
      <button class="button" type="button" @click="() => refresh()">Try again</button>
    </div>
    <form v-else class="form settings-panel__body" @submit.prevent="handleSave">
      <label class="field">
        <span class="field__label">Concurrency wait</span>
        <NumberInput
          v-model="secondsInput"
          class="text-input settings-panel__days"
          whole
          :min="setting.min"
          :max="setting.max"
          suffix="seconds"
          required
        />
      </label>
      <p v-if="saveError" class="form__error" role="alert">{{ saveError }}</p>
      <div class="settings-panel__actions">
        <button
          class="button"
          type="button"
          :disabled="isBusy || setting.isDefault"
          @click="handleReset"
        >
          Reset to default
        </button>
        <button
          class="button button--primary"
          type="submit"
          :disabled="isBusy || !isEnteredSecondsValid || isUnchanged"
        >
          Save
        </button>
      </div>
    </form>
  </section>
</template>
