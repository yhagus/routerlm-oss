<script setup lang="ts">
import { KeyRound, RefreshCw } from "@lucide/vue";
import { apiErrorMessage } from "~/lib/api";
import type { ApiKeyRotation, ApiKeySummary } from "~/lib/api-keys";
import { dateTimeFormat } from "~/lib/dateFormats";

const props = defineProps<{ apiKey: ApiKeySummary }>();
const isOpen = defineModel<boolean>("open", { required: true });

const { $dashboardApi } = useNuxtApp();

const rotations = ref<ApiKeyRotation[] | null>(null);
const loadError = ref("");

async function load(): Promise<void> {
  rotations.value = null;
  loadError.value = "";
  try {
    rotations.value = await $dashboardApi<ApiKeyRotation[]>(
      `/api-keys/${props.apiKey.id}/rotations`,
    );
  } catch (error) {
    loadError.value = apiErrorMessage(error, "Couldn't load the rotation history.");
  }
}

watch(
  isOpen,
  (open) => {
    if (open) void load();
  },
  { immediate: true },
);

function formatTime(value: string): string {
  return dateTimeFormat.format(new Date(value));
}
</script>

<template>
  <AppDialog
    v-model:open="isOpen"
    :title="`Rotations of ${apiKey.name}`"
    description="Each rotation replaced the key; the key it replaced stopped working at once."
  >
    <div v-if="loadError" class="rotation-log__state">
      <p class="form__error" role="alert">{{ loadError }}</p>
      <button class="button" type="button" @click="load">Try again</button>
    </div>
    <div v-else-if="rotations === null" class="rotation-log__state" aria-busy="true">
      <AppSpinner />
    </div>
    <ol v-else class="rotation-log">
      <li v-for="(rotation, index) in rotations" :key="rotation.id" class="rotation-log__entry">
        <span class="rotation-log__mark"><RefreshCw :size="12" aria-hidden="true" /></span>
        <div class="rotation-log__body">
          <p class="rotation-log__head">
            <strong>Rotated</strong>
            <time class="tabular" :datetime="rotation.rotatedAt">{{
              formatTime(rotation.rotatedAt)
            }}</time>
          </p>
          <p class="rotation-log__keys tabular">
            <span class="rotation-log__old">rlm_{{ rotation.previousKeyId }}</span>
            <span aria-hidden="true">→</span>
            <span class="sr-only">replaced by</span>
            <span>rlm_{{ rotation.newKeyId }}</span>
            <span v-if="index === 0 && !apiKey.revokedAt" class="rotation-log__current"
              >Current</span
            >
          </p>
          <p class="rotation-log__by">by {{ rotation.rotatedBy?.email ?? "a deleted User" }}</p>
        </div>
      </li>
      <li class="rotation-log__entry rotation-log__entry--origin">
        <span class="rotation-log__mark"><KeyRound :size="12" aria-hidden="true" /></span>
        <div class="rotation-log__body">
          <p class="rotation-log__head">
            <strong>Created</strong>
            <time class="tabular" :datetime="apiKey.createdAt">{{
              formatTime(apiKey.createdAt)
            }}</time>
          </p>
          <p class="rotation-log__by">by {{ apiKey.createdBy?.email ?? "a deleted User" }}</p>
        </div>
      </li>
    </ol>
    <p v-if="rotations && rotations.length === 0" class="field__note">
      No rotation recorded. Rotations made before this history existed aren't listed.
    </p>
    <div class="dialog__actions">
      <button class="button button--primary" type="button" @click="isOpen = false">Done</button>
    </div>
  </AppDialog>
</template>
