<script setup lang="ts">
import {
  ArrowDown,
  ArrowUp,
  CloudOff,
  Pencil,
  Plus,
  Power,
  Route,
  SlidersHorizontal,
  Trash2,
} from '@lucide/vue';
import { apiErrorMessage } from '~/lib/api';
import { isNotFound } from '~/lib/errors';
import { modelNameProblem, publishedModelNames } from '~/lib/modelGroups';
import { TERMS_RISK_BLOCKED_HINT } from '~/lib/settings';
import { isEmptyPolicy, type ParameterPolicy } from '~/lib/parameterPolicy';
import {
  displayNameProblem,
  displayNameValue,
  type ModelDetail,
  modelLabelOf,
  type RouteSummary,
} from '~/lib/routing';
import {
  MODEL_KIND_LABELS,
  type Provider,
  type UpstreamModel,
  upstreamModelLabel,
} from '~/lib/upstream';

type ModelDialog =
  | { kind: 'edit' }
  | { kind: 'delete' }
  | { kind: 'add-route' }
  | { kind: 'remove-route'; route: RouteSummary }
  | { kind: 'route-policy'; route: RouteSummary };

const modelPath = `/models/${String(useRoute().params.id)}`;

const { $dashboardApi } = useNuxtApp();
const { showToast } = useToast();
const { data: model, error: loadError, refresh } = useDashboardApi<ModelDetail>(modelPath);
useMissingResource(() => isNotFound(loadError.value), 'Model');
const { data: upstreamModels, status: upstreamModelsStatus } =
  useDashboardApi<UpstreamModel[]>('/upstream-models');
const { data: providers, status: providersStatus } = useDashboardApi<Provider[]>('/providers');
const { isBlocked } = useTermsRiskAllowed();
const blockedProviderIds = computed(
  () => new Set((providers.value ?? []).filter(isBlocked).map((provider) => provider.id)),
);

const isLoadingRouteOptions = computed(
  () =>
    (upstreamModelsStatus.value === 'pending' && !upstreamModels.value) ||
    (providersStatus.value === 'pending' && !providers.value),
);
const routes = computed(() => model.value?.routes ?? []);

useHead({ title: () => (model.value ? modelLabelOf(model.value).label : 'Model') });

const providerNameById = computed(
  () => new Map((providers.value ?? []).map((provider) => [provider.id, provider.name])),
);
const upstreamModelOptions = computed(() =>
  (upstreamModels.value ?? [])
    .filter((upstreamModel) => upstreamModel.kind === model.value?.kind)
    .map((upstreamModel) => ({
      label: `${providerNameById.value.get(upstreamModel.providerId) ?? '?'} · ${upstreamModelLabel(upstreamModel)}`,
      value: upstreamModel.id,
    })),
);

const dialog = ref<ModelDialog | null>(null);
const isDialogOpen = computed({
  get: () => dialog.value !== null,
  set: (isOpen) => {
    if (!isOpen) dialog.value = null;
  },
});
const isSaving = ref(false);
const dialogError = ref('');
const newName = ref('');
const newDisplayName = ref('');
const newGroupIds = ref<string[]>([]);
const newRouteUpstreamModelId = ref('');

function openDialog(next: ModelDialog): void {
  dialog.value = next;
  dialogError.value = '';
  if (next.kind === 'edit') {
    newName.value = model.value?.name ?? '';
    newDisplayName.value = model.value?.displayName ?? '';
    newGroupIds.value = (model.value?.groups ?? []).map((group) => group.id);
  }
  if (next.kind === 'add-route') {
    newRouteUpstreamModelId.value = upstreamModelOptions.value[0]?.value ?? '';
  }
}

async function saveFromDialog(
  write: () => Promise<unknown>,
  successMessage: string,
  failureMessage: string,
): Promise<boolean> {
  isSaving.value = true;
  dialogError.value = '';
  try {
    await write();
    showToast(successMessage);
    dialog.value = null;
    return true;
  } catch (error) {
    dialogError.value = apiErrorMessage(error, failureMessage);
    return false;
  } finally {
    isSaving.value = false;
  }
}

