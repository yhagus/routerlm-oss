<script setup lang="ts">
import { computed, ref } from "vue";
import { ArrowDownRight, ArrowUpRight, CornerDownRight } from "lucide-vue-next";
import { compact, currency, number } from "@/lib/format";
import Skeleton from "@/components/ui/skeleton.vue";
import TabSwitcher from "@/components/ui/tab-switcher.vue";
import type { UsageOverview } from "@/types/api";

type Metric = "requests" | "tokens";

const props = withDefaults(
  defineProps<{
    overview?: UsageOverview;
    loading?: boolean;
    periodLabel: string;
  }>(),
  { loading: false },
);

const metric = ref<Metric>("requests");
const metricOptions = [
  { value: "requests", label: "Requests" },
  { value: "tokens", label: "Tokens" },
] as const;
const hovered = ref<number | null>(null);

function percent(value: number | null | undefined) {
  return value == null ? "—" : `${(value * 100).toFixed(2)}%`;
}
// Change versus the window right before this one. Null when there is nothing to compare.
function change(
  now: number | null | undefined,
  before: number | null | undefined,
) {
  if (now == null || before == null || before === 0) return null;
  return ((now - before) / before) * 100;
}

const previous = computed(() => props.overview?.previous || null);
const cards = computed(() => {
  const totals = props.overview?.totals;
  return [
    {
      key: "requests",
      label: "Total requests",
      value: number(totals?.requests ?? 0),
      delta: change(totals?.requests, previous.value?.requests),
      // For cost, going up is the bad direction.
      invert: false,
    },
    {
      key: "tokens",
      label: "Tokens processed",
      value: compact(totals?.tokens ?? 0),
      delta: change(totals?.tokens, previous.value?.tokens),
      invert: false,
    },
    {
      key: "cost",
      label: "Estimated cost",
      value: currency(totals?.cost ?? 0),
      delta: change(totals?.cost, previous.value?.cost),
      invert: true,
    },
    {
      key: "success",
      label: "Success rate",
      value: percent(totals?.successRate),
      // Success rate is already a share, so the comparison is in points.
      delta:
        totals?.successRate != null && previous.value?.successRate != null
          ? (totals.successRate - previous.value.successRate) * 100
          : null,
      invert: false,
      points: true,
    },
  ];
});

const buckets = computed(() => props.overview?.buckets || []);
const labels = computed(() => props.overview?.labels || []);
const values = computed(() =>
  buckets.value.map((bucket) => ({
    ok:
      metric.value === "requests"
        ? bucket.requests - bucket.failed
        : bucket.tokens,
    failed: metric.value === "requests" ? bucket.failed : 0,
  })),
);
const max = computed(() =>
  Math.max(1, ...values.value.map((value) => value.ok + value.failed)),
);
const hasTraffic = computed(() => (props.overview?.totals.requests ?? 0) > 0);
const labelStep = computed(() =>
  Math.max(1, Math.ceil(labels.value.length / 7)),
);
const axis = computed(() =>
  [1, 0.66, 0.33, 0].map((ratio) => compact(max.value * ratio)),
);
const totalCost = computed(() => props.overview?.totals.cost ?? 0);
const providerCosts = computed(() => {
  const list = props.overview?.costByProvider || [];
  const costs = list.filter((item) => item.cost > 0);
  const shown = (costs.length ? costs : list).slice(0, 5);
  const base = costs.length
    ? totalCost.value
    : list.reduce((a, b) => a + b.requests, 0);
  return shown.map((item, index) => ({
    ...item,
    amount: costs.length ? item.cost : item.requests,
    share:
      base > 0 ? ((costs.length ? item.cost : item.requests) / base) * 100 : 0,
    color: `var(--chart-${(index % 6) + 1})`,
  }));
});
const byCost = computed(() =>
  (props.overview?.costByProvider || []).some((item) => item.cost > 0),
);
</script>

