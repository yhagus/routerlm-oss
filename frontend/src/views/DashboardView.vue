<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import {
  Activity,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Gauge,
  KeyRound,
  Plus,
  RefreshCw,
  Waypoints,
} from "lucide-vue-next";
import { api } from "@/lib/api";
import { currency, date, displayName, number } from "@/lib/format";
import PageHeader from "@/components/app/PageHeader.vue";
import Card from "@/components/ui/card.vue";
import Button from "@/components/ui/button.vue";
import Badge from "@/components/ui/badge.vue";
import type { Combo } from "@/types/api";

type ActivityMode = "requests" | "tokens" | "cost";
type ActivityPeriod = "1h" | "today" | "7d" | "30d";
type DashboardData = {
  buckets?: Array<{
    label: string;
    requests?: number;
    tokens?: number;
    cost?: number;
  }>;
  totals?: { requests?: number; tokens?: number; cost?: number };
  topProvider?: { name?: string; requests?: number } | null;
  topModel?: { name?: string; requests?: number } | null;
};
type LiveRequest = {
  model?: string;
  provider?: string;
  account?: string;
  count?: number;
  timestamp?: string;
  promptTokens?: number;
  completionTokens?: number;
  comboName?: string | null;
  clientIp?: string | null;
  apiKeyName?: string | null;
  status?: string;
};
type LiveStats = {
  activeRequests: LiveRequest[];
  recentRequests: LiveRequest[];
};

const period = ref<ActivityPeriod>("7d");
const mode = ref<ActivityMode>("requests");
// Traffic stats refresh frequently so the dashboard always shows live data.
// Provider/combo config changes less often. The SSE stream pushes pending
// updates instantly; these intervals are the polling backstop for the rest.
const providers = useQuery({
  queryKey: ["providers"],
  queryFn: api.providers.list,
  refetchInterval: 30_000,
});
const today = useQuery({
  queryKey: ["usage", "dashboard", "today"],
  queryFn: () => api.usage.dashboard("today"),
  refetchInterval: 10_000,
});
const activity = useQuery({
  queryKey: ["usage", "dashboard", period],
  queryFn: () => api.usage.dashboard(period.value),
  refetchInterval: 10_000,
});
const history = useQuery({
  queryKey: ["usage", "history", 6],
  queryFn: () => api.usage.history(6),
  refetchInterval: 10_000,
});
const combos = useQuery({
  queryKey: ["combos"],
  queryFn: api.combos.list,
  refetchInterval: 30_000,
});
const live = ref<LiveStats>({ activeRequests: [], recentRequests: [] });
let liveStream: EventSource | undefined;
let liveWatchdog: ReturnType<typeof setInterval> | undefined;

const connections = computed(() => providers.data.value || []);
const activeConnections = computed(() =>
  connections.value.filter((connection) => connection.isActive !== false),
);
const attentionItems = computed(() =>
  activeConnections.value.filter((connection) => {
    const data =
      connection.data && typeof connection.data === "object"
        ? connection.data
        : {};
    return Boolean(
      data.lastError ||
      data.rateLimitedUntil ||
      ["error", "expired", "unavailable", "failed"].includes(
        String(data.testStatus || ""),
      ),
    );
  }),
);
const healthyConnections = computed(
  () => activeConnections.value.length - attentionItems.value.length,
);
const todayData = computed(() => today.data.value as DashboardData | undefined);
const activityData = computed(
  () => activity.data.value as DashboardData | undefined,
);
const totals = computed(
  () => activityData.value?.totals || { requests: 0, tokens: 0, cost: 0 },
);
const chartMax = computed(() =>
  Math.max(
    1,
    ...(activityData.value?.buckets || []).map((bucket) =>
      Number(bucket[mode.value] || 0),
    ),
  ),
);
const activeTraffic = computed(() =>
  live.value.activeRequests.reduce(
    (total, request) => total + Number(request.count || 0),
    0,
  ),
);
const recentTraffic = computed<LiveRequest[]>(() =>
  live.value.recentRequests.length
    ? live.value.recentRequests
    : (history.data.value?.items || []).map((record) => ({
        model: record.model || undefined,
        provider: record.provider || undefined,
        timestamp: record.timestamp,
        promptTokens: Number(record.prompt_tokens || 0),
        completionTokens: Number(record.completion_tokens || 0),
        status: record.status || undefined,
      })),
);

