<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import { Copy } from "lucide-vue-next";
import { api } from "@/lib/api";
import { number } from "@/lib/format";
import Card from "@/components/ui/card.vue";
import Button from "@/components/ui/button.vue";
import Input from "@/components/ui/input.vue";
import Toggle from "@/components/ui/toggle.vue";
import Modal from "@/components/ui/modal.vue";
import ConfirmModal from "@/components/ui/ConfirmModal.vue";
import Select from "@/components/ui/select.vue";
import Label from "@/components/ui/label.vue";
import ApiKeysList from "@/components/endpoint/ApiKeysList.vue";
import { useNotificationStore } from "@/stores/notifications";
import type { ApiKey, ApiKeyPagination, Combo } from "@/types/api";

type LimitEdit = {
  id: string;
  name: string | null;
  limitMode: string;
  limitValue: string;
  maxConcurrency: string;
  requestsPerMinute: string;
  requestsPerSecond: string;
  usageRequests: number;
  usageTokens: number;
};
type ComboEdit = ApiKey & {
  comboAccessMode: "blacklist" | "whitelist";
  comboAccessList: string[];
};
type ModelEdit = ApiKey & {
  modelAccessMode: "blacklist" | "whitelist";
  modelAccessList: string[];
};
type PinsEdit = {
  id: string;
  name: string | null;
  pins: Record<string, Record<string, string[]>>;
};
type ConfirmState = {
  title: string;
  message: string;
  onConfirm: () => Promise<void> | void;
};

const queryClient = useQueryClient();
const notices = useNotificationStore();
const router = useRouter();
const settings = useQuery({
  queryKey: ["settings"],
  queryFn: api.settings.get,
});
const combos = useQuery({ queryKey: ["combos"], queryFn: api.combos.list });
const keyConfig = useQuery({
  queryKey: ["api-key-config"],
  queryFn: api.keys.config,
});
const tunnels = useQuery({
  queryKey: ["tunnel", "status"],
  queryFn: api.host.tunnels.status,
});

const endpoint = ref("");
const requireApiKey = ref(false);
const apiKeyPrefix = ref("sk-");
const isRemoteHost = ref(false);

const keys = ref<ApiKey[]>([]);
const keysLoading = ref(true);
const keysPage = ref(1);
const keysPageSize = ref(10);
const keysSearchInput = ref("");
const keysSearch = ref("");
const keysVisibilityTab = ref<"private" | "public" | "event">("private");
const keysPagination = reactive<ApiKeyPagination>({
  page: 1,
  pageSize: 10,
  totalItems: 0,
  totalPages: 1,
});
let searchTimer: ReturnType<typeof setTimeout> | undefined;

const showAddModal = ref(false);
const newKeyName = ref("");
const newKeyPrefix = ref("");
const newKeyCustomValue = ref("");
const newKeyError = ref("");
const newKeyVisibility = ref<"private" | "public" | "event">("private");
const newKeyIsDefault = ref(false);
const newKeyLimitMode = ref("none");
const newKeyLimitValue = ref("");
const newKeyMaxConcurrency = ref("");
const newKeyRequestsPerMinute = ref("");
const newKeyRequestsPerSecond = ref("");
const createdKey = ref<string | null>(null);
const editingLimit = ref<LimitEdit | null>(null);
const editingComboAccess = ref<ComboEdit | null>(null);
const editingModelAccess = ref<ModelEdit | null>(null);
const editingConnectionPins = ref<PinsEdit | null>(null);
const pinConnections = ref<
  Record<string, Array<{ id: string; label: string }>>
>({});
const confirmState = ref<ConfirmState | null>(null);
const confirmLoading = ref(false);

const tunnelBusy = ref("");

const modelCandidates = computed(() =>
  Array.from(
    new Set(
      (combos.data.value || []).flatMap((combo: Combo) => {
        if (Array.isArray(combo.models))
          return combo.models.filter(
            (model): model is string =>
              typeof model === "string" && Boolean(model.trim()),
          );
        return [];
      }),
    ),
  ).sort(),
);
const activeCombos = computed(() => combos.data.value || []);
const activeComboNames = computed(
  () => new Set(activeCombos.value.map((combo) => combo.name)),
);
const removedComboNames = computed(() =>
  Array.from(
    new Set(
      (editingComboAccess.value?.comboAccessList || []).filter(
        (name) => !activeComboNames.value.has(name),
      ),
    ),
  ),
);
const modelAccessText = computed({
  get: () => editingModelAccess.value?.modelAccessList.join("\n") || "",
  set: (value: string) => {
    if (editingModelAccess.value)
      editingModelAccess.value.modelAccessList = value.split(/[\n,]/);
  },
});
const tunnelData = computed(
  () => tunnels.data.value?.tunnel as Record<string, unknown> | undefined,
);
const tailscaleData = computed(
  () => tunnels.data.value?.tailscale as Record<string, unknown> | undefined,
);

onMounted(() => {
  endpoint.value = `${window.location.origin}/v1`;
  isRemoteHost.value = !["localhost", "127.0.0.1", "::1"].includes(
    window.location.hostname,
  );
  void fetchKeys();
});

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer);
});

watch(
  () => settings.data.value?.requireApiKey,
  (value) => {
    requireApiKey.value = value === true;
  },
  { immediate: true },
);
watch(
  () => keyConfig.data.value?.prefix,
  (value) => {
    if (typeof value === "string") {
      apiKeyPrefix.value = value;
    }
  },
  { immediate: true },
);
// A tab switch shows a different dataset, so drop the old rows right away.
// The list then renders its skeleton instead of the previous tab's keys.
watch(keysVisibilityTab, () => {
  keys.value = [];
});
watch([keysPage, keysPageSize, keysSearch, keysVisibilityTab], () => {
  void fetchKeys();
});
watch(keysSearchInput, (value) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (keysSearch.value !== value) {
      keysSearch.value = value;
      keysPage.value = 1;
    }
  }, 300);
});

// Only the newest request may update state. Rapid tab or page changes
// otherwise let a slow, older response overwrite the current view.
let keysRequestId = 0;

