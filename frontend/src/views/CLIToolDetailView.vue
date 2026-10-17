<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import {
  ArrowLeft,
  ExternalLink,
  RefreshCw,
  Save,
  Server,
  SlidersHorizontal,
  Terminal,
  Trash2,
} from "lucide-vue-next";
import { RouterLink, useRoute } from "vue-router";
import PageHeader from "@/components/app/PageHeader.vue";
import ConfigCodeBlock from "@/components/tools/ConfigCodeBlock.vue";
import Card from "@/components/ui/card.vue";
import Button from "@/components/ui/button.vue";
import Combobox from "@/components/ui/combobox.vue";
import Input from "@/components/ui/input.vue";
import Label from "@/components/ui/label.vue";
import Badge from "@/components/ui/badge.vue";
import { api } from "@/lib/api";
import { getCliTool } from "@/lib/cliTools";
import { useNotificationStore } from "@/stores/notifications";

const route = useRoute();
const tool = computed(() => getCliTool(String(route.params.toolId || "")));
const providers = useQuery({
  queryKey: ["providers"],
  queryFn: api.providers.list,
});
const models = useQuery({
  queryKey: ["models"],
  queryFn: () => api.models.list(),
});
const keys = useQuery({ queryKey: ["api-keys"], queryFn: api.keys.list });
const settings = useQuery({
  queryKey: ["settings"],
  queryFn: api.settings.get,
});
const toolStatus = useQuery({
  queryKey: ["cli-tool-status", route.params.toolId],
  queryFn: () => api.cliTools.status(String(route.params.toolId || "")),
  enabled: computed(() => Boolean(tool.value)),
});
const notices = useNotificationStore();

const baseUrl = ref("");
const model = ref("");
const apiKey = ref("");
const selectedKeyId = ref("");
const generatedConfig = ref("");
const generationMessage = ref("");
const generating = ref(false);
const resetting = ref(false);

onMounted(() => {
  baseUrl.value = `${window.location.origin}/v1`;
});

const modelOptions = computed(() => models.data.value?.data || []);
const keyOptions = computed(() => [
  { value: "", label: "No saved key selected" },
  ...(keys.data.value || []).map((key) => ({
    value: key.id,
    label: `${key.name || "Unnamed key"}${key.isActive ? "" : " (inactive)"}`,
  })),
]);
const activeProviders = computed(
  () =>
    providers.data.value?.filter((provider) => provider.isActive).length || 0,
);
const selectedKey = computed(() =>
  keys.data.value?.find((key) => key.id === selectedKeyId.value),
);
const normalizedBaseUrl = computed(() => {
  const value = baseUrl.value.trim().replace(/\/+$/, "");
  return value.endsWith("/v1") ? value : `${value}/v1`;
});
const effectiveModel = computed(() => model.value.trim() || "<MODEL_ID>");
const effectiveApiKey = computed(
  () => apiKey.value.trim() || "<API_KEY_FROM_DASHBOARD>",
);

watch(
  modelOptions,
  (options) => {
    if (!model.value && options.length > 0) model.value = options[0].id;
  },
  { immediate: true },
);

function buildConfig() {
  const currentTool = tool.value;
  if (!currentTool) return "";
  if (currentTool.kind === "env") {
    if (currentTool.id === "claude") {
      return `export ANTHROPIC_BASE_URL="${normalizedBaseUrl.value}"\nexport ANTHROPIC_AUTH_TOKEN="${effectiveApiKey.value}"\nexport ANTHROPIC_MODEL="${effectiveModel.value}"`;
    }
    return `export OPENAI_BASE_URL="${normalizedBaseUrl.value}"\nexport OPENAI_API_KEY="${effectiveApiKey.value}"\nexport OPENAI_MODEL="${effectiveModel.value}"`;
  }
  if (currentTool.kind === "toml") {
    return `model = "${effectiveModel.value}"\nmodel_provider = "lobakai"\n\n[model_providers.lobakai]\nname = "LobakAI"\nbase_url = "${normalizedBaseUrl.value}"\nwire_api = "responses"\n\n# Store the key in the client's auth file\nOPENAI_API_KEY = "${effectiveApiKey.value}"`;
  }
  if (currentTool.kind === "json") {
    return JSON.stringify(
      {
        provider: {
          "lobakai": {
            npm: "@ai-sdk/openai-compatible",
            options: {
              baseURL: normalizedBaseUrl.value,
              apiKey: effectiveApiKey.value,
            },
            models: { [effectiveModel.value]: { name: effectiveModel.value } },
          },
        },
        model: `lobakai/${effectiveModel.value}`,
      },
      null,
      2,
    );
  }
  if (currentTool.kind === "desktop") {
    return JSON.stringify(
      {
        inferenceProvider: "gateway",
        inferenceGatewayBaseUrl: normalizedBaseUrl.value,
        inferenceGatewayApiKey: effectiveApiKey.value,
        inferenceModels: [{ name: effectiveModel.value }],
      },
      null,
      2,
    );
  }
  return `Base URL: ${normalizedBaseUrl.value}\nAPI key: ${effectiveApiKey.value}\nModel: ${effectiveModel.value}`;
}

