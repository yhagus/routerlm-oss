<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import {
  Activity,
  Copy,
  Gauge,
  KeyRound,
  Play,
  RefreshCw,
} from "lucide-vue-next";
import { api, ApiError } from "@/lib/api";
import { number } from "@/lib/format";
import { buildChatCurl } from "@/lib/curl";
import CurlPlayground from "@/components/playground/CurlPlayground.vue";
import VisionPlayground from "@/components/playground/VisionPlayground.vue";
import ImageGenPlayground from "@/components/playground/ImageGenPlayground.vue";
import TryModelModal from "@/components/playground/TryModelModal.vue";
import Badge from "@/components/ui/badge.vue";
import Button from "@/components/ui/button.vue";
import Card from "@/components/ui/card.vue";
import Skeleton from "@/components/ui/skeleton.vue";
import TableSkeleton from "@/components/ui/table-skeleton.vue";
import UsageTrendChart from "@/components/usage/UsageTrendChart.vue";
import Input from "@/components/ui/input.vue";
import Select from "@/components/ui/select.vue";
import TabSwitcher from "@/components/ui/tab-switcher.vue";
import { useNotificationStore } from "@/stores/notifications";
import ToastStack from "@/components/app/ToastStack.vue";
import ThemeToggle from "@/components/app/ThemeToggle.vue";

