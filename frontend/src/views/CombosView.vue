<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  CopyPlus,
  Edit3,
  KeyRound,
  Layers3,
  Plus,
  Settings2,
  Trash2,
  X,
} from "lucide-vue-next";
import { useRoute, useRouter } from "vue-router";
import { api } from "@/lib/api";
import type { Combo } from "@/types/api";
import PageHeader from "@/components/app/PageHeader.vue";
import DataTable from "@/components/app/DataTable.vue";
import Card from "@/components/ui/card.vue";
import Button from "@/components/ui/button.vue";
import Combobox from "@/components/ui/combobox.vue";
import Input from "@/components/ui/input.vue";
import Label from "@/components/ui/label.vue";
import Badge from "@/components/ui/badge.vue";
import { useNotificationStore } from "@/stores/notifications";
import Modal from "@/components/ui/modal.vue";
import ConfirmModal from "@/components/ui/ConfirmModal.vue";
import Select from "@/components/ui/select.vue";
import { modelOptionId } from "@/lib/modelOptions";
import { number as formatNumber } from "@/lib/format";

const VALID_NAME = /^[a-zA-Z0-9_.\-:]+$/;
const queryClient = useQueryClient();
const router = useRouter();
const route = useRoute();
const notices = useNotificationStore();
const combos = useQuery({ queryKey: ["combos"], queryFn: api.combos.list });
const providers = useQuery({
  queryKey: ["providers"],
  queryFn: api.providers.list,
});
const aliases = useQuery({
  queryKey: ["model-aliases"],
  queryFn: api.models.aliases,
});
const providerCatalog = useQuery({
  queryKey: ["provider-catalog"],
  queryFn: () => api.providers.catalog(),
});
const settings = useQuery({
  queryKey: ["settings"],
  queryFn: api.settings.get,
});
const editor = ref<Combo | null>(null);
const showCreate = ref(false);
const name = ref("");
const identityEnabled = ref(false);
const editorModels = ref<string[]>([]);
const editorStrategy = ref("fallback");
const capabilityVision = ref(false);
const capabilityReasoning = ref(false);
const capabilityTools = ref(false);
const capabilitySearch = ref(false);
const contextWindow = ref<number | null>(null);
const maxOutput = ref<number | null>(null);
const modelQuery = ref("");
const showSuggestions = ref(false);
type ModelSearchEntry = {
  id?: unknown;
  provider?: unknown;
  model?: unknown;
  name?: unknown;
  fullModel?: unknown;
  routedModel?: unknown;
};
const searchResults = ref<ModelSearchEntry[]>([]);
let searchTimer: number | undefined;
async function runModelSearch(query: string) {
  try {
    searchResults.value = await api.models.search(query, {
      kind: "llm",
      limit: 50,
    });
  } catch {
    searchResults.value = [];
  }
}
watch(
  modelQuery,
  (value) => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      void runModelSearch(value);
    }, 150);
  },
  { immediate: true },
);
onUnmounted(() => window.clearTimeout(searchTimer));
const judgeModel = ref("");
const editorBusy = ref(false);
const copied = ref("");
const strategySaving = ref("");
const removeTarget = ref<Combo | null>(null);
const duplicateTarget = ref<Combo | null>(null);
const duplicating = ref(false);
const comboStrategies = computed(
  () =>
    (settings.data.value?.comboStrategies || {}) as Record<
      string,
      { fallbackStrategy?: string; judgeModel?: string }
    >,
);
const llmCombos = computed(() =>
  (combos.data.value || []).filter(
    (combo) => !combo.kind || combo.kind === "llm",
  ),
);
const strategyOptions = [
  { value: "fallback", label: "Fallback" },
  { value: "round-robin", label: "Round Robin" },
  { value: "fusion", label: "Fusion" },
];

function modelsOf(combo: Combo | null) {
  if (!combo) return [];
  if (Array.isArray(combo.models)) return combo.models;
  try {
    return JSON.parse(combo.models) as string[];
  } catch {
    return [];
  }
}

function editorCapabilities(): Record<string, unknown> {
  const caps: Record<string, unknown> = {
    vision: capabilityVision.value,
    reasoning: capabilityReasoning.value,
    tools: capabilityTools.value,
    search: capabilitySearch.value,
  };
  const window = Number(contextWindow.value);
  const output = Number(maxOutput.value);
  if (Number.isFinite(window) && window > 0)
    caps.contextWindow = Math.floor(window);
  if (Number.isFinite(output) && output > 0)
    caps.maxOutput = Math.floor(output);
  return caps;
}