const publishedNames = computed(() => (model.value ? publishedModelNames(model.value) : []));
const hasNoGroup = computed(() => model.value?.groups.length === 0);

function editProblem(): string | null {
  const nameProblem = modelNameProblem(newName.value);
  if (nameProblem) return nameProblem;
  const displayProblem = displayNameProblem(newDisplayName.value);
  if (displayProblem) return displayProblem;
  return newGroupIds.value.length === 0 ? 'Pick at least one Group.' : null;
}

function isSameGroups(current: ModelDetail, groupIds: string[]): boolean {
  return (
    current.groups.length === groupIds.length &&
    current.groups.every((group) => groupIds.includes(group.id))
  );
}

function changedModelFields(current: ModelDetail): {
  name?: string;
  displayName?: string | null;
  groupIds?: string[];
} {
  const displayName = displayNameValue(newDisplayName.value);
  return {
    ...(newName.value === current.name ? {} : { name: newName.value }),
    ...(displayName === current.displayName ? {} : { displayName }),
    ...(isSameGroups(current, newGroupIds.value) ? {} : { groupIds: newGroupIds.value }),
  };
}

async function editModel(): Promise<void> {
  if (!model.value) return;
  const problem = editProblem();
  if (problem) {
    dialogError.value = problem;
    return;
  }
  const changes = changedModelFields(model.value);
  if (Object.keys(changes).length === 0) {
    dialog.value = null;
    return;
  }
  const isSaved = await saveFromDialog(
    () => $dashboardApi(modelPath, { method: 'PATCH', body: changes }),
    `Saved ${newName.value}`,
    "Couldn't save the Model.",
  );
  if (isSaved) await refresh();
}

async function deleteModel(): Promise<void> {
  const name = model.value?.name ?? 'the Model';
  const isDeleted = await saveFromDialog(
    () => $dashboardApi(modelPath, { method: 'DELETE' }),
    `Deleted ${name}`,
    "Couldn't delete the Model.",
  );
  if (isDeleted) await navigateTo('/models');
}

async function addRoute(): Promise<void> {
  const isAdded = await saveFromDialog(
    () =>
      $dashboardApi(`${modelPath}/routes`, {
        method: 'POST',
        body: { upstreamModelId: newRouteUpstreamModelId.value },
      }),
    'Added the Route',
    "Couldn't add the Route.",
  );
  if (isAdded) await refresh();
}

async function removeRoute(routeToRemove: RouteSummary): Promise<void> {
  const isRemoved = await saveFromDialog(
    () => $dashboardApi(`${modelPath}/routes/${routeToRemove.id}`, { method: 'DELETE' }),
    `Removed the Route to ${routeToRemove.upstreamModel.upstreamModelId}`,
    "Couldn't remove the Route.",
  );
  if (isRemoved) await refresh();
}

const isSavingPolicy = ref(false);
const policyError = ref('');

async function saveModelPolicy(parameterPolicy: ParameterPolicy): Promise<void> {
  isSavingPolicy.value = true;
  policyError.value = '';
  try {
    await $dashboardApi(modelPath, { method: 'PATCH', body: { parameterPolicy } });
    showToast('Saved the Parameter Policy');
    await refresh();
  } catch (error) {
    policyError.value = apiErrorMessage(error, "Couldn't save the Parameter Policy.");
  } finally {
    isSavingPolicy.value = false;
  }
}