const config = computed(buildConfig);
const capability = computed(() => {
  const value = toolStatus.data.value?.capability;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
});
const canGenerate = computed(
  () => tool.value?.kind === "guide" || capability.value.canGenerate === true,
);

async function generateConfig() {
  if (!tool.value) return;
  if (tool.value.kind === "guide") {
    generatedConfig.value = config.value;
    generationMessage.value =
      "Manual configuration generated. Copy it into this client's settings.";
    return;
  }
  generating.value = true;
  generationMessage.value = "";
  try {
    const result = await api.cliTools.generate(tool.value.id, {
      baseUrl: normalizedBaseUrl.value,
      model:
        effectiveModel.value === "<MODEL_ID>"
          ? undefined
          : effectiveModel.value,
      apiKey:
        effectiveApiKey.value === "<API_KEY_FROM_DASHBOARD>"
          ? undefined
          : effectiveApiKey.value,
      ...(tool.value.id === "claude"
        ? {
            env: {
              ANTHROPIC_BASE_URL: normalizedBaseUrl.value,
              ANTHROPIC_AUTH_TOKEN: effectiveApiKey.value,
              ANTHROPIC_MODEL: effectiveModel.value,
            },
          }
        : {}),
    });
    generatedConfig.value =
      typeof result.content === "string"
        ? result.content
        : JSON.stringify(result.config || result, null, 2);
    generationMessage.value = String(
      result.message || "Configuration generated and persisted.",
    );
    await toolStatus.refetch();
    notices.push(
      "success",
      generationMessage.value,
      "CLI configuration generated",
    );
  } catch (error) {
    notices.push(
      "error",
      error instanceof Error
        ? error.message
        : "Could not generate CLI configuration.",
    );
  } finally {
    generating.value = false;
  }
}

async function resetConfig() {
  if (
    !tool.value ||
    !window.confirm(`Reset the ${tool.value.name} LobakAI configuration?`)
  )
    return;
  resetting.value = true;
  try {
    const result = await api.cliTools.reset(tool.value.id);
    generatedConfig.value = "";
    generationMessage.value = String(result.message || "Configuration reset.");
    await toolStatus.refetch();
    notices.push("success", generationMessage.value);
  } catch (error) {
    notices.push(
      "error",
      error instanceof Error
        ? error.message
        : "Could not reset CLI configuration.",
    );
  } finally {
    resetting.value = false;
  }
}
</script>