async function fetchKeys() {
  const requestId = ++keysRequestId;
  keysLoading.value = true;
  try {
    const result = await api.keys.listPage({
      page: keysPage.value,
      pageSize: keysPageSize.value,
      search: keysSearch.value.trim() || undefined,
      visibility: keysVisibilityTab.value,
    });
    if (requestId !== keysRequestId) return;
    keys.value = result.keys;
    Object.assign(keysPagination, result.pagination);
    if (result.pagination.page !== keysPage.value)
      keysPage.value = result.pagination.page;
  } catch (error) {
    if (requestId !== keysRequestId) return;
    notices.push(
      "error",
      error instanceof Error ? error.message : "Failed to fetch API keys.",
    );
  } finally {
    if (requestId === keysRequestId) keysLoading.value = false;
  }
}

async function copy(value: string, message = "Copied to clipboard.") {
  try {
    await navigator.clipboard.writeText(value);
    notices.push("success", message);
  } catch {
    notices.push("error", "Could not copy to clipboard.");
  }
}

async function copyKey(key: ApiKey) {
  try {
    const value = key.key || (await api.keys.reveal(key.id)).key;
    if (value) await copy(value, "API key copied.");
  } catch (error) {
    notices.push(
      "error",
      error instanceof Error ? error.message : "Could not copy API key.",
    );
  }
}

async function openUsageStats(key: ApiKey) {
  try {
    const value = key.key || (await api.keys.reveal(key.id)).key;
    if (!value) throw new Error("Could not read the API key secret.");
    const link = document.createElement("a");
    link.href = `/?apikey=${encodeURIComponent(value.trim())}`;
    link.target = "_blank";
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
  } catch (error) {
    notices.push(
      "error",
      error instanceof Error ? error.message : "Could not open usage stats.",
    );
  }
}

const showTrackerModal = ref(false);
const trackerKey = ref<ApiKey | null>(null);
const trackerProvider = ref("");
const trackerLabel = ref("");
const trackerSaving = ref(false);

const trackerProviderOptions = [
  { value: "codebuddy-intl-cli", label: "CodeBuddy CLI" },
];

async function openTracker(key: ApiKey) {
  trackerKey.value = key;
  trackerProvider.value = "";
  trackerLabel.value = "";
  showTrackerModal.value = true;
  const existing = key.features?.quotaTracker as
    { provider?: string; label?: string; enabled?: boolean } | undefined;
  if (existing?.provider) {
    trackerProvider.value = existing.provider;
    trackerLabel.value = existing.label || "";
  }
}

async function saveTracker() {
  if (!trackerKey.value || !trackerProvider.value) return;
  trackerSaving.value = true;
  try {
    const features = { ...trackerKey.value.features };
    features.quotaTracker = {
      enabled: true,
      provider: trackerProvider.value,
      label:
        trackerLabel.value.trim() ||
        trackerProviderOptions.find((o) => o.value === trackerProvider.value)
          ?.label ||
        "CodeBuddy",
    };
    await api.keys.update(trackerKey.value.id, { features });
    await queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    notices.push("success", "Tracker saved.");
    showTrackerModal.value = false;
    trackerKey.value = null;
  } catch (error) {
    notices.push(
      "error",
      error instanceof Error ? error.message : "Could not save tracker.",
    );
  } finally {
    trackerSaving.value = false;
  }
}

async function removeTracker() {
  if (!trackerKey.value) return;
  trackerSaving.value = true;
  try {
    const features = { ...trackerKey.value.features };
    delete features.quotaTracker;
    await api.keys.update(trackerKey.value.id, { features });
    await queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    notices.push("success", "Tracker removed.");
    showTrackerModal.value = false;
    trackerKey.value = null;
  } catch (error) {
    notices.push(
      "error",
      error instanceof Error ? error.message : "Could not remove tracker.",
    );
  } finally {
    trackerSaving.value = false;
  }
}

const saveSecurity = useMutation({
  mutationFn: (value: boolean) => api.settings.update({ requireApiKey: value }),
  onSuccess: (_, value) => {
    requireApiKey.value = value;
    void queryClient.invalidateQueries({ queryKey: ["settings"] });
  },
  onError: (error) => notices.push("error", error.message),
});

async function handleRequireApiKey(value: boolean) {
  saveSecurity.mutate(value);
}

function resetCreate() {
  showAddModal.value = false;
  newKeyName.value = "";
  newKeyPrefix.value = "";
  newKeyCustomValue.value = "";
  newKeyError.value = "";
  newKeyVisibility.value = "private";
  newKeyIsDefault.value = false;
  newKeyLimitMode.value = "none";
  newKeyLimitValue.value = "";
  newKeyMaxConcurrency.value = "";
  newKeyRequestsPerMinute.value = "";
  newKeyRequestsPerSecond.value = "";
}

async function handleCreateKey() {
  if (!newKeyName.value.trim()) return;
  newKeyError.value = "";
  const visibility = newKeyVisibility.value;
  try {
    const result = await api.keys.create({
      name: newKeyName.value.trim(),
      prefix: newKeyPrefix.value.trim(),
      customKey: newKeyCustomValue.value.trim(),
      visibility,
      isDefault: visibility === "public" && newKeyIsDefault.value,
      limitMode: newKeyLimitMode.value,
      limitValue:
        newKeyLimitMode.value === "none"
          ? null
          : Number(newKeyLimitValue.value),
      maxConcurrency: optionalInt(newKeyMaxConcurrency.value),
      features: {
        requestsPerMinute: optionalInt(newKeyRequestsPerMinute.value),
        requestsPerSecond: optionalInt(newKeyRequestsPerSecond.value),
      },
    });
    resetCreate();
    // Event keys have no secret; their detail page holds the public link.
    if (visibility === "event") {
      await router.push({ name: "event-key-detail", params: { id: result.id } });
      return;
    }
    createdKey.value = result.key;
    keysSearchInput.value = "";
    keysSearch.value = "";
    keysVisibilityTab.value = visibility;
    keysPage.value = 1;
    await fetchKeys();
  } catch (error) {
    newKeyError.value =
      error instanceof Error ? error.message : "Failed to create API key";
  }
}

