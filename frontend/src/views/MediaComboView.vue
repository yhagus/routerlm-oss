<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Play,
  Plus,
  Save,
  Trash2,
} from "lucide-vue-next";
import { useRoute, useRouter } from "vue-router";
import { api } from "@/lib/api";
import PageHeader from "@/components/app/PageHeader.vue";
import Card from "@/components/ui/card.vue";
import Button from "@/components/ui/button.vue";
import Combobox from "@/components/ui/combobox.vue";
import EmptyState from "@/components/app/EmptyState.vue";
import { useNotificationStore } from "@/stores/notifications";

const route = useRoute(),
  router = useRouter(),
  queryClient = useQueryClient(),
  notices = useNotificationStore();
const id = computed(() => String(route.params.id || ""));
const combo = useQuery({
  queryKey: ["media-combo", id],
  queryFn: () => api.combos.get(id.value),
});
const settings = useQuery({
  queryKey: ["settings", "media-combo"],
  queryFn: api.settings.get,
});
const name = ref(""),
  models = ref<string[]>([]),
  candidate = ref("");
watch(
  () => combo.data.value,
  (value) => {
    if (value) {
      name.value = value.name;
      models.value = Array.isArray(value.models) ? [...value.models] : [];
    }
  },
  { immediate: true },
);
const kind = computed(() => String(combo.data.value?.kind || "media"));
const availableModels = useQuery({
  queryKey: ["gateway-models", "media-combo", kind],
  queryFn: () => api.gateway.models(kind.value),
  enabled: computed(() => Boolean(combo.data.value?.kind)),
});
const candidateOptions = computed(() =>
  (availableModels.data.value?.data || []).map((model) => ({
    value: model.id,
    label: model.id,
  })),
);
const back = computed(() =>
  kind.value === "webSearch" || kind.value === "webFetch"
    ? "/dashboard/media-providers/web"
    : `/dashboard/media-providers/${kind.value}`,
);
const roundRobin = computed({
  get: () =>
    (
      settings.data.value?.comboStrategies as
        Record<string, { fallbackStrategy?: string }> | undefined
    )?.[name.value]?.fallbackStrategy === "round-robin",
  set: async (enabled: boolean) => {
    const strategies = {
      ...((settings.data.value?.comboStrategies as Record<string, unknown>) ||
        {}),
    };
    if (enabled) strategies[name.value] = { fallbackStrategy: "round-robin" };
    else delete strategies[name.value];
    await api.settings.update({ comboStrategies: strategies });
    await settings.refetch();
  },
});
const testing = ref(false),
  testResult = ref(""),
  testError = ref("");