function applyCapabilities(combo: Combo | null) {
  const caps = (combo?.capabilities || {}) as Record<string, unknown>;
  capabilityVision.value = Boolean(caps.vision);
  capabilityReasoning.value = Boolean(caps.reasoning);
  capabilityTools.value = Boolean(caps.tools);
  capabilitySearch.value = Boolean(caps.search);
  contextWindow.value =
    typeof caps.contextWindow === "number" ? caps.contextWindow : null;
  maxOutput.value = typeof caps.maxOutput === "number" ? caps.maxOutput : null;
}

function comboCapabilityTags(combo: Combo): string[] {
  const caps = combo.capabilities || {};
  const tags: string[] = [];
  if (caps.vision) tags.push("Vision");
  if (caps.reasoning) tags.push("Reasoning");
  if (caps.tools) tags.push("Tools");
  if (caps.search) tags.push("Search");
  return tags;
}

function comboContextWindow(combo: Combo): number | null {
  const value = Number((combo.capabilities || {}).contextWindow);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function comboMaxOutput(combo: Combo): number | null {
  const value = Number((combo.capabilities || {}).maxOutput);
  return Number.isFinite(value) && value > 0 ? value : null;
}

async function copyName(combo: Combo) {
  await navigator.clipboard?.writeText(combo.name);
  copied.value = combo.id;
  window.setTimeout(() => {
    if (copied.value === combo.id) copied.value = "";
  }, 1200);
}

async function setStrategy(combo: Combo, patch: Record<string, unknown>) {
  strategySaving.value = combo.id;
  try {
    const next = { ...(comboStrategies.value[combo.name] || {}), ...patch };
    const all = {
      ...((settings.data.value?.comboStrategies as Record<string, unknown>) ||
        {}),
    };
    if (!next.fallbackStrategy || next.fallbackStrategy === "fallback")
      delete all[combo.name];
    else all[combo.name] = next;
    await api.settings.update({ comboStrategies: all });
    queryClient.setQueryData(["settings"], {
      ...(settings.data.value || {}),
      comboStrategies: all,
    });
  } catch (error) {
    notices.push(
      "error",
      error instanceof Error ? error.message : "Could not save combo strategy",
    );
  } finally {
    strategySaving.value = "";
  }
}

const remove = useMutation({
  mutationFn: api.combos.remove,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["combos"] });
    notices.push("success", "Combo removed.");
  },
  onError: (error) => notices.push("error", error.message),
});

function requestRemove(combo: Combo) {
  removeTarget.value = combo;
}

function confirmRemove() {
  const target = removeTarget.value;
  if (!target) return;
  removeTarget.value = null;
  remove.mutate(target.id);
}

function requestDuplicate(combo: Combo) {
  duplicateTarget.value = combo;
}

async function confirmDuplicate() {
  const source = duplicateTarget.value;
  if (!source || duplicating.value) return;
  duplicating.value = true;
  try {
    const existingNames = new Set(
      (combos.data.value || []).map((combo) => combo.name),
    );
    let newName = `${source.name}-copy`;
    while (existingNames.has(newName)) newName = `${newName}-copy`;
    const accountFilters =
      typeof source.accountFilters === "string"
        ? JSON.parse(source.accountFilters || "{}")
        : source.accountFilters || {};
    const created = await api.combos.create({
      name: newName,
      kind: source.kind,
      models: modelsOf(source),
      identityEnabled: Boolean(
        source.identityEnabled || source.identity_enabled,
      ),
      accountFilters,
      useCustomAccountOrder: Boolean(
        source.useCustomAccountOrder || source.use_custom_account_order,
      ),
      capabilities: source.capabilities || {},
    });
    const sourceStrategy = comboStrategies.value[source.name];
    if (
      sourceStrategy?.fallbackStrategy &&
      sourceStrategy.fallbackStrategy !== "fallback"
    ) {
      await setStrategy(created, {
        fallbackStrategy: sourceStrategy.fallbackStrategy,
        judgeModel: sourceStrategy.judgeModel,
      });
    }
    await queryClient.invalidateQueries({ queryKey: ["combos"] });
    notices.push("success", `Duplicated as ${newName}.`);
  } catch (error) {
    notices.push(
      "error",
      error instanceof Error ? error.message : "Could not duplicate combo",
    );
  } finally {
    duplicating.value = false;
    duplicateTarget.value = null;
  }
}