function selectNewKeyLimit(mode: string) {
  newKeyLimitMode.value = mode;
  if (mode === "none") newKeyLimitValue.value = "";
}

function optionalInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

async function updateKey(id: string, patch: Record<string, unknown>) {
  try {
    const result = await api.keys.update(id, patch);
    keys.value = keys.value.map((key) =>
      key.id === id ? { ...key, ...result } : key,
    );
    return result;
  } catch (error) {
    notices.push(
      "error",
      error instanceof Error ? error.message : "Failed to update API key.",
    );
    return null;
  }
}

async function handleToggleKey(key: ApiKey, value: boolean) {
  await updateKey(key.id, { isActive: value });
}

function confirmPause(key: ApiKey, value: boolean) {
  confirmState.value = {
    title: "Pause API Key",
    message: `Pause API key "${key.name}"?\n\nThis key will stop working immediately but can be resumed later.`,
    onConfirm: async () => {
      await updateKey(key.id, { isActive: value });
    },
  };
}

function confirmDelete(key: ApiKey) {
  confirmState.value = {
    title: "Delete API Key",
    message:
      key.visibility === "event"
        ? `Delete event "${key.name}"?\n\nAll participant keys of this event are deleted too.`
        : "Delete this API key?",
    onConfirm: async () => {
      const deleted = await api.keys.remove(key.id);
      if (deleted) {
        const nextTotal = Math.max(0, keysPagination.totalItems - 1);
        const maxPage = Math.max(1, Math.ceil(nextTotal / keysPageSize.value));
        keysPage.value = Math.min(keysPage.value, maxPage);
        await fetchKeys();
      }
    },
  };
}

async function confirmAction() {
  if (!confirmState.value) return;
  confirmLoading.value = true;
  try {
    await confirmState.value.onConfirm();
    confirmState.value = null;
  } catch (error) {
    notices.push(
      "error",
      error instanceof Error ? error.message : "Action failed.",
    );
  } finally {
    confirmLoading.value = false;
  }
}

async function handleSetDefault(key: ApiKey) {
  const result = await updateKey(key.id, { isDefault: true });
  if (result)
    keys.value = keys.value.map((item) => ({
      ...item,
      isDefault: item.id === key.id && item.visibility === "public",
    }));
}

function openLimit(key: ApiKey) {
  const features = key.features as Record<string, unknown> | undefined;
  editingLimit.value = {
    id: key.id,
    name: key.name,
    limitMode:
      key.limitMode && key.limitMode !== "none" ? key.limitMode : "none",
    limitValue: key.limitValue == null ? "" : String(key.limitValue),
    maxConcurrency:
      key.maxConcurrency == null ? "" : String(key.maxConcurrency),
    requestsPerMinute:
      features?.requestsPerMinute == null
        ? ""
        : String(features.requestsPerMinute),
    requestsPerSecond:
      features?.requestsPerSecond == null
        ? ""
        : String(features.requestsPerSecond),
    usageRequests: key.usageRequests || 0,
    usageTokens: key.usageTokens || 0,
  };
}

function selectEditLimit(mode: string) {
  if (!editingLimit.value) return;
  editingLimit.value.limitMode = mode;
  if (mode === "none") editingLimit.value.limitValue = "";
}

async function saveLimit() {
  if (!editingLimit.value) return;
  const edit = editingLimit.value;
  const mode =
    edit.limitMode === "requests" || edit.limitMode === "tokens"
      ? edit.limitMode
      : "none";
  const result = await updateKey(edit.id, {
    limitMode: mode,
    limitValue: mode === "none" ? null : Number(edit.limitValue),
    maxConcurrency: optionalInt(edit.maxConcurrency),
    features: {
      requestsPerMinute: optionalInt(edit.requestsPerMinute),
      requestsPerSecond: optionalInt(edit.requestsPerSecond),
    },
  });
  if (result) editingLimit.value = null;
}

function openComboAccess(key: ApiKey) {
  editingComboAccess.value = {
    ...key,
    comboAccessMode:
      key.comboAccessMode === "whitelist" ? "whitelist" : "blacklist",
    comboAccessList: Array.isArray(key.comboAccessList)
      ? [...key.comboAccessList]
      : [],
  };
}

function toggleComboAccessItem(name: string) {
  if (!editingComboAccess.value) return;
  const list = new Set(editingComboAccess.value.comboAccessList || []);
  if (list.has(name)) list.delete(name);
  else list.add(name);
  editingComboAccess.value.comboAccessList = Array.from(list);
}

function removeComboAccessItem(name: string) {
  if (editingComboAccess.value)
    editingComboAccess.value.comboAccessList =
      editingComboAccess.value.comboAccessList.filter((item) => item !== name);
}

function removeRemovedComboAccessItems() {
  if (editingComboAccess.value)
    editingComboAccess.value.comboAccessList =
      editingComboAccess.value.comboAccessList.filter((name) =>
        activeComboNames.value.has(name),
      );
}

async function saveComboAccess() {
  if (!editingComboAccess.value) return;
  const edit = editingComboAccess.value;
  const result = await updateKey(edit.id, {
    comboAccessMode: edit.comboAccessMode,
    comboAccessList: edit.comboAccessList,
  });
  if (result) editingComboAccess.value = null;
}

function openModelAccess(key: ApiKey) {
  editingModelAccess.value = {
    ...key,
    modelAccessMode:
      key.modelAccessMode === "blacklist" ? "blacklist" : "whitelist",
    modelAccessList: Array.isArray(key.modelAccessList)
      ? [...key.modelAccessList]
      : [],
  };
}

function normalizeAccessList(value: unknown) {
  const items = Array.isArray(value)
    ? value
    : String(value || "").split(/[\n,]/);
  return Array.from(
    new Set(items.map((item) => String(item).trim()).filter(Boolean)),
  );
}

