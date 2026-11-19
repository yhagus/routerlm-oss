import { computed, type InjectionKey, inject, provide, ref, watch } from "vue";
import type { ModelDetail, ModelSummary } from "~/lib/routing";
import {
  MODEL_KIND_LABELS,
  type ModelKind,
  type Provider,
  type ProviderAccount,
  type UpstreamModel,
  upstreamModelLabel,
} from "~/lib/upstream";

/** A Model (routed, under its policy) or one Upstream Model, sent directly. */
export type PlaygroundSource = "model" | "upstream";

export type PlaygroundTarget = ReturnType<typeof createPlaygroundTarget>;

const TARGET_KEY: InjectionKey<PlaygroundTarget> = Symbol("playground-target");

/**
 * What one Playground tab sends to: a Model or an Upstream Model of `kind`.
 * Provided to the tab's picker and preview, which read it with
 * `useInjectedPlaygroundTarget`.
 */
export function usePlaygroundTarget(kind: ModelKind): PlaygroundTarget {
  const target = createPlaygroundTarget(kind);
  provide(TARGET_KEY, target);
  return target;
}

export function useInjectedPlaygroundTarget(): PlaygroundTarget {
  const target = inject(TARGET_KEY);
  if (!target) throw new Error("No Playground target: call usePlaygroundTarget in a parent");
  return target;
}

/** Keeps `selected` on one of `options`, falling back to the first when it drops out. */
function keepSelectionIn(selected: { value: string }, options: () => { value: string }[]): void {
  watch(
    options,
    (current) => {
      if (!current.some((option) => option.value === selected.value)) {
        selected.value = current[0]?.value ?? "";
      }
    },
    { immediate: true },
  );
}