async function saveRouteOverride(
  routeToChange: RouteSummary,
  override: ParameterPolicy | null,
): Promise<void> {
  const parameterPolicyOverride = override && !isEmptyPolicy(override) ? override : null;
  const target = routeToChange.upstreamModel.upstreamModelId;
  const isSaved = await saveFromDialog(
    () =>
      $dashboardApi(`${modelPath}/routes/${routeToChange.id}`, {
        method: 'PATCH',
        body: { parameterPolicyOverride },
      }),
    parameterPolicyOverride
      ? `Saved the override for ${target}`
      : `Removed the override for ${target}`,
    "Couldn't save the override.",
  );
  if (isSaved) await refresh();
}

const isSavingCacheBreakpoints = ref(false);

async function toggleCacheBreakpoints(): Promise<void> {
  if (!model.value) return;
  const hasAutomaticCacheBreakpoints = !model.value.hasAutomaticCacheBreakpoints;
  isSavingCacheBreakpoints.value = true;
  try {
    await $dashboardApi(modelPath, { method: 'PATCH', body: { hasAutomaticCacheBreakpoints } });
    showToast(`Turned automatic cache breakpoints ${hasAutomaticCacheBreakpoints ? 'on' : 'off'}`);
    await refresh();
  } catch (error) {
    showToast(apiErrorMessage(error, "Couldn't update the cache breakpoints."));
  } finally {
    isSavingCacheBreakpoints.value = false;
  }
}

async function toggleModel(): Promise<void> {
  if (!model.value) return;
  const { isEnabled, name } = model.value;
  try {
    await $dashboardApi(modelPath, { method: 'PATCH', body: { isEnabled: !isEnabled } });
    showToast(`${isEnabled ? 'Disabled' : 'Enabled'} ${name}`);
    await refresh();
  } catch (error) {
    showToast(apiErrorMessage(error, `Couldn't update ${name}.`));
  }
}

async function toggleRoute(routeToToggle: RouteSummary): Promise<void> {
  try {
    await $dashboardApi(`${modelPath}/routes/${routeToToggle.id}`, {
      method: 'PATCH',
      body: { isEnabled: !routeToToggle.isEnabled },
    });
    showToast(
      `${routeToToggle.isEnabled ? 'Disabled' : 'Enabled'} the Route to ${routeToToggle.upstreamModel.upstreamModelId}`,
    );
    await refresh();
  } catch (error) {
    showToast(apiErrorMessage(error, "Couldn't update the Route."));
  }
}

async function moveRoute(index: number, offset: -1 | 1): Promise<void> {
  const routeIds = (model.value?.routes ?? []).map((routeInOrder) => routeInOrder.id);
  const neighbourIndex = index + offset;
  const movedId = routeIds[index];
  const neighbourId = routeIds[neighbourIndex];
  if (movedId === undefined || neighbourId === undefined) return;
  routeIds[index] = neighbourId;
  routeIds[neighbourIndex] = movedId;
  try {
    await $dashboardApi(`${modelPath}/route-order`, { method: 'PUT', body: { routeIds } });
    await refresh();
  } catch (error) {
    showToast(apiErrorMessage(error, "Couldn't save the new Route order."));
  }
}
</script>