function toggleModelAccessItem(modelName: string) {
  if (!editingModelAccess.value) return;
  const list = new Set(
    normalizeAccessList(editingModelAccess.value.modelAccessList),
  );
  if (list.has(modelName)) list.delete(modelName);
  else list.add(modelName);
  editingModelAccess.value.modelAccessList = Array.from(list);
}

async function saveModelAccess() {
  if (!editingModelAccess.value) return;
  const edit = editingModelAccess.value;
  const result = await updateKey(edit.id, {
    modelAccessMode: edit.modelAccessMode,
    modelAccessList: normalizeAccessList(edit.modelAccessList),
  });
  if (result) editingModelAccess.value = null;
}

function confirmResetUsage(key: ApiKey) {
  confirmState.value = {
    title: "Reset usage counters",
    message: `Reset lifetime usage counters for "${key.name}"?\n\nThis only clears the limit counters (not usage history).`,
    onConfirm: async () => {
      await updateKey(key.id, { resetUsage: true });
    },
  };
}

function openEvent(key: ApiKey) {
  void router.push({ name: "event-key-detail", params: { id: key.id } });
}

// Connections per combo are loaded lazily into pinConnections, keyed by
// provider id, so each model's provider shows its checkbox list.
function providerOfModel(model: string): string {
  return String(model || "").split("/")[0] || "";
}

async function loadPinConnections(provider: string) {
  if (!provider || pinConnections.value[provider]) return;
  try {
    const result = await api.providers.listPaginated({
      provider,
      pageSize: 200,
    });
    const items = result.connections || [];
    pinConnections.value[provider] = items.map((conn) => ({
      id: String(conn.id),
      label:
        String(conn.name || conn.email || "") ||
        `${String(conn.authType || "connection")} ${String(conn.id).slice(0, 6)}`,
    }));
  } catch {
    pinConnections.value[provider] = [];
  }
}

function openConnectionPins(key: ApiKey) {
  const pins: Record<string, Record<string, string[]>> = {};
  for (const [combo, models] of Object.entries(key.connectionPins || {})) {
    pins[combo] = {};
    for (const [model, ids] of Object.entries(models || {})) {
      pins[combo][model] = Array.isArray(ids) ? [...ids] : [];
    }
  }
  editingConnectionPins.value = { id: key.id, name: key.name, pins };
  pinConnections.value = {};
  const selected = new Set(
    Array.isArray(key.comboAccessList) ? key.comboAccessList : [],
  );
  for (const combo of activeCombos.value) {
    if (!selected.has(combo.name) || !Array.isArray(combo.models)) continue;
    for (const model of combo.models) {
      if (typeof model === "string")
        void loadPinConnections(providerOfModel(model));
    }
  }
}

function pinCombos(): Array<{ name: string; models: string[] }> {
  const selected = new Set(
    (() => {
      const key = keys.value.find(
        (item) => item.id === editingConnectionPins.value?.id,
      );
      return Array.isArray(key?.comboAccessList) ? key.comboAccessList : [];
    })(),
  );
  return activeCombos.value
    .filter((combo) => selected.has(combo.name))
    .map((combo) => ({
      name: combo.name,
      models: (Array.isArray(combo.models) ? combo.models : []).filter(
        (model): model is string =>
          typeof model === "string" && Boolean(model.trim()),
      ),
    }));
}

function pinnedIds(combo: string, model: string): string[] {
  return editingConnectionPins.value?.pins?.[combo]?.[model] || [];
}

function togglePin(combo: string, model: string, connectionId: string) {
  const edit = editingConnectionPins.value;
  if (!edit) return;
  if (!edit.pins[combo]) edit.pins[combo] = {};
  const current = new Set(edit.pins[combo][model] || []);
  if (current.has(connectionId)) current.delete(connectionId);
  else current.add(connectionId);
  edit.pins[combo][model] = Array.from(current);
}

function isPinned(combo: string, model: string, connectionId: string): boolean {
  return pinnedIds(combo, model).includes(connectionId);
}

async function saveConnectionPins() {
  if (!editingConnectionPins.value) return;
  const result = await updateKey(editingConnectionPins.value.id, {
    connectionPins: editingConnectionPins.value.pins,
  });
  if (result) editingConnectionPins.value = null;
}

function disableTunnel(kind: "cloudflare" | "tailscale") {
  if (
    !window.confirm(
      `Disable ${kind === "cloudflare" ? "Cloudflare Tunnel" : "Tailscale"}?`,
    )
  )
    return;
  const operation =
    kind === "cloudflare"
      ? api.host.tunnels.disable
      : api.host.tunnels.tailscaleDisable;
  void operation().then(() => tunnels.refetch());
}

async function enableTunnel(kind: "cloudflare" | "tailscale") {
  tunnelBusy.value = kind;
  try {
    if (kind === "cloudflare") await api.host.tunnels.enable();
    else await api.host.tunnels.tailscaleEnable();
    await tunnels.refetch();
    notices.push(
      "success",
      `${kind === "cloudflare" ? "Cloudflare" : "Tailscale"} tunnel enabled.`,
    );
  } catch (error) {
    notices.push(
      "error",
      error instanceof Error ? error.message : "Tunnel enable failed.",
    );
  } finally {
    tunnelBusy.value = "";
  }
}
</script>