function createPlaygroundTarget(kind: ModelKind) {
  const { $dashboardApi } = useNuxtApp();
  const kindLabel = MODEL_KIND_LABELS[kind].toLowerCase();
  const source = ref<PlaygroundSource>("model");

  // Models

  const {
    data: models,
    error: modelsError,
    status: modelsStatus,
  } = useDashboardApi<ModelSummary[]>("/models");
  const isLoadingModels = computed(() => modelsStatus.value === "pending" && !models.value);
  const enabledModels = computed(() =>
    (models.value ?? []).filter((model) => model.isEnabled && model.kind === kind),
  );
  const modelOptions = computed(() =>
    enabledModels.value.map((model) => ({ value: model.name, label: model.name })),
  );
  const modelName = ref("");
  keepSelectionIn(modelName, () => modelOptions.value);

  // Upstream Models

  const {
    data: providers,
    error: providersError,
    status: providersStatus,
  } = useDashboardApi<Provider[]>("/providers");
  const { isBlocked } = useTermsRiskAllowed();
  /** A Route summary doesn't carry Terms Risk, so it is looked up from the Provider list. */
  const blockedProviderIds = computed(
    () => new Set((providers.value ?? []).filter(isBlocked).map((provider) => provider.id)),
  );
  const {
    data: upstreamModels,
    error: upstreamModelsError,
    status: upstreamModelsStatus,
  } = useDashboardApi<UpstreamModel[]>("/upstream-models");
  const { data: providerAccounts } = useDashboardApi<ProviderAccount[]>("/provider-accounts");
  const isLoadingUpstream = computed(
    () =>
      (providersStatus.value === "pending" && !providers.value) ||
      (upstreamModelsStatus.value === "pending" && !upstreamModels.value),
  );
  const upstreamError = computed(() => providersError.value ?? upstreamModelsError.value);

  /** Every Upstream Model of this Kind, enabled or not, such as for a Route's limits. */
  const upstreamModelsOfKind = computed(() =>
    (upstreamModels.value ?? []).filter((upstreamModel) => upstreamModel.kind === kind),
  );
  /** Enabled Upstream Models of usable Providers: the ones a direct test can reach. */
  const testableUpstreamModels = computed(() => {
    const enabledProviderIds = new Set(
      (providers.value ?? [])
        .filter((provider) => provider.isEnabled && !isBlocked(provider))
        .map((provider) => provider.id),
    );
    return upstreamModelsOfKind.value.filter(
      (upstreamModel) =>
        upstreamModel.isEnabled && enabledProviderIds.has(upstreamModel.providerId),
    );
  });
  const providerOptions = computed(() => {
    const withModels = new Set(testableUpstreamModels.value.map((model) => model.providerId));
    return (providers.value ?? [])
      .filter((provider) => withModels.has(provider.id))
      .map((provider) => ({ value: provider.id, label: provider.name }));
  });
  const providerId = ref("");
  keepSelectionIn(providerId, () => providerOptions.value);
  const upstreamModelOptions = computed(() =>
    testableUpstreamModels.value
      .filter((upstreamModel) => upstreamModel.providerId === providerId.value)
      .map((upstreamModel) => ({
        value: upstreamModel.id,
        label: upstreamModelLabel(upstreamModel),
      })),
  );
  const upstreamModelRowId = ref("");
  keepSelectionIn(upstreamModelRowId, () => upstreamModelOptions.value);

  const providerNamesBySlug = computed(
    () => new Map((providers.value ?? []).map((provider) => [provider.slug, provider.name])),
  );
  const providerLogosBySlug = computed(
    () => new Map((providers.value ?? []).map((provider) => [provider.slug, provider.logo])),
  );
  const selectedProvider = computed(
    () => (providers.value ?? []).find((provider) => provider.id === providerId.value) ?? null,
  );
  const selectedUpstreamModel = computed(
    () =>
      testableUpstreamModels.value.find((model) => model.id === upstreamModelRowId.value) ?? null,
  );
  /** The selected Provider's accounts, in the order the gateway tries them. */
  const selectedProviderAccounts = computed(() =>
    (providerAccounts.value ?? [])
      .filter((account) => account.providerId === providerId.value)
      .toSorted((first, second) => first.priority - second.priority),
  );

  // The selected Model's Routes and Parameter Policy, for the preview before a send.

  const modelDetail = ref<ModelDetail | null>(null);
  const modelDetailState = ref<"idle" | "loading" | "failed">("idle");
  const selectedModelId = computed(
    () => enabledModels.value.find((model) => model.name === modelName.value)?.id ?? "",
  );
  watch(
    selectedModelId,
    async (id) => {
      modelDetail.value = null;
      if (id === "") {
        modelDetailState.value = "idle";
        return;
      }
      modelDetailState.value = "loading";
      try {
        const detail = await $dashboardApi<ModelDetail>(`/models/${id}`);
        // A slow answer for a Model the user has since switched away from is dropped.
        if (selectedModelId.value !== id) return;
        modelDetail.value = detail;
        modelDetailState.value = "idle";
      } catch {
        if (selectedModelId.value === id) modelDetailState.value = "failed";
      }
    },
    { immediate: true },
  );

  const canTry = computed(() =>
    source.value === "model"
      ? !modelsError.value && modelOptions.value.length > 0
      : !upstreamError.value && upstreamModelOptions.value.length > 0,
  );
  const isLoadingSource = computed(() =>
    source.value === "model" ? isLoadingModels.value : isLoadingUpstream.value,
  );

  /** What the request's `model` names, or what is missing to send one. */
  function requestModel(): { model: string } | { problem: string } {
    if (source.value === "model") {
      return modelName.value === "" ? { problem: "Pick a Model." } : { model: modelName.value };
    }
    const upstreamModel = selectedUpstreamModel.value;
    return upstreamModel
      ? { model: upstreamModel.upstreamModelId }
      : { problem: "Pick an Upstream Model." };
  }

  /** The Playground path for a client endpoint, such as `images/generations`, under this source. */
  function requestPath(endpoint: string): string {
    const upstreamModel = selectedUpstreamModel.value;
    return source.value === "upstream" && upstreamModel
      ? `/playground/upstream-models/${upstreamModel.id}/${endpoint}`
      : `/playground/${endpoint}`;
  }

  return {
    kind,
    kindLabel,
    source,
    modelName,
    modelOptions,
    modelsError,
    isLoadingModels,
    providerId,
    providerOptions,
    upstreamModelRowId,
    upstreamModelOptions,
    upstreamModelsOfKind,
    upstreamError,
    isLoadingUpstream,
    blockedProviderIds,
    providerNamesBySlug,
    providerLogosBySlug,
    selectedProvider,
    selectedUpstreamModel,
    selectedProviderAccounts,
    modelDetail,
    modelDetailState,
    canTry,
    isLoadingSource,
    requestModel,
    requestPath,
  };
}