const notices = useNotificationStore();
const route = useRoute();
const router = useRouter();
const apikey = computed(() =>
  String(route.query.apikey || route.query.key || "").trim(),
);
const keyInput = ref("");
function submitKey() {
  const value = keyInput.value.trim();
  if (!value) return;
  void router.push({ query: { apikey: value } });
}
const stats = useQuery({
  queryKey: computed(() => ["public-stats", apikey.value]),
  queryFn: () => api.publicStats.get(apikey.value),
  enabled: computed(() => Boolean(apikey.value)),
  refetchInterval: 5_000,
  retry: false,
});
const data = computed(() => stats.data.value);
const notFound = computed(
  () =>
    stats.error.value instanceof ApiError && stats.error.value.status === 404,
);
const baseUrl = `${window.location.origin}/v1`;
const exampleModel = computed(
  () => data.value?.combos?.[0]?.name || "your-model",
);
const curlDraft = ref("");
const curlTouched = ref(false);
watch(
  () => [apikey.value, exampleModel.value] as const,
  ([key, model]) => {
    if (curlTouched.value) return;
    curlDraft.value = buildChatCurl(baseUrl, key, model);
  },
  { immediate: true },
);
function onCurlInput(value: string) {
  curlTouched.value = true;
  curlDraft.value = value;
}
const tryModel = ref("");
const credentialRows = computed(() => [
  { label: "Base URL", value: baseUrl },
  { label: "API key", value: apikey.value },
]);
const gatewayModels = useQuery({
  queryKey: computed(() => ["gateway-models", apikey.value]),
  queryFn: async () => {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apikey.value}` },
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { data?: Array<{ id: string }> };
    return payload.data?.map((m) => m.id) || [];
  },
  enabled: computed(() => Boolean(apikey.value)),
  staleTime: 30_000,
});
const gatewayImageModels = useQuery({
  queryKey: computed(() => ["gateway-models-image", apikey.value]),
  queryFn: async () => {
    const response = await fetch(`${baseUrl}/models/image`, {
      headers: { Authorization: `Bearer ${apikey.value}` },
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { data?: Array<{ id: string }> };
    return payload.data?.map((m) => m.id) || [];
  },
  enabled: computed(() => Boolean(apikey.value)),
  staleTime: 30_000,
});
const visionModels = computed(() => {
  const combos = (data.value?.combos || []).map((c) => c.name);
  const extra = data.value?.key?.modelAccessList || [];
  const gateway = gatewayModels.data.value || [];
  return [...new Set([...combos, ...extra, ...gateway])];
});
const imageGenModels = computed(() => {
  const imageIds = gatewayImageModels.data.value || [];
  const combos = (data.value?.combos || [])
    .map((c) => c.name)
    .filter((name) => imageIds.includes(name));
  return [...new Set([...imageIds, ...combos])];
});
const limit = computed(() => {
  const key = data.value?.key;
  const max = Number(key?.limitValue || 0);
  if (!key || key.limitMode === "none" || !(max > 0)) return null;
  const used =
    key.limitMode === "tokens"
      ? Number(key.usageTokens || 0)
      : Number(key.usageRequests || 0);
  return {
    used,
    max,
    unit: key.limitMode,
    percent: Math.min(100, Math.round((used / max) * 100)),
  };
});
const logs = computed(() => data.value?.recentRequests || []);
const logTab = ref<"logs" | "ips">("logs");
const logTabOptions = [
  { value: "logs" as const, label: "Request Logs" },
  { value: "ips" as const, label: "Client IPs" },
];

const clientIpAgg = computed(() => {
  const rows = data.value?.byIp || [];
  return [...rows].sort((a, b) => b.lastUsed.localeCompare(a.lastUsed));
});
const cachedShare = computed(() => {
  const input = Number(data.value?.totals.promptTokens || 0);
  if (!input) return 0;
  return Math.round(
    (Number(data.value?.totals.cachedTokens || 0) / input) * 100,
  );
});
function cacheRate(combo: { cachedTokens: number; promptTokens: number }) {
  if (!combo.promptTokens) return 0;
  return Math.round((combo.cachedTokens / combo.promptTokens) * 100);
}
function percent(value: number) {
  if (!value) return "0%";
  const p = Math.round(value * 1000) / 10;
  return `${p}%`;
}
function tps(value: number) {
  if (!value) return "—";
  return `${Math.round(value)} t/s`;
}
function latencyMs(value: number) {
  if (!value) return "—";
  return value >= 1000
    ? `${Math.round(value / 100) / 10}s`
    : `${Math.round(value)}ms`;
}
function compact(value: number) {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return String(value);
}
function capsText(combo: {
  contextWindow: number | null;
  maxOutput: number | null;
}) {
  const parts: string[] = [];
  if (combo.contextWindow)
    parts.push(`${compact(combo.contextWindow)} context`);
  if (combo.maxOutput) parts.push(`${compact(combo.maxOutput)} output`);
  return parts.join(" · ");
}
function actualInput(row: { promptTokens: number; cachedTokens: number }) {
  return Math.max(0, Number(row.promptTokens) - Number(row.cachedTokens));
}
function relative(value: string | null | undefined) {
  if (!value) return "Never";
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 1000),
  );
  return seconds < 60
    ? seconds
      ? `${seconds}s ago`
      : "Just now"
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m ago`
      : seconds < 86400
        ? `${Math.floor(seconds / 3600)}h ago`
        : `${Math.floor(seconds / 86400)}d ago`;
}
async function copy(value: string) {
  await navigator.clipboard?.writeText(value);
  notices.push("success", "Copied to clipboard.");
}
</script>

<template>
  <main class="theme-v2 page-grid min-h-screen bg-background p-4 sm:p-8">
    <ToastStack />
    <div class="mx-auto max-w-4xl space-y-6">
      <div
        class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <h1 class="text-2xl font-semibold">API Status</h1>
          <div v-if="data" class="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="success">Active</Badge>
          </div>
          <p v-else-if="!apikey" class="mt-2 text-sm text-muted-foreground">
            Live usage for one gateway API key.
          </p>
        </div>
        <div
          class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
        >
          <template v-if="data">
            <span class="relative flex size-2">
              <span
                class="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75"
              />
              <span
                class="relative inline-flex size-2 rounded-full"
                :class="data.activeRequests ? 'bg-success' : 'bg-muted'"
              />
            </span>
            <span v-if="data.activeRequests"
              >{{ data.activeRequests }} in flight</span
            >
            <span v-else>Idle</span>
            <Button
              variant="ghost"
              size="icon"
              title="Refresh now"
              aria-label="Refresh now"
              :disabled="stats.isFetching.value"
              @click="stats.refetch()"
              ><RefreshCw
                :class="[
                  'size-[11px]',
                  stats.isFetching.value && 'animate-spin',
                ]"
            /></Button>
          </template>
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            title="Dashboard"
            aria-label="Go to dashboard"
            @click="router.push('/dashboard')"
            ><Gauge class="size-[11px]"
          /></Button>
        </div>
      </div>

      <div v-if="!apikey" class="py-10">
        <Card class="p-10 text-center">
          <div
            class="mx-auto grid size-11 place-items-center rounded-xl bg-accent text-accent-foreground"
          >
            <KeyRound class="size-4" />
          </div>
          <h2 class="mt-4 font-semibold">Add your API key</h2>
          <p class="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Enter a gateway API key to view live usage, limits, and request
            logs.
          </p>
          <form
            class="mx-auto mt-5 flex max-w-md flex-col gap-2 sm:flex-row"
            @submit.prevent="submitKey"
          >
            <Input
              v-model="keyInput"
              placeholder="sk-..."
              aria-label="API key"
              autocomplete="off"
              spellcheck="false"
              class="font-mono"
            />
            <Button type="submit" :disabled="!keyInput.trim()"
              >View status</Button
            >
          </form>
        </Card>
      </div>

      <div
        v-else-if="stats.isPending.value"
        class="space-y-6"
        role="status"
        aria-label="Loading API status"
      >
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card v-for="index in 4" :key="index" class="space-y-2 p-4">
            <Skeleton class="h-3 w-20" />
            <Skeleton class="h-7 w-24" />
            <Skeleton class="h-2.5 w-28" />
          </Card>
        </div>
        <Skeleton class="h-16 w-full rounded-[10px]" />
        <TableSkeleton
          :columns="[
            { width: '30%', lines: 2 },
            { width: '14%', align: 'end' },
            { width: '22%', align: 'end' },
            { width: '14%', align: 'end' },
            { width: '14%', align: 'end' },
          ]"
          :rows="4"
          label="Loading models"
        />
      </div>

      <Card v-else-if="stats.isError.value" class="p-10 text-center">
        <div
          class="mx-auto grid size-11 place-items-center rounded-xl bg-destructive/10 text-destructive"
        >
          <KeyRound class="size-4" />
        </div>
        <h2 class="mt-4 font-semibold">
          {{ notFound ? "Key not found or inactive" : "Status unavailable" }}
        </h2>
        <p class="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {{
            notFound
              ? "Check the key and try again."
              : "The gateway could not be reached. Try again shortly."
          }}
        </p>
        <Button
          v-if="notFound"
          class="mt-5"
          variant="outline"
          @click="router.push({ path: '/' })"
          >Try a different key</Button
        >
      </Card>

      <template v-else-if="data">
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card class="p-4">
            <p class="text-xs font-medium text-muted-foreground">
              Active requests
            </p>
            <p
              class="mt-2 flex items-center gap-2 text-2xl font-semibold tabular-nums"
            >
              <Activity
                v-if="data.activeRequests"
                class="size-4 text-success"
              />
              {{ number(data.activeRequests) }}
            </p>
            <p class="mt-1 text-[10px] text-muted-foreground">
              In flight right now
            </p>
          </Card>
          <Card class="p-4">
            <p class="text-xs font-medium text-muted-foreground">
              Total requests
            </p>
            <p class="mt-2 text-2xl font-semibold tabular-nums">
              {{ number(data.totals.requests) }}
            </p>
            <p class="mt-1 text-[10px] text-muted-foreground">
              Last used {{ relative(data.totals.lastUsed) }}
            </p>
          </Card>
          <Card class="p-4">
            <p class="text-xs font-medium text-muted-foreground">
              Input tokens
            </p>
            <p class="mt-2 text-2xl font-semibold tabular-nums">
              {{ number(data.totals.promptTokens) }}
            </p>
            <p class="mt-1 text-[10px] text-muted-foreground">
              {{ number(data.totals.cachedTokens) }} cached · {{ cachedShare }}%
              of input
            </p>
          </Card>
          <Card class="p-4">
            <p class="text-xs font-medium text-muted-foreground">
              Output tokens
            </p>
            <p class="mt-2 text-2xl font-semibold tabular-nums">
              {{ number(data.totals.completionTokens) }}
            </p>
            <p class="mt-1 text-[10px] text-muted-foreground">
              {{ number(data.totals.totalTokens) }} total
            </p>
          </Card>
        </div>

        <Card v-if="data.codebuddyTracker" class="p-4">
          <p class="text-xs font-medium text-muted-foreground">
            {{ data.codebuddyTracker.label }}
          </p>
          <p class="mt-2 text-2xl font-semibold tabular-nums">
            {{ number(data.codebuddyTracker.remaining) }}
            <span class="text-base font-normal text-muted-foreground"
              >/ {{ number(data.codebuddyTracker.total) }}</span
            >
          </p>
          <div class="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              class="h-full rounded-full transition-all"
              :class="
                data.codebuddyTracker.remaining > 0
                  ? 'bg-success'
                  : 'bg-destructive'
              "
              :style="{
                width: `${Math.min(100, Math.round((data.codebuddyTracker.remaining / Math.max(1, data.codebuddyTracker.total)) * 100))}%`,
              }"
            />
          </div>
        </Card>

        <Card class="p-4">
          <div
            class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
          >
            <p class="text-sm font-semibold">Usage limit</p>
            <p v-if="!limit" class="text-xs text-muted-foreground">
              No usage limit is set for this key.
            </p>
            <p v-else class="text-xs tabular-nums text-muted-foreground">
              {{ number(limit.used) }} / {{ number(limit.max) }}
              {{ limit.unit }}
            </p>
          </div>
          <div
            v-if="limit"
            class="mt-3 h-2 overflow-hidden rounded-full bg-muted"
          >
            <div
              class="h-full rounded-full transition-all"
              :class="
                limit.percent >= 90
                  ? 'bg-destructive'
                  : limit.percent >= 70
                    ? 'bg-warning'
                    : 'bg-success'
              "
              :style="{ width: `${limit.percent}%` }"
            />
          </div>
        </Card>

        <section>
          <div class="mb-3">
            <h2 class="text-sm font-semibold">Models</h2>
            <p class="text-xs text-muted-foreground">
              Usage per model for this key.
            </p>
          </div>
          <Card v-if="data.combos.length" class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead>
                <tr class="border-b bg-muted/60 text-muted-foreground">
                  <th class="px-3 py-[7.5px] font-semibold">Model</th>
                  <th class="px-3 py-[7.5px] text-right font-semibold">
                    Requests
                  </th>
                  <th class="px-3 py-[7.5px] text-right font-semibold">
                    Tokens (in / out)
                  </th>
                  <th class="px-3 py-[7.5px] text-right font-semibold">
                    Cache rate
                  </th>
                  <th class="px-3 py-[7.5px] text-right font-semibold">
                    Error rate
                  </th>
                  <th class="px-3 py-[7.5px] text-right font-semibold">
                    Avg t/s
                  </th>
                  <th class="px-3 py-[7.5px] text-right font-semibold">
                    Avg latency
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border/60">
                <tr
                  v-for="combo in data.combos"
                  :key="combo.name"
                  class="hover:bg-muted/50"
                >
                  <td class="px-3 py-[7.5px]">
                    <div class="group flex max-w-full items-center gap-1.5">
                      <button
                        type="button"
                        class="flex min-w-0 items-center gap-1.5 text-left"
                        :title="`Copy ${combo.name}`"
                        @click="copy(combo.name)"
                      >
                        <span
                          class="truncate font-medium group-hover:underline"
                        >
                          {{ combo.name }}
                        </span>
                        <Copy
                          class="size-2.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                        />
                      </button>
                      <button
                        type="button"
                        class="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 group-hover:opacity-100"
                        :title="`Try ${combo.name}`"
                        :aria-label="`Try ${combo.name}`"
                        @click="tryModel = combo.name"
                      >
                        <Play class="size-2.5" />
                      </button>
                    </div>
                    <p class="mt-0.5 text-[10px] text-muted-foreground">
                      <template v-if="capsText(combo)"
                        >{{ capsText(combo) }} · </template
                      >Last used {{ relative(combo.lastUsed) }}
                    </p>
                  </td>
                  <td class="px-3 py-[7.5px] text-right font-mono tabular-nums">
                    {{ number(combo.requests) }}
                  </td>
                  <td class="px-3 py-[7.5px] text-right font-mono tabular-nums">
                    {{ number(combo.promptTokens) }} /
                    {{ number(combo.completionTokens) }}
                  </td>
                  <td class="px-3 py-[7.5px] text-right font-mono tabular-nums">
                    {{ cacheRate(combo) }}%
                  </td>
                  <td class="px-3 py-[7.5px] text-right font-mono tabular-nums">
                    {{ percent(combo.errorRate) }}
                  </td>
                  <td class="px-3 py-[7.5px] text-right font-mono tabular-nums">
                    {{ tps(combo.avgTokensPerSecond) }}
                  </td>
                  <td class="px-3 py-[7.5px] text-right font-mono tabular-nums">
                    {{ latencyMs(combo.avgLatencyMs) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </Card>
          <p v-else class="text-sm text-muted-foreground">
            No models are assigned to this key yet.
          </p>
        </section>

        <section
          v-if="
            data.key.modelAccessMode === 'whitelist' &&
            data.key.modelAccessList?.length
          "
        >
          <div class="mb-3">
            <h2 class="text-sm font-semibold">Other Models</h2>
            <p class="text-xs text-muted-foreground">
              Extra models this key can call.
            </p>
          </div>
          <Card class="p-4">
            <div class="flex flex-wrap gap-2">
              <span
                v-for="model in data.key.modelAccessList"
                :key="model"
                class="group inline-flex h-7 max-w-full items-center gap-1 rounded-full border bg-muted/40 pl-3 pr-1.5 font-mono text-xs transition-colors hover:bg-muted"
              >
                <button
                  type="button"
                  class="flex min-w-0 items-center gap-1.5"
                  :title="`Copy ${model}`"
                  @click="copy(model)"
                >
                  <span class="truncate">{{ model }}</span>
                  <Copy class="size-2.5 shrink-0 text-muted-foreground" />
                </button>
                <button
                  type="button"
                  class="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  :title="`Try ${model}`"
                  :aria-label="`Try ${model}`"
                  @click="tryModel = model"
                >
                  <Play class="size-2.5" />
                </button>
              </span>
            </div>
          </Card>
        </section>

        <section>
          <div class="mb-3">
            <h2 class="text-sm font-semibold">Endpoints</h2>
            <p class="text-xs text-muted-foreground">
              Talk to the gateway through any of these APIs.
            </p>
          </div>
          <Card class="divide-y">
            <div
              v-for="endpoint in data.endpoints"
              :key="endpoint.id"
              class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
            >
              <Badge variant="secondary">{{ endpoint.method }}</Badge>
              <code class="min-w-0 break-all font-mono text-sm">{{
                endpoint.path
              }}</code>
              <span class="ml-auto flex items-center gap-2">
                <Badge v-if="endpoint.stream" variant="success"
                  >Streamable</Badge
                >
                <span class="hidden text-xs text-muted-foreground sm:inline">{{
                  endpoint.name
                }}</span>
              </span>
            </div>
          </Card>
        </section>

        <section>
          <div class="mb-3">
            <h2 class="text-sm font-semibold">Authentication</h2>
            <p class="text-xs text-muted-foreground">
              Send the key as a bearer token. The
              <code class="rounded bg-muted px-1 py-0.5">x-api-key</code>
              header and
              <code class="rounded bg-muted px-1 py-0.5">?key=</code> query
              parameter work too.
            </p>
          </div>
          <Card class="divide-y">
            <div
              v-for="row in credentialRows"
              :key="row.label"
              class="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[6rem_1fr_auto]"
            >
              <p class="text-xs font-medium text-muted-foreground">
                {{ row.label }}
              </p>
              <code
                class="col-span-3 row-start-2 min-w-0 break-all rounded-md bg-muted px-3 py-2 font-mono text-xs sm:col-span-1 sm:col-start-2 sm:row-start-1"
                >{{ row.value }}</code
              >
              <Button
                class="col-start-3 row-start-1"
                variant="outline"
                size="icon"
                :aria-label="`Copy ${row.label}`"
                :title="`Copy ${row.label}`"
                @click="copy(row.value)"
                ><Copy class="size-[11px]"
              /></Button>
            </div>
            <div class="px-4 py-3">
              <div class="mb-2 flex items-center justify-between gap-2">
                <p class="text-xs font-medium text-muted-foreground">
                  Playground
                </p>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Copy curl command"
                  title="Copy curl command"
                  @click="copy(curlDraft)"
                  ><Copy class="size-[11px]"
                /></Button>
              </div>
              <CurlPlayground
                :model-value="curlDraft"
                @update:model-value="onCurlInput"
              />
            </div>
          </Card>
        </section>

        <section v-if="visionModels.length">
          <Card class="p-4">
            <VisionPlayground
              :base-url="baseUrl"
              :api-key="apikey"
              :models="visionModels"
            />
          </Card>
        </section>

        <section v-if="imageGenModels.length">
          <Card class="p-4">
            <ImageGenPlayground
              :base-url="baseUrl"
              :api-key="apikey"
              :models="imageGenModels"
            />
          </Card>
        </section>

        <UsageTrendChart
          title="Activity, last 7 days"
          description="Tokens per day for this key, split by combo or model."
          :trend="data.activity"
          variant="line"
        />

        <section>
          <div class="mb-3 flex items-baseline justify-between gap-2">
            <div>
              <h2 class="text-sm font-semibold">Activity</h2>
              <p class="text-xs text-muted-foreground">
                Recent requests and client IPs for this key.
              </p>
            </div>
            <TabSwitcher v-model="logTab" :options="logTabOptions" />
          </div>

          <template v-if="logTab === 'logs'">
            <span class="mb-2 block text-xs text-muted-foreground"
              >Last 20</span
            >
            <Card v-if="logs.length" class="overflow-x-auto">
              <table class="w-full text-left text-xs">
                <thead>
                  <tr class="border-b bg-muted/60 text-muted-foreground">
                    <th class="px-3 py-[7.5px] font-semibold">Model</th>
                    <th class="px-3 py-[7.5px] font-semibold">Client IP</th>
                    <th class="px-3 py-[7.5px] text-right font-semibold">
                      Input / Output
                    </th>
                    <th class="px-3 py-[7.5px] text-right font-semibold">
                      Input cached
                    </th>
                    <th class="px-3 py-[7.5px] text-right font-semibold">
                      Latency
                    </th>
                    <th class="px-3 py-[7.5px] text-right font-semibold">t/s</th>
                    <th class="px-3 py-[7.5px] text-right font-semibold">When</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-border/60">
                  <tr
                    v-for="row in logs"
                    :key="row.timestamp"
                    class="hover:bg-muted/50"
                  >
                    <td class="px-3 py-[7.5px]">
                      <div class="group flex items-center gap-2">
                        <span
                          class="size-1.5 shrink-0 rounded-full"
                          :class="row.success ? 'bg-success' : 'bg-destructive'"
                        />
                        <button
                          type="button"
                          class="flex min-w-0 items-center gap-1.5 text-left"
                          :title="`Copy ${row.model}`"
                          @click="copy(row.model)"
                        >
                          <span
                            class="truncate font-mono group-hover:underline"
                            >{{ row.model }}</span
                          >
                          <Copy
                            class="size-2.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                          />
                        </button>
                        <Badge v-if="row.isCombo" variant="secondary"
                          >Combo</Badge
                        >
                        <button
                          v-if="row.isCombo"
                          type="button"
                          class="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 group-hover:opacity-100"
                          :title="`Try ${row.model}`"
                          :aria-label="`Try ${row.model}`"
                          @click="tryModel = row.model"
                        >
                          <Play class="size-2.5" />
                        </button>
                      </div>
                    </td>
                    <td class="px-3 py-[7.5px] font-mono text-muted-foreground">
                      {{ row.clientIp || "—" }}
                    </td>
                    <td class="px-3 py-[7.5px] text-right font-mono tabular-nums">
                      {{ number(actualInput(row)) }} /
                      {{ number(row.completionTokens) }}
                    </td>
                    <td class="px-3 py-[7.5px] text-right font-mono tabular-nums">
                      {{ row.cachedTokens ? number(row.cachedTokens) : "—" }}
                    </td>
                    <td class="px-3 py-[7.5px] text-right font-mono tabular-nums">
                      {{ latencyMs(row.latencyMs ?? 0) }}
                    </td>
                    <td class="px-3 py-[7.5px] text-right font-mono tabular-nums">
                      {{
                        row.tokensPerSecond
                          ? `${Math.round(row.tokensPerSecond)} t/s`
                          : "—"
                      }}
                    </td>
                    <td
                      class="px-3 py-[7.5px] text-right text-muted-foreground tabular-nums"
                      :title="relative(row.timestamp)"
                    >
                      {{ relative(row.timestamp) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </Card>
            <p v-else class="py-10 text-center text-sm text-muted-foreground">
              No requests recorded for this key yet.
            </p>
          </template>

          <template v-else>
            <span class="mb-2 block text-xs text-muted-foreground">
              {{ clientIpAgg.length }} unique
              {{ clientIpAgg.length === 1 ? "IP" : "IPs" }} · masked
            </span>
            <Card v-if="clientIpAgg.length" class="overflow-x-auto">
              <table class="w-full text-left text-xs">
                <thead>
                  <tr class="border-b bg-muted/60 text-muted-foreground">
                    <th class="px-3 py-[7.5px] font-semibold">Client IP</th>
                    <th class="px-3 py-[7.5px] text-right font-semibold">
                      Requests
                    </th>
                    <th class="px-3 py-[7.5px] text-right font-semibold">
                      Total tokens
                    </th>
                    <th class="px-3 py-[7.5px] text-right font-semibold">
                      Last seen
                    </th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-border/60">
                  <tr
                    v-for="row in clientIpAgg"
                    :key="row.ip"
                    class="hover:bg-muted/50"
                  >
                    <td class="px-3 py-[7.5px] font-mono">{{ row.ip }}</td>
                    <td
                      class="px-3 py-[7.5px] text-right font-mono tabular-nums"
                    >
                      {{ number(row.requests) }}
                    </td>
                    <td
                      class="px-3 py-[7.5px] text-right font-mono tabular-nums"
                      :title="`${number(row.promptTokens)} input / ${number(row.completionTokens)} output`"
                    >
                      {{ number(row.totalTokens) }}
                    </td>
                    <td
                      class="px-3 py-[7.5px] text-right text-muted-foreground tabular-nums"
                      :title="relative(row.lastUsed)"
                    >
                      {{ relative(row.lastUsed) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </Card>
            <p v-else class="py-10 text-center text-sm text-muted-foreground">
              No client IP data recorded for this key yet.
            </p>
          </template>
        </section>
      </template>
    </div>
    <TryModelModal
      :open="Boolean(tryModel)"
      :model="tryModel"
      :base-url="baseUrl"
      :api-key="apikey"
      @close="tryModel = ''"
    />
  </main>
</template>