<template>
  <div v-if="!tool" class="space-y-6">
    <PageHeader
      title="CLI tool not found"
      description="The requested client is not available."
    />
    <RouterLink
      to="/dashboard/cli-tools"
      class="inline-flex items-center gap-2 text-sm text-primary hover:underline"
      ><ArrowLeft class="size-4" />Back to CLI tools</RouterLink
    >
  </div>

  <div v-else class="space-y-6">
    <RouterLink
      to="/dashboard/cli-tools"
      class="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-primary"
      ><ArrowLeft class="size-3.5" />Back to CLI tools</RouterLink
    >
    <PageHeader :title="tool.name" :description="tool.description">
      <template #actions>
        <a
          v-if="tool.docsUrl"
          :href="tool.docsUrl"
          target="_blank"
          rel="noreferrer"
          class="inline-flex h-8 items-center gap-2 rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
          >Documentation <ExternalLink class="size-3.5"
        /></a>
      </template>
    </PageHeader>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Card class="p-5">
        <div class="mb-5 flex items-start gap-3">
          <div
            class="grid size-9 place-items-center rounded-lg bg-accent text-accent-foreground"
          >
            <SlidersHorizontal class="size-4" />
          </div>
          <div>
            <h2 class="text-sm font-semibold">Configuration inputs</h2>
            <p class="mt-1 text-xs text-muted-foreground">
              Generate a preview and write the same resolved configuration to
              the local client file.
            </p>
          </div>
        </div>
        <div class="grid gap-5 md:grid-cols-2">
          <div class="space-y-2 md:col-span-2">
            <Label for="cli-base-url">Gateway base URL</Label>
            <Input
              id="cli-base-url"
              v-model="baseUrl"
              placeholder="http://127.0.0.1:20128/v1"
            />
            <p class="text-xs text-muted-foreground">
              The v2 gateway routes clients through its OpenAI-compatible `/v1`
              surface.
            </p>
          </div>
          <div class="space-y-2">
            <Label for="cli-model">Model</Label>
            <Input
              id="cli-model"
              v-model="model"
              list="v2-model-options"
              placeholder="provider/model-id"
            />
            <datalist id="v2-model-options">
              <option
                v-for="item in modelOptions"
                :key="item.id"
                :value="item.id"
              />
            </datalist>
            <p
              v-if="models.isPending.value"
              class="text-xs text-muted-foreground"
            >
              Loading models from v2...
            </p>
            <p v-else-if="!modelOptions.length" class="text-xs text-warning">
              No v2 models are configured. Enter a model id or visit Models.
            </p>
          </div>
          <div class="space-y-2">
            <Label for="cli-key-name">Dashboard key context</Label>
            <Combobox
              id="cli-key-name"
              v-model="selectedKeyId"
              :options="keyOptions"
              :loading="keys.isPending.value"
              placeholder="Search saved keys..."
              empty-text="No saved keys available"
            />
            <p class="text-xs text-muted-foreground">
              {{
                selectedKey
                  ? `Selected: ${selectedKey.keyPrefix || "masked key"} (secret not returned by v2)`
                  : "Select a label for context, then paste the secret below."
              }}
            </p>
          </div>
          <div class="space-y-2 md:col-span-2">
            <Label for="cli-secret">API key to place in generated config</Label>
            <Input
              id="cli-secret"
              v-model="apiKey"
              type="password"
              autocomplete="off"
              placeholder="Paste a key or leave the explicit placeholder"
            />
            <p class="text-xs text-muted-foreground">
              v2 never returns existing secrets. A blank field intentionally
              produces `&lt;API_KEY_FROM_DASHBOARD&gt;` instead of a fake
              credential.
            </p>
          </div>
        </div>
        <div class="mt-6 flex flex-wrap items-center gap-2 border-t pt-5">
          <Button
            :disabled="!canGenerate || generating"
            title="Generate and persist the configuration through v2"
            @click="generateConfig"
            ><RefreshCw v-if="generating" class="size-4 animate-spin" /><Save
              v-else
              class="size-4"
            />{{ generating ? "Generating..." : "Generate & apply" }}</Button
          >
          <Button
            variant="ghost"
            :disabled="resetting || !toolStatus.data.value?.installed"
            title="Reset the persisted LobakAI configuration"
            @click="resetConfig"
            ><Trash2 class="size-4 text-destructive" />Reset</Button
          >
        </div>
      </Card>

      <Card class="p-5">
        <div class="flex items-start gap-3">
          <div
            class="grid size-9 place-items-center rounded-lg bg-accent text-accent-foreground"
          >
            <Server class="size-4" />
          </div>
          <div>
            <h2 class="text-sm font-semibold">Live v2 context</h2>
            <p class="mt-1 text-xs text-muted-foreground">
              Read-only values from the current backend.
            </p>
          </div>
        </div>
        <dl class="mt-5 divide-y text-sm">
          <div class="flex items-center justify-between gap-3 py-3">
            <dt class="text-muted-foreground">Active providers</dt>
            <dd class="font-semibold">
              {{ providers.isPending.value ? "..." : activeProviders }}
            </dd>
          </div>
          <div class="flex items-center justify-between gap-3 py-3">
            <dt class="text-muted-foreground">Models available</dt>
            <dd class="font-semibold">
              {{ models.isPending.value ? "..." : modelOptions.length }}
            </dd>
          </div>
          <div class="flex items-center justify-between gap-3 py-3">
            <dt class="text-muted-foreground">Gateway auth</dt>
            <dd>
              <Badge
                :variant="
                  settings.data.value?.requireApiKey ? 'warning' : 'success'
                "
                >{{
                  settings.isPending.value
                    ? "Loading"
                    : settings.data.value?.requireApiKey
                      ? "Key required"
                      : "Optional"
                }}</Badge
              >
            </dd>
          </div>
          <div class="flex items-center justify-between gap-3 py-3">
            <dt class="text-muted-foreground">Backend status</dt>
            <dd>
              <Badge
                :variant="
                  toolStatus.isError.value
                    ? 'warning'
                    : toolStatus.data.value?.installed
                      ? 'success'
                      : 'secondary'
                "
                >{{
                  toolStatus.isPending.value
                    ? "Loading"
                    : toolStatus.isError.value
                      ? "Unavailable"
                      : toolStatus.data.value?.installed
                        ? "Detected"
                        : "Not detected"
                }}</Badge
              >
            </dd>
          </div>
          <div class="flex items-center justify-between gap-3 py-3">
            <dt class="text-muted-foreground">Generation</dt>
            <dd>
              <Badge :variant="canGenerate ? 'success' : 'warning'">{{
                canGenerate ? "Available" : "Disabled"
              }}</Badge>
            </dd>
          </div>
        </dl>
        <div
          class="mt-4 rounded-lg bg-muted/45 p-3 text-xs leading-5 text-muted-foreground"
        >
          <Terminal class="mr-1 inline size-3.5" />The generated block matches
          the LobakAI-owned configuration written to the local client file.
        </div>
      </Card>
    </div>

    <Card
      v-if="generationMessage"
      class="border-primary/20 bg-accent/35 p-4 text-sm text-muted-foreground"
      ><span class="font-medium text-foreground">{{ generationMessage }}</span
      ><span v-if="toolStatus.data.value?.configPath">
        Configuration path:
        <code>{{ String(toolStatus.data.value.configPath) }}</code></span
      ></Card
    >
    <ConfigCodeBlock
      :language="
        tool.kind === 'json' || tool.kind === 'desktop'
          ? 'json'
          : tool.kind === 'toml'
            ? 'toml / auth'
            : 'shell'
      "
      :filename="tool.configPath"
      :value="generatedConfig || config"
    />
  </div>
</template>