const save = useMutation({
  mutationFn: () =>
    api.combos.update(id.value, {
      name: name.value.trim(),
      models: models.value,
    }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["combos"] });
    queryClient.invalidateQueries({ queryKey: ["media-combo", id] });
    notices.push("success", "Media combo saved.");
  },
  onError: (error) => notices.push("error", error.message),
});
function add() {
  const value = candidate.value.trim();
  if (value && !models.value.includes(value)) models.value.push(value);
  candidate.value = "";
}
function move(index: number, delta: number) {
  const target = index + delta;
  if (target < 0 || target >= models.value.length) return;
  [models.value[index], models.value[target]] = [
    models.value[target],
    models.value[index],
  ];
}
async function remove() {
  if (!combo.data.value || !confirm(`Delete combo ${combo.data.value.name}?`))
    return;
  await api.combos.remove(id.value);
  await router.push(back.value);
}
async function testCombo() {
  const endpoint =
    kind.value === "webSearch"
      ? "/v1/search"
      : kind.value === "webFetch"
        ? "/v1/web/fetch"
        : kind.value === "image"
          ? "/v1/images/generations"
          : kind.value === "tts"
            ? "/v1/audio/speech"
            : "";
  if (!endpoint || testing.value) return;
  testing.value = true;
  testResult.value = "";
  testError.value = "";
  const body =
    kind.value === "webSearch"
      ? {
          model: name.value,
          query: "What is the latest news about AI?",
          search_type: "web",
          max_results: 5,
        }
      : kind.value === "webFetch"
        ? { model: name.value, url: "https://example.com", format: "markdown" }
        : kind.value === "image"
          ? {
              model: name.value,
              prompt: "A cute cat playing piano",
              n: 1,
              size: "1024x1024",
            }
          : {
              model: name.value,
              input: "Hello, this is a test.",
              voice: "alloy",
            };
  try {
    const response = await api.gateway.post(endpoint, body);
    const text = await response.text();
    if (!response.ok) throw new Error(text || `HTTP ${response.status}`);
    testResult.value = text || "Request completed.";
  } catch (error) {
    testError.value =
      error instanceof Error ? error.message : "Test request failed.";
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <div
    v-if="combo.isPending.value"
    class="theme-v2 h-40 animate-pulse rounded-xl bg-muted"
  />
  <EmptyState
    v-else-if="combo.isError.value || !combo.data.value"
    title="Media combo not found"
    description="This combo may have been removed."
    class="theme-v2"
    ><Button @click="router.push(back)"
      ><ArrowLeft class="size-4" />Back</Button
    ></EmptyState
  >
  <div v-else class="theme-v2 space-y-6">
    <PageHeader
      :title="`Media combo: ${combo.data.value.name}`"
      :description="`Configure ${kind} fallback models and account routing.`"
      ><template #actions
        ><Button variant="outline" @click="router.push(back)"
          ><ArrowLeft class="size-4" />Back</Button
        ><Button
          :disabled="save.isPending.value || !name.trim() || !models.length"
          @click="save.mutate()"
          ><Save class="size-4" />Save</Button
        ></template
      ></PageHeader
    >
    <Card class="space-y-4 p-5"
      ><label class="block text-sm font-medium"
        >Name<input
          v-model="name"
          class="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
          pattern="[A-Za-z0-9_.:-]+" /></label
      ><label
        class="flex items-center justify-between rounded-lg border p-3 text-sm"
        ><span
          ><span class="block font-medium">Round Robin</span
          ><span class="mt-1 block text-xs text-muted-foreground"
            >Rotate providers across requests instead of strict fallback
            order.</span
          ></span
        ><input
          v-model="roundRobin"
          type="checkbox"
          class="size-4 accent-primary"
      /></label>
      <div>
        <p class="text-sm font-medium">Providers</p>
        <div class="mt-2 flex gap-2">
          <Combobox
            v-model="candidate"
            :options="candidateOptions"
            placeholder="Search provider models..."
            empty-text="No provider models available"
            class="min-w-0 flex-1"
          /><Button variant="outline" @click="add"
            ><Plus class="size-4" />Add</Button
          >
        </div>
        <p class="mt-1 text-xs text-muted-foreground">
          Providers are tried in order.
        </p>
      </div>
      <div v-if="models.length" class="divide-y rounded-md border">
        <div
          v-for="(model, index) in models"
          :key="model"
          class="flex items-center gap-2 px-3 py-2"
        >
          <code class="min-w-0 flex-1 truncate text-sm">{{ model }}</code
          ><Button
            variant="ghost"
            size="icon"
            :disabled="index === 0"
            @click="move(index, -1)"
            ><ArrowUp class="size-4" /></Button
          ><Button
            variant="ghost"
            size="icon"
            :disabled="index === models.length - 1"
            @click="move(index, 1)"
            ><ArrowDown class="size-4" /></Button
          ><Button
            variant="ghost"
            size="icon"
            class="text-destructive"
            @click="models.splice(index, 1)"
            ><Trash2 class="size-4"
          /></Button>
        </div>
      </div>
      <p
        v-else
        class="rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground"
      >
        Add at least one provider.
      </p></Card
    >
    <Card class="p-5"
      ><h2 class="text-sm font-semibold">Account routing</h2>
      <p class="mt-1 text-sm text-muted-foreground">
        Use the combo account editor to select accounts per model.
      </p>
      <Button
        class="mt-4"
        variant="outline"
        @click="router.push(`/dashboard/combos/${id}/accounts`)"
        >Configure accounts</Button
      ></Card
    >
    <Card
      v-if="['webSearch', 'webFetch', 'image', 'tts'].includes(kind)"
      class="p-5"
      ><div class="flex items-center justify-between gap-3">
        <div>
          <h2 class="text-sm font-semibold">Test Example</h2>
          <p class="mt-1 text-xs text-muted-foreground">
            Send a v1 example request through this combo.
          </p>
        </div>
        <Button :disabled="testing || !models.length" @click="testCombo"
          ><Play class="size-4" />{{ testing ? "Running..." : "Run" }}</Button
        >
      </div>
      <p v-if="testError" class="mt-4 text-sm text-destructive">
        {{ testError }}
      </p>
      <pre
        v-if="testResult"
        class="mt-4 max-h-64 overflow-auto rounded bg-muted p-3 text-xs"
        >{{ testResult }}</pre>
    </Card>
    <Button variant="outline" class="text-destructive" @click="remove"
      ><Trash2 class="size-4" />Delete combo</Button
    >
  </div>
</template>