function providerName(provider: string | null | undefined) {
  return provider ? displayName(provider) : "Unknown provider";
}

function attentionMessage(connection: (typeof connections.value)[number]) {
  const data =
    connection.data && typeof connection.data === "object"
      ? connection.data
      : {};
  if (data.rateLimitedUntil)
    return `Rate limited until ${date(String(data.rateLimitedUntil))}`;
  return String(
    data.lastError || data.testStatus || "Connection needs attention",
  );
}

function modelCount(combo: Combo) {
  const models =
    typeof combo.models === "string" ? combo.models : combo.models || [];
  return Array.isArray(models) ? models.length : 0;
}

function formatActivityValue(value: number) {
  return mode.value === "cost" ? currency(value) : number(value);
}

function relativeTime(value: string | null | undefined) {
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

function refresh() {
  void Promise.all([
    providers.refetch(),
    today.refetch(),
    activity.refetch(),
    history.refetch(),
    combos.refetch(),
  ]);
}

function connectLiveStream() {
  liveStream = new EventSource("/api/usage/stream?period=today");
  liveStream.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data) as Partial<LiveStats>;
      live.value = {
        activeRequests: Array.isArray(payload.activeRequests)
          ? payload.activeRequests
          : [],
        recentRequests: Array.isArray(payload.recentRequests)
          ? payload.recentRequests
          : [],
      };
    } catch {
      // Keep the last complete usage snapshot.
    }
  };
}

onMounted(() => {
  connectLiveStream();
  // Watchdog: EventSource auto-reconnects on transient errors, but a closed
  // connection (fatal error, server restart, sleep wake) stays dead. Poll
  // every 5s and reopen so the dashboard never freezes on stale data.
  liveWatchdog = setInterval(() => {
    if (!liveStream || liveStream.readyState === EventSource.CLOSED)
      connectLiveStream();
  }, 5_000);
});

onUnmounted(() => {
  liveStream?.close();
  if (liveWatchdog) clearInterval(liveWatchdog);
});
</script>