<template>
  <div class="page-view">
    <EmptyState v-if="loadError" class="panel" :icon="CloudOff" tone="error">
      <strong>Couldn't load this Model.</strong
      ><span>Check that the backend is running, then reload the page.</span>
    </EmptyState>

    <template v-else-if="!model">
      <section class="page-heading" aria-busy="true">
        <div>
          <h1>Model</h1>
          <p class="page-heading__sub">
            Clients send "&lt;group slug&gt;/&lt;name&gt;" as the model. The gateway tries its
            enabled Routes from the top.
          </p>
        </div>
        <div class="page-heading__controls">
          <button class="button" type="button" disabled><Pencil :size="14" /> Edit</button>
          <button class="button" type="button" disabled><Trash2 :size="14" /> Delete</button>
        </div>
      </section>
      <section class="panel loading-panel" aria-busy="true">
        <AppSpinner />
      </section>
    </template>

    <template v-else>
      <PageHeading
        :title="modelLabelOf(model).label"
        description='Clients send "<group slug>/<name>" as the model. The gateway tries its enabled Routes from the top.'
      >
        <template v-if="model.displayName" #title-note>
          <code class="page-heading__note">{{ model.name }}</code>
        </template>
        <span
          class="status-badge"
          :title="`Routes go only to ${MODEL_KIND_LABELS[model.kind]} Upstream Models`"
          >{{ MODEL_KIND_LABELS[model.kind] }}</span
        >
        <span
          class="status-badge"
          :class="model.isEnabled ? 'status-badge--good' : 'status-badge--warn'"
          >{{ model.isEnabled ? 'Enabled' : 'Disabled' }}</span
        >
        <button class="button" type="button" @click="openDialog({ kind: 'edit' })">
          <Pencil :size="14" /> Edit
        </button>
        <button class="button" type="button" @click="toggleModel">
          <Power :size="14" /> {{ model.isEnabled ? 'Disable' : 'Enable' }}
        </button>
        <button class="button" type="button" @click="openDialog({ kind: 'delete' })">
          <Trash2 :size="14" /> Delete
        </button>
      </PageHeading>

      <section class="panel">
        <div class="panel-heading">
          <div>
            <h2>Published as</h2>
            <p v-if="hasNoGroup">
              This Model is in no Group, so clients send its bare name. Edit it to pick a Group.
            </p>
            <p v-else>The model names clients send, one for each Group.</p>
          </div>
        </div>
        <ul class="published-names">
          <li v-for="publishedName in publishedNames" :key="publishedName">
            <code>{{ publishedName }}</code>
            <CopyIconButton :text="publishedName" label="model name" />
          </li>
          <li v-if="hasNoGroup">
            <span class="status-badge status-badge--warn status-badge--small">No group</span>
          </li>
        </ul>
      </section>

      <section class="panel table-panel">
        <div class="panel-heading">
          <div>
            <h2>Routes</h2>
            <p>Tried in this order. A failed Route falls back to the next one.</p>
          </div>
          <div class="panel-heading__tools">
            <button
              class="button button--primary"
              type="button"
              :disabled="isLoadingRouteOptions || upstreamModelOptions.length === 0"
              @click="openDialog({ kind: 'add-route' })"
            >
              <Plus :size="14" /> Add Route
            </button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Provider</th>
                <th>Upstream Model</th>
                <th>Capabilities</th>
                <th>Provider Accounts</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="(modelRoute, index) in routes" :key="modelRoute.id">
                <td class="tabular">{{ index + 1 }}</td>
                <td>
                  {{ modelRoute.provider.name }}
                  <span v-if="!modelRoute.provider.isEnabled" class="cell-note"
                    >Provider disabled</span
                  >
                  <span
                    v-if="blockedProviderIds.has(modelRoute.provider.id)"
                    class="cell-note"
                    :title="TERMS_RISK_BLOCKED_HINT"
                    >Blocked: terms risk</span
                  >
                </td>
                <td>
                  <strong>{{ modelRoute.upstreamModel.upstreamModelId }}</strong>
                  <span v-if="!modelRoute.upstreamModel.isEnabled" class="cell-note"
                    >Upstream Model disabled</span
                  >
                  <span v-if="modelRoute.parameterPolicyOverride" class="cell-note"
                    >Overrides the Parameter Policy</span
                  >
                </td>
                <td>{{ modelRoute.upstreamModel.capabilities.join(', ') || '—' }}</td>
                <td class="tabular">
                  <span
                    v-if="modelRoute.enabledProviderAccountCount === 0"
                    class="status-badge status-badge--warn"
                    :title="`${modelRoute.provider.name} has no enabled Provider Account, so this Route can't serve requests.`"
                    >None enabled</span
                  >
                  <template v-else>{{ modelRoute.enabledProviderAccountCount }} enabled</template>
                </td>
                <td>
                  <span
                    class="status-badge"
                    :class="modelRoute.isEnabled ? 'status-badge--good' : 'status-badge--warn'"
                    >{{ modelRoute.isEnabled ? 'Enabled' : 'Disabled' }}</span
                  >
                </td>
                <td>
                  <div class="row-actions">
                    <button
                      class="row-action"
                      :disabled="index === 0"
                      aria-label="Move up"
                      @click="moveRoute(index, -1)"
                    >
                      <ArrowUp :size="14" />
                    </button>
                    <button
                      class="row-action"
                      :disabled="index === routes.length - 1"
                      aria-label="Move down"
                      @click="moveRoute(index, 1)"
                    >
                      <ArrowDown :size="14" />
                    </button>
                    <button
                      class="row-action"
                      @click="openDialog({ kind: 'route-policy', route: modelRoute })"
                    >
                      <SlidersHorizontal :size="14" /> Policy
                    </button>
                    <button class="row-action" @click="toggleRoute(modelRoute)">
                      <Power :size="14" /> {{ modelRoute.isEnabled ? 'Disable' : 'Enable' }}
                    </button>
                    <button
                      class="row-action"
                      @click="openDialog({ kind: 'remove-route', route: modelRoute })"
                    >
                      <Trash2 :size="14" /> Remove
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <EmptyState v-if="routes.length === 0" :icon="Route">
            <strong>No Routes yet.</strong
            ><span v-if="isLoadingRouteOptions || upstreamModelOptions.length > 0"
              >Requests for {{ model.name }} fail until you add one.</span
            ><span v-else
              >Add a {{ MODEL_KIND_LABELS[model.kind] }} Upstream Model first, on the
              <NuxtLink to="/upstream-models">Upstream Models</NuxtLink> page.</span
            >
          </EmptyState>
        </div>
      </section>

      <section class="panel">
        <div class="panel-heading">
          <div>
            <h2>Parameter Policy</h2>
            <p>
              Defaults fill what the client leaves out, forced values replace the client's, and caps
              clamp what is left. A Route's override wins for the parameters it sets.
            </p>
          </div>
        </div>
        <div class="panel-body">
          <ParameterPolicyEditor
            :policy="model.parameterPolicy"
            :is-saving="isSavingPolicy"
            :error="policyError"
            submit-label="Save policy"
            @save="saveModelPolicy"
          />
        </div>
      </section>

      <section class="panel">
        <div class="panel-heading">
          <div>
            <h2>Prompt caching</h2>
            <p>
              On Routes to anthropic-messages Providers, the gateway marks the end of the tools, the
              end of the system prompt and the latest turn for caching, unless the client marked the
              request itself.
            </p>
          </div>
        </div>
        <div class="panel-body">
          <label class="check-field"
            ><input
              type="checkbox"
              :checked="model.hasAutomaticCacheBreakpoints"
              :disabled="isSavingCacheBreakpoints"
              @change="toggleCacheBreakpoints"
            />
            Automatic cache breakpoints</label
          >
        </div>
      </section>
    </template>

    <AppDialog
      v-if="dialog?.kind === 'edit'"
      hide-description
      v-model:open="isDialogOpen"
      title="Edit Model"
      description="Clients that still send an old name, or a Group it left, get an unknown-model error."
    >
      <form class="form" @submit.prevent="editModel">
        <label class="field"
          ><span class="field__label">Name</span
          ><input v-model="newName" class="text-input" autocomplete="off" required
        /></label>
        <p v-if="modelNameProblem(newName)" class="form__error" role="alert">
          {{ modelNameProblem(newName) }}
        </p>
        <label class="field"
          ><span class="field__label">Display name (optional)</span
          ><input
            v-model="newDisplayName"
            class="text-input"
            autocomplete="off"
            placeholder="e.g. DeepSeek V4.1 Flash"
        /></label>
        <p v-if="displayNameProblem(newDisplayName)" class="form__error" role="alert">
          {{ displayNameProblem(newDisplayName) }}
        </p>
        <ModelGroupPicker v-model="newGroupIds" />
        <p v-if="hasNoGroup" class="form__warning" role="note">
          Pick at least one Group to save. Clients then send "&lt;group slug&gt;/{{ model?.name }}"
          instead of the bare name.
        </p>
        <p v-if="dialogError" class="form__error" role="alert">{{ dialogError }}</p>
        <div class="dialog__actions">
          <button class="button" type="button" @click="dialog = null">Cancel</button>
          <button class="button button--primary" type="submit" :disabled="isSaving">Save</button>
        </div>
      </form>
    </AppDialog>

    <AppDialog
      v-if="dialog?.kind === 'add-route'"
      hide-description
      v-model:open="isDialogOpen"
      title="Add Route"
      description="The new Route goes last. Move it up to try it sooner."
    >
      <form class="form" @submit.prevent="addRoute">
        <div class="field">
          <span class="field__label">Upstream Model</span>
          <AppSelect
            v-model="newRouteUpstreamModelId"
            :options="upstreamModelOptions"
            label="Upstream Model"
          />
        </div>
        <p v-if="dialogError" class="form__error" role="alert">{{ dialogError }}</p>
        <div class="dialog__actions">
          <button class="button" type="button" @click="dialog = null">Cancel</button>
          <button class="button button--primary" type="submit" :disabled="isSaving">
            Add Route
          </button>
        </div>
      </form>
    </AppDialog>

    <AppDialog
      v-if="dialog?.kind === 'remove-route'"
      v-model:open="isDialogOpen"
      title="Remove Route"
      :description="`${model?.name} stops sending requests to ${dialog.route.provider.name} · ${dialog.route.upstreamModel.upstreamModelId}.`"
    >
      <p v-if="dialogError" class="form__error" role="alert">{{ dialogError }}</p>
      <div class="dialog__actions">
        <button class="button" type="button" @click="dialog = null">Cancel</button>
        <button
          class="button button--danger"
          type="button"
          :disabled="isSaving"
          @click="removeRoute(dialog.route)"
        >
          Remove Route
        </button>
      </div>
    </AppDialog>

    <AppDialog
      v-if="dialog?.kind === 'route-policy'"
      v-model:open="isDialogOpen"
      wide
      title="Route override"
      :description="`For requests sent to ${dialog.route.provider.name} · ${dialog.route.upstreamModel.upstreamModelId}, each parameter set here takes all its rules from this override instead of the Model's policy. A system prompt here replaces the Model's.`"
    >
      <ParameterPolicyEditor
        :policy="dialog.route.parameterPolicyOverride"
        :is-saving="isSaving"
        :error="dialogError"
        submit-label="Save override"
        @save="saveRouteOverride(dialog.route, $event)"
      >
        <template #actions>
          <button class="button" type="button" @click="dialog = null">Cancel</button>
          <button
            v-if="dialog.route.parameterPolicyOverride"
            class="button button--danger"
            type="button"
            :disabled="isSaving"
            @click="saveRouteOverride(dialog.route, null)"
          >
            Remove override
          </button>
        </template>
      </ParameterPolicyEditor>
    </AppDialog>

    <AppDialog
      v-if="dialog?.kind === 'delete'"
      v-model:open="isDialogOpen"
      title="Delete Model"
      :description="`${model?.name} and its Routes are deleted, and clients sending it get an unknown-model error. This can't be undone.`"
    >
      <p v-if="dialogError" class="form__error" role="alert">{{ dialogError }}</p>
      <div class="dialog__actions">
        <button class="button" type="button" @click="dialog = null">Cancel</button>
        <button
          class="button button--danger"
          type="button"
          :disabled="isSaving"
          @click="deleteModel"
        >
          Delete Model
        </button>
      </div>
    </AppDialog>
  </div>
</template>
