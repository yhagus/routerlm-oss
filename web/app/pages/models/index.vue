<script setup lang="ts">
import { Boxes, CloudOff, Plus, Power } from "@lucide/vue";
import { apiErrorMessage } from "~/lib/api";
import type { ModelDetail, ModelSummary } from "~/lib/routing";

useHead({ title: "Models" });

const { $dashboardApi } = useNuxtApp();
const { showToast } = useToast();
const {
  data: models,
  status: modelsStatus,
  error: loadError,
  refresh,
} = useDashboardApi<ModelSummary[]>("/models");
const isLoading = computed(() => modelsStatus.value === "pending" && !models.value);

const isCreateDialogOpen = ref(false);
const newModelName = ref("");
const isSaving = ref(false);
const dialogError = ref("");

function openCreateDialog(): void {
  newModelName.value = "";
  dialogError.value = "";
  isCreateDialogOpen.value = true;
}

async function createModel(): Promise<void> {
  isSaving.value = true;
  dialogError.value = "";
  try {
    const created = await $dashboardApi<Pick<ModelDetail, "id" | "name">>("/models", {
      method: "POST",
      body: { name: newModelName.value },
    });
    showToast(`Created ${created.name}. Add its Routes next.`);
    await navigateTo(`/models/${created.id}`);
  } catch (error) {
    dialogError.value = apiErrorMessage(error, "Couldn't create the Model.");
  } finally {
    isSaving.value = false;
  }
}

async function toggleModel(model: ModelSummary): Promise<void> {
  try {
    await $dashboardApi(`/models/${model.id}`, {
      method: "PATCH",
      body: { isEnabled: !model.isEnabled },
    });
    showToast(`${model.isEnabled ? "Disabled" : "Enabled"} ${model.name}`);
    await refresh();
  } catch (error) {
    showToast(apiErrorMessage(error, `Couldn't update ${model.name}.`));
  }
}
</script>

<template>
  <div class="page-view">
    <PageHeading
      title="Models"
      description="The model names clients send. Each Model tries its Routes in order until one serves the request."
    >
      <button class="button button--primary" type="button" @click="openCreateDialog">
        <Plus :size="14" /> Create Model
      </button>
    </PageHeading>

    <section class="panel table-panel">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th>Routes</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <LoadingRow v-if="isLoading" :columns="4" />
            <tr v-for="model in models" :key="model.id">
              <td>
                <NuxtLink class="table-entity" :to="`/models/${model.id}`">
                  <span class="key-icon"><Boxes :size="15" /></span
                  ><strong>{{ model.name }}</strong>
                </NuxtLink>
              </td>
              <td class="tabular">
                {{ model.routeCount }}
                <span v-if="model.routeCount === 0" class="status-badge status-badge--warn"
                  >No Routes</span
                >
              </td>
              <td>
                <span
                  class="status-badge"
                  :class="model.isEnabled ? 'status-badge--good' : 'status-badge--warn'"
                  >{{ model.isEnabled ? "Enabled" : "Disabled" }}</span
                >
              </td>
              <td>
                <div class="row-actions">
                  <button class="row-action" @click="toggleModel(model)">
                    <Power :size="14" /> {{ model.isEnabled ? "Disable" : "Enable" }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <EmptyState v-if="loadError" :icon="CloudOff" tone="error">
          <strong>Couldn't load Models.</strong
          ><span>Check that the backend is running, then reload the page.</span>
        </EmptyState>
        <EmptyState v-else-if="models?.length === 0" :icon="Boxes">
          <strong>No Models yet.</strong
          ><span>Create one with the name clients will send, then add its Routes.</span>
        </EmptyState>
      </div>
    </section>

    <AppDialog
      v-model:open="isCreateDialogOpen"
      title="Create Model"
      description="Clients send this name as the model. It must be unique."
    >
      <form class="form" @submit.prevent="createModel">
        <label class="field"
          ><span class="field__label">Name</span
          ><input v-model="newModelName" class="text-input" autocomplete="off" required
        /></label>
        <p v-if="dialogError" class="form__error" role="alert">{{ dialogError }}</p>
        <div class="dialog__actions">
          <button class="button" type="button" @click="isCreateDialogOpen = false">Cancel</button>
          <button class="button button--primary" type="submit" :disabled="isSaving">
            Create Model
          </button>
        </div>
      </form>
    </AppDialog>
  </div>
</template>