<template>
  <div class="theme-v2 flex flex-col gap-8">
    <Card class="p-5">
      <h2 class="mb-2 flex items-center gap-2 text-base font-semibold">
        <span class="material-symbols-outlined text-primary">api</span>API
        Endpoint
      </h2>
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <span
            class="min-w-[88px] shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-center font-mono text-xs text-primary"
            >Local</span
          >
          <Input :model-value="endpoint" readonly class="flex-1 font-mono" />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Copy local endpoint"
            @click="copy(endpoint, 'Local endpoint copied.')"
            ><Copy class="size-4"
          /></Button>
        </div>
        <div class="flex items-center gap-2">
          <span
            class="min-w-[88px] shrink-0 rounded px-1.5 py-0.5 text-center font-mono text-xs"
            :class="
              tunnelData?.settingsEnabled
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground'
            "
            >Tunnel</span
          >
          <template v-if="tunnelData?.settingsEnabled && tunnelData?.tunnelUrl">
            <Input
              :model-value="`${String(tunnelData.publicUrl || tunnelData.tunnelUrl)}/v1`"
              readonly
              class="flex-1 font-mono"
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Copy tunnel endpoint"
              @click="
                copy(
                  `${String(tunnelData.publicUrl || tunnelData.tunnelUrl)}/v1`,
                  'Tunnel endpoint copied.',
                )
              "
              ><Copy class="size-4"
            /></Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Disable tunnel"
              :disabled="Boolean(tunnelBusy)"
              @click="disableTunnel('cloudflare')"
              ><span class="material-symbols-outlined text-destructive"
                >power_settings_new</span
              ></Button
            >
          </template>
          <Button
            v-else
            size="sm"
            variant="outline"
            :disabled="Boolean(tunnelBusy)"
            @click="enableTunnel('cloudflare')"
            >{{
              tunnelBusy === "cloudflare" ? "Starting..." : "Enable"
            }}</Button
          >
        </div>
        <div class="flex items-center gap-2">
          <span
            class="min-w-[88px] shrink-0 rounded px-1.5 py-0.5 text-center font-mono text-xs"
            :class="
              tailscaleData?.settingsEnabled
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground'
            "
            >Tailscale</span
          >
          <template
            v-if="tailscaleData?.settingsEnabled && tailscaleData?.tunnelUrl"
          >
            <Input
              :model-value="`${String(tailscaleData.tunnelUrl)}/v1`"
              readonly
              class="flex-1 font-mono"
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Copy Tailscale endpoint"
              @click="
                copy(
                  `${String(tailscaleData.tunnelUrl)}/v1`,
                  'Tailscale endpoint copied.',
                )
              "
              ><Copy class="size-4"
            /></Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Disable Tailscale"
              :disabled="Boolean(tunnelBusy)"
              @click="disableTunnel('tailscale')"
              ><span class="material-symbols-outlined text-destructive"
                >power_settings_new</span
              ></Button
            >
          </template>
          <Button
            v-else
            size="sm"
            variant="outline"
            :disabled="Boolean(tunnelBusy)"
            @click="enableTunnel('tailscale')"
            >{{ tunnelBusy === "tailscale" ? "Starting..." : "Enable" }}</Button
          >
        </div>
      </div>
    </Card>

    <Card id="require-api-key" class="p-5">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="flex items-center gap-2 text-lg font-semibold">
          <span class="material-symbols-outlined text-primary">vpn_key</span>API
          Keys
          <span
            v-if="keysPagination.totalItems > 0"
            class="text-sm font-normal text-muted-foreground"
            >({{ keysPagination.totalItems }})</span
          >
        </h2>
      </div>

      <div
        class="mb-3 flex flex-col gap-3 border-b pb-3 lg:flex-row lg:items-center lg:justify-between"
      >
        <div class="flex items-center gap-3">
          <Toggle
            size="sm"
            :checked="requireApiKey"
            :disabled="saveSecurity.isPending.value"
            @change="handleRequireApiKey"
          />
          <p class="text-sm font-medium">Require API key</p>
        </div>
      </div>
      <div
        v-if="isRemoteHost && !requireApiKey"
        class="mb-4 -mt-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
      >
        Endpoint is exposed without an API key.
      </div>

      <ApiKeysList
        :keys="keys"
        :pagination="keysPagination"
        :search-input="keysSearchInput"
        :visibility-tab="keysVisibilityTab"
        :loading="keysLoading"
        @search="
          (value: string) => {
            keysSearchInput = value;
          }
        "
        @page="
          (value: number) => {
            keysPage = value;
          }
        "
        @page-size="
          (value: number) => {
            keysPageSize = value;
            keysPage = 1;
          }
        "
        @visibility="
          (value: 'private' | 'public' | 'event') => {
            keysVisibilityTab = value;
            keysPage = 1;
          }
        "
        @create="
          () => {
            newKeyVisibility = keysVisibilityTab;
            newKeyIsDefault = false;
            newKeyLimitMode = 'none';
            newKeyLimitValue = '';
            newKeyMaxConcurrency = '';
            showAddModal = true;
          }
        "
        @copy="copyKey"
        @toggle="handleToggleKey"
        @pause="confirmPause"
        @edit-combo="openComboAccess"
        @edit-model="openModelAccess"
        @set-default="handleSetDefault"
        @edit-limit="openLimit"
        @reset-usage="confirmResetUsage"
        @open-stats="openUsageStats"
        @show-tracker="openTracker"
        @delete="confirmDelete"
        @open-event="openEvent"
        @edit-pins="openConnectionPins"
      />
    </Card>

    <Modal :open="showAddModal" title="Create API Key" @close="resetCreate">
      <form class="flex flex-col gap-4" @submit.prevent="handleCreateKey">
        <div class="flex flex-col gap-1.5">
          <label for="key-name" class="text-sm font-medium">Key Name</label
          ><Input
            id="key-name"
            v-model="newKeyName"
            placeholder="Production Key"
            required
          />
        </div>
        <div v-if="newKeyVisibility !== 'event'" class="flex flex-col gap-1.5">
          <label for="key-prefix" class="text-sm font-medium"
            >Key Prefix (optional)</label
          ><Input
            id="key-prefix"
            v-model="newKeyPrefix"
            :placeholder="apiKeyPrefix || 'sk-'"
          />
          <p class="text-xs text-muted-foreground">
            Uses the runtime prefix {{ apiKeyPrefix || "sk-" }} when blank. A
            trailing hyphen is added automatically.
          </p>
        </div>
        <div v-if="newKeyVisibility !== 'event'" class="flex flex-col gap-1.5">
          <label for="key-custom" class="text-sm font-medium"
            >Custom API Key (optional)</label
          ><Input
            id="key-custom"
            v-model="newKeyCustomValue"
            placeholder="bagus"
          />
          <p class="text-xs text-muted-foreground">
            The final key combines the prefix and this value, for example
            ac-bagus.
          </p>
        </div>
        <p v-if="newKeyError" class="text-xs text-red-500">{{ newKeyError }}</p>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Type</label>
          <div
            class="inline-flex h-9 w-fit items-center rounded-[10px] bg-muted p-1"
          >
            <button
              type="button"
              class="h-7 rounded-[8px] px-4 text-xs font-medium"
              :class="
                newKeyVisibility === 'private'
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground'
              "
              @click="
                newKeyVisibility = 'private';
                newKeyIsDefault = false;
              "
            >
              Private</button
            ><button
              type="button"
              class="h-7 rounded-[8px] px-4 text-xs font-medium"
              :class="
                newKeyVisibility === 'public'
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground'
              "
              @click="newKeyVisibility = 'public'"
            >
              Public
            </button>
            <button
              type="button"
              class="h-7 rounded-[8px] px-4 text-xs font-medium"
              :class="
                newKeyVisibility === 'event'
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground'
              "
              @click="
                newKeyVisibility = 'event';
                newKeyIsDefault = false;
              "
            >
              Event
            </button>
          </div>
          <p class="text-xs text-muted-foreground">
            {{
              newKeyVisibility === "public"
                ? "Public keys work for API calls and can be set as the default key."
                : newKeyVisibility === "event"
                  ? "Event keys have no secret. Visitors of the event link create their own keys, which inherit this configuration."
                  : "Private keys work for API calls."
            }}
          </p>
        </div>
        <label
          v-if="newKeyVisibility === 'public'"
          class="flex cursor-pointer items-start gap-2"
          ><input
            v-model="newKeyIsDefault"
            type="checkbox"
            class="mt-0.5 rounded border-border"
          /><span class="text-sm"
            >Set as default for
            <code class="rounded bg-muted px-1 text-xs">/connect</code
            ><span class="mt-0.5 block text-xs text-muted-foreground"
              >Only one public key can be default. This replaces the existing
              default.</span
            ></span
          ></label
        >
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Lifetime usage limit</label>
          <div
            class="inline-flex h-9 w-fit items-center rounded-[10px] bg-muted p-1"
          >
            <button
              v-for="option in [
                { value: 'none', label: 'None' },
                { value: 'requests', label: 'Requests' },
                { value: 'tokens', label: 'Tokens' },
              ]"
              :key="option.value"
              type="button"
              class="h-7 rounded-[8px] px-4 text-xs font-medium"
              :class="
                newKeyLimitMode === option.value
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground'
              "
              @click="selectNewKeyLimit(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
          <Input
            v-if="newKeyLimitMode !== 'none'"
            v-model="newKeyLimitValue"
            type="number"
            min="1"
            :placeholder="newKeyLimitMode === 'tokens' ? '100000' : '1000'"
          />
          <p class="text-xs text-muted-foreground">
            Lifetime cap. Requests over the limit return 429 until counters are
            reset.
          </p>
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Max concurrency (optional)</label>
          <Input
            v-model="newKeyMaxConcurrency"
            type="number"
            min="1"
            placeholder="In-flight requests (e.g. 10)"
          />
          <p class="text-xs text-muted-foreground">
            Maximum simultaneous in-flight requests. Empty means unlimited.
            Returns 429 when exceeded.
          </p>
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Rate limit (optional)</label>
          <div class="flex flex-col gap-2">
            <Input
              v-model="newKeyRequestsPerMinute"
              type="number"
              min="0"
              placeholder="Requests per minute (e.g. 60)"
            />
            <Input
              v-model="newKeyRequestsPerSecond"
              type="number"
              min="0"
              placeholder="Requests per second (e.g. 5)"
            />
          </div>
          <p class="text-xs text-muted-foreground">
            Maximum requests per window. Empty means unlimited. Returns 429 when
            exceeded.
          </p>
        </div>
        <div class="flex gap-2">
          <Button
            type="submit"
            class="flex-1"
            :disabled="
              !newKeyName.trim() ||
              (newKeyLimitMode !== 'none' && !(Number(newKeyLimitValue) > 0))
            "
            >Create</Button
          ><Button
            type="button"
            variant="ghost"
            class="flex-1"
            @click="resetCreate"
            >Cancel</Button
          >
        </div>
      </form>
    </Modal>

    <Modal
      :open="Boolean(editingLimit)"
      title="Usage limit"
      @close="editingLimit = null"
    >
      <div v-if="editingLimit" class="flex flex-col gap-4">
        <div>
          <p class="mb-1 text-sm font-medium">{{ editingLimit.name }}</p>
          <p class="text-xs text-muted-foreground">
            Lifetime counters: {{ editingLimit.usageRequests ?? 0 }} requests ·
            {{ number(editingLimit.usageTokens ?? 0) }} tokens
          </p>
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Limit mode</label>
          <div
            class="inline-flex h-9 w-fit items-center rounded-[10px] bg-muted p-1"
          >
            <button
              v-for="option in [
                { value: 'none', label: 'None' },
                { value: 'requests', label: 'Requests' },
                { value: 'tokens', label: 'Tokens' },
              ]"
              :key="option.value"
              type="button"
              class="h-7 rounded-[8px] px-4 text-xs font-medium"
              :class="
                editingLimit.limitMode === option.value
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground'
              "
              @click="selectEditLimit(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
        <Input
          v-if="editingLimit.limitMode !== 'none'"
          v-model="editingLimit.limitValue"
          type="number"
          min="1"
          :placeholder="editingLimit.limitMode === 'tokens' ? '100000' : '1000'"
        />
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Max concurrency (optional)</label>
          <Input
            v-model="editingLimit.maxConcurrency"
            type="number"
            min="1"
            placeholder="In-flight requests (e.g. 10)"
          />
          <p class="text-xs text-muted-foreground">
            Maximum simultaneous in-flight requests. Empty means unlimited.
            Returns 429 when exceeded.
          </p>
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Rate limit (optional)</label>
          <Input
            v-model="editingLimit.requestsPerMinute"
            type="number"
            min="0"
            placeholder="Requests per minute (e.g. 60)"
          />
          <Input
            v-model="editingLimit.requestsPerSecond"
            type="number"
            min="0"
            placeholder="Requests per second (e.g. 5)"
          />
          <p class="text-xs text-muted-foreground">
            Maximum requests per window. Empty means unlimited. Returns 429 when
            exceeded.
          </p>
        </div>
        <div class="flex gap-2">
          <Button
            class="flex-1"
            :disabled="
              editingLimit.limitMode !== 'none' &&
              !(Number(editingLimit.limitValue) > 0)
            "
            @click="saveLimit"
            >Save</Button
          ><Button variant="ghost" class="flex-1" @click="editingLimit = null"
            >Cancel</Button
          >
        </div>
      </div>
    </Modal>

    <Modal
      :open="Boolean(editingComboAccess)"
      title="Combo Access"
      @close="editingComboAccess = null"
    >
      <div class="flex flex-col gap-4">
        <div>
          <p class="mb-1 text-sm font-medium">{{ editingComboAccess?.name }}</p>
          <p class="text-xs text-muted-foreground">
            Rules apply only when the request model is a combo name. Direct
            model requests stay unaffected.
          </p>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <button
            type="button"
            class="rounded-lg border p-3 text-left"
            :class="
              editingComboAccess?.comboAccessMode !== 'whitelist'
                ? 'border-primary bg-primary/10'
                : ''
            "
            @click="
              editingComboAccess &&
              (editingComboAccess.comboAccessMode = 'blacklist')
            "
          >
            <p class="text-sm font-medium">Blacklist</p>
            <p class="mt-1 text-xs text-muted-foreground">
              Listed combos stay blocked. Empty allows all combos.
            </p></button
          ><button
            type="button"
            class="rounded-lg border p-3 text-left"
            :class="
              editingComboAccess?.comboAccessMode === 'whitelist'
                ? 'border-primary bg-primary/10'
                : ''
            "
            @click="
              editingComboAccess &&
              (editingComboAccess.comboAccessMode = 'whitelist')
            "
          >
            <p class="text-sm font-medium">Whitelist</p>
            <p class="mt-1 text-xs text-muted-foreground">
              Only listed combos stay allowed. Empty blocks all combos.
            </p>
          </button>
        </div>
        <div class="max-h-64 overflow-y-auto rounded-lg border">
          <p
            v-if="!activeCombos.length"
            class="p-4 text-sm text-muted-foreground"
          >
            No active combos configured yet.
          </p>
          <label
            v-for="combo in activeCombos"
            :key="combo.id || combo.name"
            class="flex cursor-pointer items-center justify-between gap-3 border-b px-3 py-3 last:border-b-0 hover:bg-muted"
            ><div class="min-w-0">
              <p class="truncate text-sm font-medium">{{ combo.name }}</p>
              <p class="truncate text-xs text-muted-foreground">
                {{
                  Array.isArray(combo.models)
                    ? combo.models.join(", ") || "No models"
                    : "No models"
                }}
              </p>
            </div>
            <input
              type="checkbox"
              :checked="
                editingComboAccess?.comboAccessList.includes(combo.name)
              "
              @change="toggleComboAccessItem(combo.name)"
          /></label>
          <div v-if="removedComboNames.length" class="border-t">
            <div class="flex items-center justify-between gap-3 bg-muted p-3">
              <div>
                <p class="text-sm font-medium">Removed combos</p>
                <p class="mt-1 text-xs text-muted-foreground">
                  These entries point to deleted combos.
                </p>
              </div>
              <button
                type="button"
                class="text-xs text-destructive"
                @click="removeRemovedComboAccessItems"
              >
                Remove all
              </button>
            </div>
            <div
              v-for="comboName in removedComboNames"
              :key="comboName"
              class="flex items-center justify-between gap-3 border-t p-3"
            >
              <div>
                <p class="truncate text-sm font-medium">{{ comboName }}</p>
                <p class="text-xs text-muted-foreground">No longer exists</p>
              </div>
              <button
                type="button"
                class="text-xs text-destructive"
                @click="removeComboAccessItem(comboName)"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
        <div class="flex gap-2">
          <Button class="flex-1" @click="saveComboAccess">Save</Button
          ><Button
            variant="ghost"
            class="flex-1"
            @click="editingComboAccess = null"
            >Cancel</Button
          >
        </div>
      </div>
    </Modal>

    <Modal
      :open="Boolean(editingModelAccess)"
      title="Model Access"
      @close="editingModelAccess = null"
    >
      <div class="flex flex-col gap-4">
        <div>
          <p class="mb-1 text-sm font-medium">{{ editingModelAccess?.name }}</p>
          <p class="text-xs text-muted-foreground">
            Rules apply to direct model requests. Combo-internal models bypass
            this gate.
          </p>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <button
            type="button"
            class="rounded-lg border p-3 text-left"
            :class="
              editingModelAccess?.modelAccessMode !== 'blacklist'
                ? 'border-primary bg-primary/10'
                : ''
            "
            @click="
              editingModelAccess &&
              (editingModelAccess.modelAccessMode = 'whitelist')
            "
          >
            <p class="text-sm font-medium">Whitelist</p>
            <p class="mt-1 text-xs text-muted-foreground">
              Only listed direct models stay allowed. Empty blocks all direct
              models.
            </p></button
          ><button
            type="button"
            class="rounded-lg border p-3 text-left"
            :class="
              editingModelAccess?.modelAccessMode === 'blacklist'
                ? 'border-primary bg-primary/10'
                : ''
            "
            @click="
              editingModelAccess &&
              (editingModelAccess.modelAccessMode = 'blacklist')
            "
          >
            <p class="text-sm font-medium">Blacklist</p>
            <p class="mt-1 text-xs text-muted-foreground">
              Listed direct models stay blocked. Empty allows all direct models.
            </p>
          </button>
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium">Direct model IDs</label
          ><textarea
            v-model="modelAccessText"
            class="min-h-28 w-full rounded-lg border bg-background p-3 font-mono text-sm"
            placeholder="openai/gpt-4.1&#10;anthropic/claude-sonnet-4"
          />
          <p class="mt-1 text-xs text-muted-foreground">
            Use canonical provider/model IDs, one per line or comma-separated.
          </p>
        </div>
        <div class="max-h-64 overflow-y-auto rounded-lg border">
          <p
            v-if="!modelCandidates.length"
            class="p-4 text-sm text-muted-foreground"
          >
            No combo models available as suggestions.
          </p>
          <label
            v-for="modelName in modelCandidates"
            :key="modelName"
            class="flex cursor-pointer items-center justify-between gap-3 border-b px-3 py-3 last:border-b-0 hover:bg-muted"
            ><code class="truncate font-mono text-xs">{{ modelName }}</code
            ><input
              type="checkbox"
              :checked="
                normalizeAccessList(
                  editingModelAccess?.modelAccessList,
                ).includes(modelName)
              "
              @change="toggleModelAccessItem(modelName)"
          /></label>
        </div>
        <div class="flex gap-2">
          <Button class="flex-1" @click="saveModelAccess">Save</Button
          ><Button
            variant="ghost"
            class="flex-1"
            @click="editingModelAccess = null"
            >Cancel</Button
          >
        </div>
      </div>
    </Modal>

    <Modal
      :open="Boolean(editingConnectionPins)"
      title="Connection pins"
      @close="editingConnectionPins = null"
    >
      <div v-if="editingConnectionPins" class="flex flex-col gap-4">
        <div>
          <p class="mb-1 text-sm font-medium">
            {{ editingConnectionPins.name }}
          </p>
          <p class="text-xs text-muted-foreground">
            Choose which provider connections this event key may use for each
            model inside its selected combos. Leaving a model unchecked pins
            nothing (the full pool is used). Check at least one connection to
            pin the model to that subset.
          </p>
        </div>
        <div
          v-if="pinCombos().length === 0"
          class="py-4 text-center text-sm text-muted-foreground"
        >
          No combos selected. Set combo access first.
        </div>
        <div
          v-else
          class="flex max-h-[50vh] flex-col gap-4 overflow-y-auto pr-1"
        >
          <div
            v-for="combo in pinCombos()"
            :key="combo.name"
            class="rounded-lg border p-3"
          >
            <p class="mb-2 text-sm font-semibold">{{ combo.name }}</p>
            <div
              v-for="model in combo.models"
              :key="model"
              class="mb-3 last:mb-0"
            >
              <p class="mb-1 font-mono text-xs text-muted-foreground">
                {{ model }}
              </p>
              <div
                v-if="
                  (pinConnections[providerOfModel(model)] || []).length === 0
                "
                class="py-1 text-xs text-muted-foreground"
              >
                No connections found for {{ providerOfModel(model) }}.
              </div>
              <label
                v-for="conn in pinConnections[providerOfModel(model)] || []"
                :key="conn.id"
                class="flex cursor-pointer items-center gap-2 py-0.5"
              >
                <input
                  type="checkbox"
                  class="rounded border-border"
                  :checked="isPinned(combo.name, model, conn.id)"
                  @change="togglePin(combo.name, model, conn.id)"
                />
                <span class="text-sm">{{ conn.label }}</span>
              </label>
            </div>
          </div>
        </div>
        <div class="flex gap-2">
          <Button class="flex-1" @click="saveConnectionPins">Save</Button>
          <Button
            variant="ghost"
            class="flex-1"
            @click="editingConnectionPins = null"
            >Cancel</Button
          >
        </div>
      </div>
    </Modal>

    <Modal
      :open="Boolean(createdKey)"
      title="API Key Created"
      @close="createdKey = null"
    >
      <div class="flex flex-col gap-4">
        <div
          class="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/20"
        >
          <p
            class="mb-2 text-sm font-medium text-yellow-800 dark:text-yellow-200"
          >
            Save this key now!
          </p>
          <p class="text-sm text-yellow-700 dark:text-yellow-300">
            This is the only time you will see this key. Store it securely.
          </p>
        </div>
        <div class="flex gap-2">
          <Input
            :model-value="createdKey"
            readonly
            class="flex-1 font-mono text-sm"
          /><Button
            variant="secondary"
            @click="createdKey && copy(createdKey, 'API key copied.')"
            >Copy</Button
          >
        </div>
        <Button class="w-full" @click="createdKey = null">Done</Button>
      </div>
    </Modal>

    <ConfirmModal
      :open="Boolean(confirmState)"
      :title="confirmState?.title"
      :message="confirmState?.message"
      :loading="confirmLoading"
      @close="confirmState = null"
      @confirm="confirmAction"
    />

    <Modal
      :open="showTrackerModal"
      title="Show Tracker"
      @close="showTrackerModal = false"
    >
      <div class="space-y-4">
        <p class="text-sm text-muted-foreground">
          Track total quota for a provider across all active accounts on the
          public stats page.
        </p>
        <div class="space-y-1.5">
          <Label for="tracker-provider">Provider</Label>
          <Select
            id="tracker-provider"
            v-model="trackerProvider"
            :options="trackerProviderOptions"
            placeholder="Select a provider"
            class="w-full"
          />
        </div>
        <div class="space-y-1.5">
          <Label for="tracker-label">Label (shown on stats page)</Label>
          <Input
            id="tracker-label"
            v-model="trackerLabel"
            placeholder="CodeBuddy"
          />
        </div>
        <div class="flex justify-between gap-2">
          <Button
            v-if="trackerKey?.features?.quotaTracker"
            type="button"
            variant="destructive"
            :disabled="trackerSaving"
            @click="removeTracker"
            >Remove</Button
          >
          <div class="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              @click="showTrackerModal = false"
              >Cancel</Button
            >
            <Button
              :disabled="trackerSaving || !trackerProvider"
              @click="saveTracker"
              >{{ trackerSaving ? "Saving..." : "Save" }}</Button
            >
          </div>
        </div>
      </div>
    </Modal>
  </div>
</template>