<template>
  <div class="space-y-6">
    <!-- Metrics strip -->
    <div
      v-if="loading && !overview"
      class="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border bg-border lg:grid-cols-4"
      role="status"
      aria-label="Loading overview"
    >
      <div v-for="item in 4" :key="item" class="space-y-2 bg-card p-5">
        <Skeleton class="h-3 w-24" />
        <Skeleton class="h-7 w-28" />
        <Skeleton class="h-2.5 w-32" />
      </div>
    </div>
    <div
      v-else
      class="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border bg-border lg:grid-cols-4"
      :class="loading ? 'opacity-60 transition-opacity' : ''"
    >
      <div v-for="card in cards" :key="card.key" class="min-w-0 bg-card p-5">
        <p class="truncate text-xs text-muted-foreground">{{ card.label }}</p>
        <p class="mt-2 truncate text-2xl font-semibold tabular-nums">
          {{ card.value }}
        </p>
        <p class="mt-1.5 flex min-w-0 items-center gap-1 text-[11px]">
          <template v-if="card.delta != null">
            <component
              :is="card.delta >= 0 ? ArrowUpRight : ArrowDownRight"
              class="size-3.5 shrink-0"
              :class="
                card.delta === 0
                  ? 'text-muted-foreground'
                  : card.delta > 0 !== card.invert
                    ? 'text-success'
                    : 'text-destructive'
              "
            />
            <span class="tabular-nums">{{
              `${Math.abs(card.delta).toFixed(1)}${card.points ? " pts" : "%"}`
            }}</span>
            <span class="truncate text-muted-foreground"
              >vs. previous period</span
            >
          </template>
          <span v-else class="truncate text-muted-foreground">{{
            overview?.previous ? "No earlier data to compare" : "All-time total"
          }}</span>
        </p>
      </div>
    </div>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
      <!-- Activity chart -->
      <section class="min-w-0 rounded-[10px] border bg-card">
        <div
          class="flex flex-col gap-3 px-5 pb-3 pt-4 sm:flex-row sm:items-start sm:justify-between"
        >
          <div class="min-w-0">
            <h2 class="text-base font-semibold">Request activity</h2>
            <p class="mt-0.5 text-xs text-muted-foreground">
              Your gateway traffic, {{ periodLabel }}.
            </p>
          </div>
          <TabSwitcher
            v-model="metric"
            :options="metricOptions"
            class="shrink-0"
          />
        </div>

        <div v-if="loading && !overview" class="px-5 pb-5">
          <Skeleton class="h-52 w-full" />
        </div>
        <div
          v-else-if="!hasTraffic"
          class="mx-5 mb-5 flex h-52 flex-col items-center justify-center rounded-lg border border-dashed text-center"
        >
          <p class="text-sm font-medium">No traffic in this period</p>
          <p class="mt-1 max-w-xs text-xs text-muted-foreground">
            Pick a longer period or send requests through the gateway.
          </p>
        </div>
        <div v-else class="px-5 pb-4">
          <div
            class="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground"
          >
            <span class="flex items-center gap-1.5"
              ><i class="inline-block size-2 rounded-sm bg-primary" />{{
                metric === "requests"
                  ? "Successful requests"
                  : "Tokens processed"
              }}</span
            >
            <span v-if="metric === 'requests'" class="flex items-center gap-1.5"
              ><i
                class="inline-block size-2 rounded-sm"
                style="background: var(--apricot, #e5ab7e)"
              />Failed requests</span
            >
          </div>
          <div class="flex gap-2">
            <div
              class="flex h-48 w-9 shrink-0 flex-col justify-between pb-px text-right font-mono text-[10px] text-muted-foreground"
              aria-hidden="true"
            >
              <span v-for="(tick, index) in axis" :key="index">{{ tick }}</span>
            </div>
            <div class="relative min-w-0 flex-1">
              <div
                class="pointer-events-none absolute inset-0 flex flex-col justify-between"
                aria-hidden="true"
              >
                <div
                  v-for="line in 4"
                  :key="line"
                  class="border-t border-dashed border-border"
                />
              </div>
              <div
                class="relative flex h-48 items-end gap-px sm:gap-0.5"
                role="img"
                :aria-label="`Request activity, ${number(overview?.totals.requests)} requests`"
                @mouseleave="hovered = null"
              >
                <div
                  v-for="(value, index) in values"
                  :key="index"
                  class="flex h-full min-w-0 flex-1 flex-col justify-end"
                  @mouseenter="hovered = index"
                >
                  <div
                    class="flex flex-col overflow-hidden rounded-t-[3px] transition-opacity"
                    :class="
                      hovered !== null && hovered !== index ? 'opacity-50' : ''
                    "
                    :style="{
                      height: `${Math.max(value.ok + value.failed ? 2 : 0, ((value.ok + value.failed) / max) * 100)}%`,
                    }"
                  >
                    <div
                      v-if="value.failed"
                      class="min-h-px"
                      :style="{
                        flex: value.failed,
                        background: 'var(--apricot, #e5ab7e)',
                      }"
                    />
                    <div
                      class="bg-primary"
                      :style="{ flex: value.ok || 0.0001 }"
                    />
                  </div>
                </div>
              </div>
              <div
                v-if="hovered !== null && buckets[hovered]"
                class="pointer-events-none absolute top-0 z-10 w-44 rounded-lg border bg-popover p-2.5 text-xs shadow-lg"
                :class="hovered > buckets.length / 2 ? 'right-1' : 'left-1'"
              >
                <p class="mb-1 font-medium">{{ labels[hovered] }}</p>
                <p class="flex justify-between gap-2">
                  <span class="text-muted-foreground">Requests</span
                  ><span class="font-mono tabular-nums">{{
                    number(buckets[hovered].requests)
                  }}</span>
                </p>
                <p class="flex justify-between gap-2">
                  <span class="text-muted-foreground">Failed</span
                  ><span class="font-mono tabular-nums">{{
                    number(buckets[hovered].failed)
                  }}</span>
                </p>
                <p class="flex justify-between gap-2">
                  <span class="text-muted-foreground">Tokens</span
                  ><span class="font-mono tabular-nums">{{
                    compact(buckets[hovered].tokens)
                  }}</span>
                </p>
              </div>
              <div
                class="mt-1.5 flex gap-px text-[10px] text-muted-foreground sm:gap-0.5"
              >
                <span
                  v-for="(label, index) in labels"
                  :key="index"
                  class="min-w-0 flex-1 whitespace-nowrap text-center"
                >
                  <template v-if="index % labelStep === 0">{{
                    label
                  }}</template>
                </span>
              </div>
            </div>
          </div>
        </div>

        <div
          class="flex flex-wrap justify-between gap-2 border-t px-5 py-3 text-[11px] text-muted-foreground"
        >
          <span class="flex min-w-0 items-center gap-1.5">
            <CornerDownRight class="size-3.5 shrink-0" />
            <template v-if="overview?.peak"
              >Peak traffic at {{ overview.peak.label }} ({{
                number(overview.peak.requests)
              }})</template
            >
            <template v-else>No peak yet</template>
          </span>
          <span class="tabular-nums"
            >{{ number(overview?.totals.requests ?? 0) }} requests in this
            period</span
          >
        </div>
      </section>

      <!-- Cost by provider -->
      <section class="min-w-0 rounded-[10px] border bg-card">
        <div class="flex items-start justify-between gap-3 px-5 pb-2 pt-4">
          <div class="min-w-0">
            <h2 class="text-base font-semibold">
              {{ byCost ? "Cost by provider" : "Requests by provider" }}
            </h2>
            <p class="mt-0.5 text-xs text-muted-foreground">
              {{ periodLabel }}
            </p>
          </div>
        </div>
        <div v-if="loading && !overview" class="space-y-5 px-5 pb-5 pt-3">
          <div v-for="row in 4" :key="row" class="space-y-2">
            <Skeleton class="h-3.5 w-full" />
            <Skeleton class="h-1.5 w-full" />
          </div>
        </div>
        <p
          v-else-if="!providerCosts.length"
          class="px-5 pb-6 pt-4 text-sm text-muted-foreground"
        >
          No provider activity in this period.
        </p>
        <div v-else class="space-y-5 px-5 pb-4 pt-3">
          <div v-for="item in providerCosts" :key="item.id">
            <div class="flex items-baseline justify-between gap-3 text-xs">
              <span class="min-w-0 truncate" :title="item.name">{{
                item.name
              }}</span>
              <strong class="shrink-0 font-mono tabular-nums">{{
                byCost ? currency(item.amount) : number(item.amount)
              }}</strong>
            </div>
            <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                class="h-full rounded-full"
                :style="{
                  width: `${Math.max(2, item.share)}%`,
                  background: item.color,
                }"
              />
            </div>
          </div>
        </div>
        <div
          v-if="byCost && providerCosts.length"
          class="flex justify-between border-t px-5 py-3 text-xs"
        >
          <span class="text-muted-foreground">Total estimate</span>
          <strong class="tabular-nums">{{ currency(totalCost) }}</strong>
        </div>
      </section>
    </div>
  </div>
</template>