// Provider slug/alias → display name, so the selector can be searched by the
// human provider name ("CodeBuddy") instead of only its slug ("codebuddy-intl-cli").
const providerNameByKey = computed(() => {
  const map = new Map<string, string>();
  for (const p of providerCatalog.data.value?.providers || []) {
    const display = String(p.name || p.id);
    map.set(String(p.id), display);
    if (p.alias) map.set(String(p.alias), display);
  }
  return map;
});
function providerKeyOf(model: string): string {
  const slash = model.indexOf("/");
  return slash > 0 ? model.slice(0, slash) : "";
}
function providerNameOf(model: string): string {
  const key = providerKeyOf(model);
  return (key && providerNameByKey.value.get(key)) || key || "Other";
}

type Suggestion = { value: string; provider: string };
type SuggestionGroup = { provider: string; items: string[] };

const allOptions = computed<Suggestion[]>(() => {
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  const push = (value: string) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push({ value, provider: providerNameOf(value) });
  };
  // Live catalog results (rich entries → resolve to their fullModel/id).
  for (const entry of searchResults.value) push(modelOptionId(entry));
  // Existing LLM combos can nest as a step (v1 "Combos" section).
  for (const c of combos.data.value || [])
    if (!c.kind || c.kind === "llm") push(c.name);
  // Saved aliases.
  for (const alias of Object.keys(aliases.data.value || {})) push(alias);
  return out;
});

const query = computed(() => modelQuery.value.trim().toLowerCase());
const filteredSuggestions = computed<Suggestion[]>(() => {
  const q = query.value;
  return allOptions.value.filter((opt) => {
    if (editorModels.value.includes(opt.value)) return false;
    if (!q) return true;
    return (
      opt.value.toLowerCase().includes(q) ||
      opt.provider.toLowerCase().includes(q)
    );
  });
});

