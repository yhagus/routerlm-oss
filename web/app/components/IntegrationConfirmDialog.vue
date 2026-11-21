<script setup lang="ts">
import { apiErrorMessage } from "~/lib/api";
import {
  type CreatedIntegration,
  INTEGRATION_CONFIRM_COPY,
  type IntegrationConfirmKind,
  type IntegrationSummary,
} from "~/lib/integrations";

export interface IntegrationConfirmation {
  kind: IntegrationConfirmKind;
  integration: IntegrationSummary;
}

/**
 * Asks before rotating an Integration Secret or deleting an Integration, then
 * does it. Open while `confirmation` is set; a failure keeps it open with the
 * backend's message.
 */
const confirmation = defineModel<IntegrationConfirmation | null>("confirmation", {
  required: true,
});
const emit = defineEmits<{
  rotated: [integration: CreatedIntegration];
  deleted: [integration: IntegrationSummary];
}>();

const { $dashboardApi } = useNuxtApp();

const isConfirming = ref(false);
const confirmError = ref("");
const isOpen = computed({
  get: () => confirmation.value !== null,
  set: (open) => {
    if (!open) confirmation.value = null;
  },
});

watch(confirmation, () => {
  confirmError.value = "";
});

async function confirm(): Promise<void> {
  const current = confirmation.value;
  if (!current) return;
  isConfirming.value = true;
  confirmError.value = "";
  try {
    if (current.kind === "rotate") {
      const rotated = await $dashboardApi<CreatedIntegration>(
        `/integrations/${current.integration.id}/rotate`,
        { method: "POST" },
      );
      confirmation.value = null;
      emit("rotated", rotated);
    } else {
      await $dashboardApi(`/integrations/${current.integration.id}`, { method: "DELETE" });
      confirmation.value = null;
      emit("deleted", current.integration);
    }
  } catch (error) {
    confirmError.value = apiErrorMessage(error, INTEGRATION_CONFIRM_COPY[current.kind].failed);
  } finally {
    isConfirming.value = false;
  }
}
</script>

<template>
  <AppDialog
    v-if="confirmation"
    v-model:open="isOpen"
    :title="INTEGRATION_CONFIRM_COPY[confirmation.kind].title"
    :description="
      INTEGRATION_CONFIRM_COPY[confirmation.kind].description(confirmation.integration.name)
    "
  >
    <p v-if="confirmError" class="form__error" role="alert">{{ confirmError }}</p>
    <div class="dialog__actions">
      <button class="button" type="button" @click="confirmation = null">Cancel</button>
      <button
        class="button"
        :class="confirmation.kind === 'delete' ? 'button--danger' : 'button--primary'"
        type="button"
        :disabled="isConfirming"
        @click="confirm"
      >
        {{ INTEGRATION_CONFIRM_COPY[confirmation.kind].action }}
      </button>
    </div>
  </AppDialog>
</template>