<template>
  <div class="theme-v2 space-y-6">
    <PageHeader
      title="Router control room"
      description="Watch live traffic, provider readiness, and the routes that need your attention."
    >
      <template #actions>
        <Button
          variant="outline"
          size="sm"
          :disabled="providers.isFetching.value"
          @click="refresh"
          ><RefreshCw
            :class="['size-4', providers.isFetching.value && 'animate-spin']"
          />Refresh</Button
        >
      </template>
    </PageHeader>

    <Card class="relative overflow-hidden border-primary/15 px-5 py-6 sm:px-7">
      <div
        class="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-primary/10 blur-3xl"
      />
      <div
        class="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"
      >
        <div>
          <div
            class="mb-3 flex items-center gap-2 text-xs font-medium text-success"
          >
            <span
              class="size-2 rounded-full bg-current shadow-[0_0_12px_currentColor]"
            />Gateway online
          </div>
          <h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">
            Router control room
          </h1>
          <p class="mt-2 max-w-xl text-sm text-muted-foreground">
            A live view of gateway health, traffic, and provider capacity.
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <RouterLink
            to="/dashboard/endpoint"
            class="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
            ><KeyRound class="size-4" />Endpoint &amp; Key</RouterLink
          >
          <RouterLink
            to="/dashboard/providers/new"
            class="inline-flex h-9 items-center gap-2 rounded-md border px-4 text-sm font-semibold hover:bg-accent"
            ><Plus class="size-4" />Add provider</RouterLink
          >
        </div>
      </div>
    </Card>

    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card class="p-5"
        ><div class="flex items-center justify-between">
          <p class="text-xs font-medium text-muted-foreground">
            Gateway health
          </p>
          <CheckCircle2 class="size-4 text-success" />
        </div>
        <p class="mt-3 text-2xl font-semibold">
          {{
            providers.isPending.value
              ? "..."
              : attentionItems.length
                ? "Degraded"
                : "Ready"
          }}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          {{
            attentionItems.length
              ? `${attentionItems.length} connection(s) need attention`
              : "All active connections look ready"
          }}
        </p></Card
      >
      <Card class="p-5"
        ><div class="flex items-center justify-between">
          <p class="text-xs font-medium text-muted-foreground">
            Active traffic
          </p>
          <Activity class="size-4 text-primary" />
        </div>
        <p class="mt-3 text-2xl font-semibold tabular-nums">
          {{ number(activeTraffic) }}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          {{
            live.activeRequests.length
              ? `${live.activeRequests.length} model route(s) in flight`
              : "No requests in flight"
          }}
        </p></Card
      >
      <Card class="p-5"
        ><div class="flex items-center justify-between">
          <p class="text-xs font-medium text-muted-foreground">
            Provider capacity
          </p>
          <Waypoints class="size-4 text-muted-foreground" />
        </div>
        <p class="mt-3 text-2xl font-semibold tabular-nums">
          {{ healthyConnections }}/{{ activeConnections.length }}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          {{ activeConnections.length }} active account(s) configured
        </p></Card
      >
      <Card class="p-5"
        ><div class="flex items-center justify-between">
          <p class="text-xs font-medium text-muted-foreground">Today</p>
          <Gauge class="size-4 text-primary" />
        </div>
        <p class="mt-3 text-2xl font-semibold tabular-nums">
          {{ number(todayData?.totals?.requests) }}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          {{ number(todayData?.totals?.tokens) }} tokens ·
          {{ currency(todayData?.totals?.cost) }}
        </p></Card
      >
    </div>

    <Card class="overflow-hidden p-5">
      <div
        class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"
      >
        <div>
          <div class="flex items-center gap-2">
            <Activity class="size-4 text-primary" />
            <h2 class="text-sm font-semibold">Request activity</h2>
          </div>
          <p class="mt-1 text-xs text-muted-foreground">
            Completed traffic across your gateway
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <div class="flex rounded-md border p-1">
            <button
              v-for="item in [
                ['1h', '1H'],
                ['today', 'Today'],
                ['7d', '7D'],
                ['30d', '30D'],
              ] as const"
              :key="item[0]"
              class="rounded px-3 py-1.5 text-xs font-semibold"
              :class="
                period === item[0]
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground'
              "
              @click="period = item[0]"
            >
              {{ item[1] }}
            </button>
          </div>
          <div class="flex rounded-md border p-1">
            <button
              v-for="item in [
                ['requests', 'Requests'],
                ['tokens', 'Tokens'],
                ['cost', 'Cost'],
              ] as const"
              :key="item[0]"
              class="rounded px-3 py-1.5 text-xs font-semibold"
              :class="
                mode === item[0]
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground'
              "
              @click="mode = item[0]"
            >
              {{ item[1] }}
            </button>
          </div>
        </div>
      </div>
      <div
        v-if="activity.isPending.value"
        class="flex h-56 items-center justify-center text-sm text-muted-foreground"
      >
        Loading activity...
      </div>
      <div
        v-else-if="
          !(activityData?.buckets || []).some(
            (bucket) => Number(bucket[mode] || 0) > 0,
          )
        "
        class="mt-5 flex h-56 flex-col items-center justify-center rounded-xl border border-dashed text-center"
      >
        <Activity class="size-7 text-muted-foreground" />
        <p class="mt-2 text-sm font-medium">No completed requests yet</p>
        <p class="mt-1 text-xs text-muted-foreground">
          Send traffic through the gateway and your activity trend will appear
          here.
        </p>
      </div>
      <div
        v-else
        class="mt-5 flex h-56 items-end gap-1 border-b px-1 pb-0 sm:gap-2"
      >
        <div
          v-for="bucket in activityData?.buckets"
          :key="bucket.label"
          class="group flex h-full flex-1 flex-col justify-end"
        >
          <div
            class="relative min-h-0 rounded-t bg-primary/75 transition-all group-hover:bg-primary"
            :style="{
              height: `${Math.max(3, (Number(bucket[mode] || 0) / chartMax) * 100)}%`,
            }"
          >
            <span
              class="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-[10px] text-background group-hover:block"
              >{{ formatActivityValue(Number(bucket[mode] || 0)) }}</span
            >
          </div>
          <span
            class="mt-2 truncate text-center text-[10px] text-muted-foreground"
            >{{ bucket.label }}</span
          >
        </div>
      </div>
      <div class="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div class="rounded-lg border bg-muted/30 p-3">
          <p
            class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Completed
          </p>
          <p class="mt-1 text-xl font-semibold tabular-nums">
            {{ number(totals.requests) }}
          </p>
          <p class="mt-1 text-[11px] text-muted-foreground">{{ period }}</p>
        </div>
        <div class="rounded-lg border bg-muted/30 p-3">
          <p
            class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Tokens
          </p>
          <p class="mt-1 text-xl font-semibold tabular-nums text-primary">
            {{ number(totals.tokens) }}
          </p>
          <p class="mt-1 text-[11px] text-muted-foreground">Input + output</p>
        </div>
        <div class="rounded-lg border bg-muted/30 p-3">
          <p
            class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Top provider
          </p>
          <p class="mt-1 truncate text-sm font-semibold">
            {{
              activityData?.topProvider
                ? providerName(activityData.topProvider.name)
                : "None yet"
            }}
          </p>
          <p class="mt-1 text-[11px] text-muted-foreground">
            {{ number(activityData?.topProvider?.requests) }} requests
          </p>
        </div>
        <div class="rounded-lg border bg-muted/30 p-3">
          <p
            class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Est. cost
          </p>
          <p class="mt-1 text-xl font-semibold tabular-nums text-warning">
            {{ currency(totals.cost) }}
          </p>
          <p class="mt-1 truncate text-[11px] text-muted-foreground">
            {{ activityData?.topModel?.name || "No model activity" }}
          </p>
        </div>
      </div>
    </Card>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
      <Card class="p-5"
        ><div class="flex items-start justify-between">
          <div>
            <h2 class="text-sm font-semibold">Action required</h2>
            <p class="mt-1 text-xs text-muted-foreground">
              Connection issues that can affect routing
            </p>
          </div>
          <RouterLink
            to="/dashboard/providers"
            class="text-xs font-medium text-primary"
            >Open providers</RouterLink
          >
        </div>
        <div class="mt-4 divide-y">
          <div
            v-if="providers.isPending.value"
            class="py-6 text-sm text-muted-foreground"
          >
            Checking provider health...
          </div>
          <div
            v-else-if="!attentionItems.length"
            class="flex items-center gap-3 py-5 text-sm text-muted-foreground"
          >
            <CheckCircle2 class="size-5 text-success" />No active connection
            needs attention.
          </div>
          <RouterLink
            v-for="connection in attentionItems.slice(0, 4)"
            :key="connection.id"
            to="/dashboard/providers"
            class="flex items-center gap-3 py-3 hover:text-primary"
            ><CircleAlert
              class="size-8 rounded-lg bg-warning/10 p-2 text-warning" /><span
              class="min-w-0 flex-1"
              ><span class="block truncate text-sm font-medium">{{
                connection.name || providerName(connection.provider)
              }}</span
              ><span class="block truncate text-xs text-muted-foreground"
                >{{ providerName(connection.provider) }} ·
                {{ attentionMessage(connection) }}</span
              ></span
            ><ChevronRight class="size-4 text-muted-foreground"
          /></RouterLink></div
      ></Card>
      <Card class="p-5"
        ><div class="flex items-start justify-between">
          <div>
            <h2 class="text-sm font-semibold">Most used combo</h2>
            <p class="mt-1 text-xs text-muted-foreground">
              Configured fallback routes
            </p>
          </div>
          <RouterLink
            to="/dashboard/combos"
            class="text-xs font-medium text-primary"
            >Manage combos</RouterLink
          >
        </div>
        <div
          v-if="!combos.data.value?.length"
          class="mt-4 py-5 text-sm text-muted-foreground"
        >
          No combo routes configured.
        </div>
        <RouterLink
          v-else
          v-for="combo in combos.data.value.slice(0, 1)"
          :key="combo.id"
          to="/dashboard/combos"
          class="mt-4 block border-t pt-4"
          ><div class="flex items-center justify-between gap-3">
            <span class="truncate text-sm font-medium">{{ combo.name }}</span
            ><Badge variant="default">{{ modelCount(combo) }} models</Badge>
          </div>
          <p class="mt-1 text-xs text-muted-foreground">
            Usage attribution is not available from the v2 usage API.
          </p></RouterLink
        ></Card
      >
    </div>

    <Card class="overflow-hidden p-5"
      ><div class="flex items-start justify-between">
        <div>
          <h2 class="text-sm font-semibold">Live traffic</h2>
          <p class="mt-1 text-xs text-muted-foreground">
            Latest completed calls and active model routes
          </p>
        </div>
        <RouterLink
          to="/dashboard/usage?tab=details"
          class="text-xs font-medium text-primary"
          >Open requests</RouterLink
        >
      </div>
      <div
        v-if="live.activeRequests.length"
        class="mt-4 flex flex-wrap gap-2 rounded-lg border border-primary/15 bg-primary/[0.04] p-3"
      >
        <span
          v-for="request in live.activeRequests.slice(0, 4)"
          :key="`${request.account}-${request.model}`"
          class="rounded bg-background px-2 py-1 font-mono text-xs"
          >{{ request.count }}x {{ request.model }}</span
        >
      </div>
      <div
        v-if="history.isPending.value && !recentTraffic.length"
        class="py-6 text-sm text-muted-foreground"
      >
        Loading traffic...
      </div>
      <div
        v-else-if="!recentTraffic.length"
        class="py-6 text-sm text-muted-foreground"
      >
        No successful token usage has been recorded yet.
      </div>
      <div v-else class="mt-4 overflow-x-auto">
        <table class="w-full min-w-[700px] text-left text-xs">
          <thead
            class="border-b text-[11px] uppercase tracking-wider text-muted-foreground"
          >
            <tr>
              <th class="pb-2 font-semibold">Route</th>
              <th class="pb-2 font-semibold">Provider</th>
              <th class="pb-2 font-semibold">Client</th>
              <th class="pb-2 text-right font-semibold">Tokens</th>
              <th class="pb-2 text-right font-semibold">When</th>
            </tr>
          </thead>
          <tbody class="divide-y">
            <tr
              v-for="(record, index) in recentTraffic.slice(0, 6)"
              :key="`${record.timestamp}-${record.model}-${index}`"
            >
              <td class="max-w-[300px] py-3 font-mono text-foreground">
                <span class="block truncate">{{
                  record.model || "Unknown model"
                }}</span
                ><span
                  v-if="record.comboName"
                  class="mt-1 block truncate font-sans text-[11px] text-primary"
                  >Combo: {{ record.comboName }}</span
                >
              </td>
              <td class="py-3 text-muted-foreground">
                {{ providerName(record.provider) }}
              </td>
              <td class="py-3 text-muted-foreground">
                {{ record.apiKeyName || record.clientIp || "Local / unknown" }}
              </td>
              <td class="py-3 text-right font-mono tabular-nums">
                {{
                  number(
                    Number(record.promptTokens) +
                      Number(record.completionTokens),
                  )
                }}
              </td>
              <td class="py-3 text-right text-muted-foreground">
                {{ relativeTime(record.timestamp) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div></Card
    >
  </div>
</template>