// Grouped for display: provider sections in first-seen order, models sorted
// within each section. The flat list stays available for Enter-to-add.
const modelSuggestions = computed(() =>
  filteredSuggestions.value.map((opt) => opt.value).slice(0, 50),
);
const groupedSuggestions = computed<SuggestionGroup[]>(() => {
  const groups = new Map<string, string[]>();
  for (const opt of filteredSuggestions.value.slice(0, 50)) {
    const list = groups.get(opt.provider) || [];
    list.push(opt.value);
    groups.set(opt.provider, list);
  }
  return [...groups.entries()]
    .map(([provider, items]) => ({ provider, items: items.sort() }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
});
const judgeModelOptions = computed(() => [
  { value: "", label: "Auto judge" },
  ...editorModels.value.map((model) => ({ value: model, label: model })),
]);
function openCreate() {
  showCreate.value = true;
  editor.value = null;
  name.value = "";
  identityEnabled.value = false;
  editorModels.value = [];
  editorStrategy.value = "fallback";
  judgeModel.value = "";
  modelQuery.value = "";
  showSuggestions.value = false;
  applyCapabilities(null);
}
function openEdit(combo: Combo) {
  editor.value = combo;
  showCreate.value = false;
  name.value = combo.name;
  identityEnabled.value = Boolean(
    combo.identityEnabled || combo.identity_enabled,
  );
  editorModels.value = [...modelsOf(combo)];
  editorStrategy.value =
    comboStrategies.value[combo.name]?.fallbackStrategy || "fallback";
  judgeModel.value = comboStrategies.value[combo.name]?.judgeModel || "";
  modelQuery.value = "";
  showSuggestions.value = false;
  applyCapabilities(combo);
}
watch(
  [() => route.query.edit, () => combos.data.value],
  ([edit]) => {
    const comboId = typeof edit === "string" ? edit : "";
    const target = comboId
      ? (combos.data.value || []).find((combo) => combo.id === comboId)
      : null;
    if (target && !editor.value) openEdit(target);
  },
  { immediate: true },
);
function addModel(value: string) {
  const model = value.trim();
  if (model && !editorModels.value.includes(model))
    editorModels.value.push(model);
  modelQuery.value = "";
  modelInput.value?.focus();
}
function removeModel(index: number) {
  editorModels.value.splice(index, 1);
}
function removeAllModels() {
  editorModels.value = [];
  modelInput.value?.focus();
}
function closeSuggestionsSoon() {
  window.setTimeout(() => {
    showSuggestions.value = false;
  }, 150);
}

const modelInput = ref<HTMLInputElement | null>(null);
function openSuggestions() {
  showSuggestions.value = true;
}
function moveModel(index: number, direction: number) {
  const target = index + direction;
  if (target < 0 || target >= editorModels.value.length) return;
  [editorModels.value[index], editorModels.value[target]] = [
    editorModels.value[target],
    editorModels.value[index],
  ];
}
async function saveEditor() {
  if (!name.value.trim() || !VALID_NAME.test(name.value)) {
    notices.push("error", "Enter a valid combo name.");
    return;
  }
  editorBusy.value = true;
  try {
    const input = {
      name: name.value.trim(),
      models: editorModels.value,
      identityEnabled: identityEnabled.value,
      capabilities: editorCapabilities(),
    };
    const target = editor.value
      ? await api.combos.update(editor.value.id, input)
      : await api.combos.create(input);
    await queryClient.invalidateQueries({ queryKey: ["combos"] });
    await setStrategy(target, {
      fallbackStrategy: editorStrategy.value,
      judgeModel:
        editorStrategy.value === "fusion" ? judgeModel.value : undefined,
    });
    notices.push("success", editor.value ? "Combo updated." : "Combo created.");
    showCreate.value = false;
    editor.value = null;
  } catch (error) {
    notices.push(
      "error",
      error instanceof Error ? error.message : "Could not save combo",
    );
  } finally {
    editorBusy.value = false;
  }
}
</script>

<template>
  <div class="theme-v2 space-y-6">
    <PageHeader
      title="Fallback combos"
      description="Group models under one name, then choose how requests move through the ordered route."
    >
      <template #actions
        ><Button @click="openCreate"
          ><Plus class="size-4" />Create combo</Button
        ></template
      >
    </PageHeader>
    <Card class="p-4 text-sm text-muted-foreground sm:p-5">
      <p>
        <span class="font-medium text-foreground">Fallback</span> tries models
        in order.
        <span class="font-medium text-foreground">Round Robin</span> rotates
        models across requests.
        <span class="font-medium text-foreground">Fusion</span> queries the
        panel and uses a judge model to synthesize the answer.
      </p>
    </Card>
    <DataTable
      :loading="combos.isPending.value"
      :empty="!combos.isPending.value && !llmCombos.length"
      :columns="['Combo', 'Models', 'Route', 'Details', '']"
      empty-title="No fallback combos"
      empty-description="Create model combos with fallback support."
    >
      <template #empty
        ><Button size="sm" @click="openCreate"
          ><Plus class="size-4" />Create combo</Button
        ></template
      >
      <tr v-for="combo in llmCombos" :key="combo.id" class="hover:bg-muted/50">
        <td class="px-3.75 py-[7.5px]">
          <div class="flex min-w-0 items-center gap-2.5">
            <div
              class="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground"
            >
              <Layers3 class="size-4" />
            </div>
            <button
              type="button"
              class="group/name flex min-w-0 items-center gap-1.5 text-left"
              :title="`Copy ${combo.name}`"
              @click="copyName(combo)"
            >
              <code class="min-w-0 truncate text-[13px] font-medium">{{
                combo.name
              }}</code>
              <Check
                v-if="copied === combo.id"
                class="size-3 shrink-0 text-success"
              />
              <Copy
                v-else
                class="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/name:opacity-100"
              />
            </button>
          </div>
        </td>
        <td class="max-w-[320px] px-3.75 py-[7.5px]">
          <div class="flex flex-wrap gap-1.5">
            <Badge
              v-for="(model, index) in modelsOf(combo)"
              :key="`${model}-${index}`"
              variant="secondary"
              class="font-mono font-normal"
              >{{ model }}</Badge
            >
            <span
              v-if="!modelsOf(combo).length"
              class="text-xs italic text-muted-foreground"
              >No models</span
            >
          </div>
        </td>
        <td
          class="whitespace-nowrap px-3.75 py-[7.5px] text-xs text-muted-foreground"
        >
          {{ modelsOf(combo).length }} model{{
            modelsOf(combo).length === 1 ? "" : "s"
          }}
        </td>
        <td class="px-3.75 py-[7.5px]">
          <div
            v-if="
              comboContextWindow(combo) ||
              comboMaxOutput(combo) ||
              comboCapabilityTags(combo).length
            "
            class="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground"
          >
            <span
              v-if="comboContextWindow(combo)"
              class="rounded bg-muted px-1.5 py-0.5"
              >{{ formatNumber(comboContextWindow(combo)) }} context</span
            ><span
              v-if="comboMaxOutput(combo)"
              class="rounded bg-muted px-1.5 py-0.5"
              >{{ formatNumber(comboMaxOutput(combo)) }} output</span
            ><span
              v-for="tag in comboCapabilityTags(combo)"
              :key="tag"
              class="rounded bg-muted px-1.5 py-0.5"
              >{{ tag }}</span
            >
          </div>
          <span v-else class="text-xs text-muted-foreground">—</span>
        </td>
        <td class="px-3.75 py-[7.5px]">
          <div class="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Duplicate combo"
              title="Duplicate combo"
              @click="requestDuplicate(combo)"
              ><CopyPlus class="size-3.5"
            /></Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Edit combo"
              title="Edit combo"
              @click="openEdit(combo)"
              ><Edit3 class="size-3.5"
            /></Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Manage accounts"
              title="Manage accounts"
              @click="router.push(`/dashboard/combos/${combo.id}`)"
              ><Settings2 class="size-3.5"
            /></Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Manage consumers"
              title="Manage consumers"
              @click="router.push(`/dashboard/combos/${combo.id}/consumers`)"
              ><KeyRound class="size-3.5"
            /></Button>
            <Button
              variant="ghost"
              size="icon"
              class="text-destructive"
              aria-label="Delete combo"
              @click="requestRemove(combo)"
              ><Trash2 class="size-3.5"
            /></Button>
          </div>
        </td>
      </tr>
    </DataTable>
    <Modal
      :open="showCreate || Boolean(editor)"
      :title="editor ? 'Edit combo' : 'Create combo'"
      size="full"
      @close="
        showCreate = false;
        editor = null;
      "
    >
      <p class="mb-4 text-xs text-muted-foreground">
        Use aliases or live catalog models, then arrange their priority.
      </p>
      <form class="space-y-4" @submit.prevent="saveEditor">
        <div class="space-y-2">
          <Label for="editor-name">Combo name</Label
          ><Input id="editor-name" v-model="name" placeholder="my-combo" />
          <p class="text-xs text-muted-foreground">
            Letters, numbers, -, _, . and : only.
          </p>
        </div>
        <label class="flex items-start gap-3"
          ><input
            v-model="identityEnabled"
            type="checkbox"
            class="mt-0.5 size-4 accent-primary"
          /><span
            ><span class="block text-sm font-medium"
              >Use combo name as assistant identity</span
            ><span class="block text-xs text-muted-foreground"
              >Identity questions are answered as
              {{ name || "this combo" }}.</span
            ></span
          ></label
        >
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-2">
            <Label>Models</Label>
            <button
              v-if="editorModels.length"
              type="button"
              class="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-destructive"
              @click="removeAllModels"
            >
              <X class="size-3" />Remove all
            </button>
          </div>
          <div data-model-field class="relative">
            <div
              class="flex h-9 items-center rounded-md border border-input bg-background px-2 focus-within:ring-2 focus-within:ring-ring/20"
            >
              <input
                ref="modelInput"
                v-model="modelQuery"
                type="text"
                class="min-w-32 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                placeholder="Search models or providers, then press Enter..."
                @focus="openSuggestions"
                @blur="closeSuggestionsSoon"
                @keydown.enter.prevent="
                  addModel(modelSuggestions[0] || modelQuery)
                "
                @keydown.down.prevent="openSuggestions"
              />
            </div>
            <div
              v-if="showSuggestions && groupedSuggestions.length"
              class="absolute inset-x-0 top-full z-10 mt-1 max-h-72 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            >
              <div
                v-for="group in groupedSuggestions"
                :key="group.provider"
                class="py-0.5"
              >
                <div
                  class="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                >
                  {{ group.provider }}
                </div>
                <button
                  v-for="model in group.items"
                  :key="model"
                  type="button"
                  class="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                  @mousedown.prevent="addModel(model)"
                >
                  <span class="truncate font-mono">{{ model }}</span>
                </button>
              </div>
            </div>
          </div>
          <div
            v-if="editorModels.length"
            class="max-h-72 overflow-y-auto rounded-md border border-border"
          >
            <div
              v-for="(model, index) in editorModels"
              :key="model + index"
              class="flex items-center gap-2 border-b border-border/60 px-2.5 py-1.5 last:border-b-0 hover:bg-muted/30"
            >
              <span
                class="w-5 shrink-0 text-center font-mono text-[11px] text-muted-foreground"
                >{{ index + 1 }}</span
              >
              <code class="min-w-0 flex-1 truncate font-mono text-xs">{{
                model
              }}</code>
              <div class="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  class="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                  :disabled="index === 0"
                  title="Move up"
                  aria-label="Move up"
                  @click="moveModel(index, -1)"
                >
                  <ChevronUp class="size-3.5" />
                </button>
                <button
                  type="button"
                  class="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                  :disabled="index === editorModels.length - 1"
                  title="Move down"
                  aria-label="Move down"
                  @click="moveModel(index, 1)"
                >
                  <ChevronDown class="size-3.5" />
                </button>
                <button
                  type="button"
                  class="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  title="Remove"
                  aria-label="Remove"
                  @click="removeModel(index)"
                >
                  <X class="size-3.5" />
                </button>
              </div>
            </div>
          </div>
          <p class="text-xs text-muted-foreground">
            Search by model, alias, or provider name — results are grouped by
            provider. Press Enter to add the top match. Models run top-to-bottom
            in the order shown — use the arrows to reorder.
          </p>
        </div>
        <div class="space-y-2">
          <div class="flex flex-wrap gap-3">
            <label class="flex items-center gap-1.5 text-sm"
              ><input
                v-model="capabilityVision"
                type="checkbox"
                class="size-4 accent-primary"
              />Vision</label
            ><label class="flex items-center gap-1.5 text-sm"
              ><input
                v-model="capabilityReasoning"
                type="checkbox"
                class="size-4 accent-primary"
              />Reasoning</label
            ><label class="flex items-center gap-1.5 text-sm"
              ><input
                v-model="capabilityTools"
                type="checkbox"
                class="size-4 accent-primary"
              />Tools</label
            ><label class="flex items-center gap-1.5 text-sm"
              ><input
                v-model="capabilitySearch"
                type="checkbox"
                class="size-4 accent-primary"
              />Search</label
            >
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1">
              <Label for="editor-context">Max context window</Label
              ><Input
                id="editor-context"
                v-model="contextWindow"
                type="number"
                min="1"
                placeholder="e.g. 128000"
              />
            </div>
            <div class="space-y-1">
              <Label for="editor-max-output">Max output tokens</Label
              ><Input
                id="editor-max-output"
                v-model="maxOutput"
                type="number"
                min="1"
                placeholder="e.g. 16384"
              />
            </div>
          </div>
          <p class="text-xs text-muted-foreground">
            Shown on the model list only. These do not change upstream routing.
          </p>
        </div>
        <div class="space-y-2">
          <Label for="editor-strategy">Mode</Label>
          <Select
            id="editor-strategy"
            :model-value="editorStrategy"
            :options="strategyOptions"
            class="h-9 w-full"
            aria-label="Combo mode"
            @update:model-value="editorStrategy = String($event)"
          />
          <p class="text-xs text-muted-foreground">
            <span class="font-medium text-foreground">Fallback</span> tries
            models in order ·
            <span class="font-medium text-foreground">Round Robin</span> rotates
            ·
            <span class="font-medium text-foreground">Fusion</span> synthesizes
            with a judge.
          </p>
        </div>
        <div v-if="editorStrategy === 'fusion'" class="space-y-2">
          <Label for="judge-model">Fusion judge model</Label
          ><Combobox
            id="judge-model"
            v-model="judgeModel"
            :options="judgeModelOptions"
            placeholder="Search judge models..."
            empty-text="No selected models"
          />
          <p class="text-xs text-muted-foreground">
            Used to synthesize the final answer from the panel.
          </p>
        </div>
        <div class="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            @click="
              showCreate = false;
              editor = null;
            "
            >Cancel</Button
          ><Button type="submit" :disabled="editorBusy">{{
            editorBusy ? "Saving..." : editor ? "Save" : "Create"
          }}</Button>
        </div>
      </form>
    </Modal>
    <ConfirmModal
      :open="Boolean(removeTarget)"
      title="Delete Combo"
      :message="`Delete combo ${removeTarget?.name || ''}? This action cannot be undone.`"
      confirm-text="Delete"
      :loading="remove.isPending.value"
      @confirm="confirmRemove"
      @close="removeTarget = null"
    />
    <ConfirmModal
      :open="Boolean(duplicateTarget)"
      title="Duplicate Combo"
      :message="`Create a copy of ${duplicateTarget?.name || ''} as ${duplicateTarget?.name || ''}-copy? The new combo will have the exact same models, mode, and account settings.`"
      confirm-text="Duplicate"
      :loading="duplicating"
      @confirm="confirmDuplicate"
      @close="duplicateTarget = null"
    />
  </div>
</template>
