<script setup lang="ts">
// Port of v1 usage/components/ProviderLimits/QuotaTable.js
import { computed, ref, watch } from "vue";
import {
  formatBalance,
  formatResetTime,
  getRemainingPercentage,
  type NormalizedQuotaRow,
} from "@/lib/quota";

const props = withDefaults(
  defineProps<{
    quotas: NormalizedQuotaRow[];
    compact?: boolean;
    sortMode?: string;
    showSortLabel?: boolean;
    // Show at most this many rows at once. CodeBuddy CLI connections can carry
    // 30+ bonus packs. 0 shows everything.
    maxVisible?: number;
    // How the overflow is handled: a "Show all" toggle (default) or left/right
    // pagination. 0 maxVisible disables both.
    paginate?: boolean;
  }>(),
  {
    compact: false,
    sortMode: "default",
    showSortLabel: false,
    maxVisible: 5,
    paginate: false,
  },
);

const normalizedQuotas = computed(() =>
  props.quotas.map((quota, index) => ({
    ...quota,
    index,
    remaining:
      quota.balance !== undefined
        ? quota.balance > 0
          ? 100
          : 0
        : getRemainingPercentage(quota),
  })),
);
const sortedQuotas = computed(() => {
  if (props.sortMode === "remaining-asc") {
    return [...normalizedQuotas.value].sort(
      (a, b) => a.remaining - b.remaining || a.name.localeCompare(b.name),
    );
  }
  if (props.sortMode === "remaining-desc") {
    return [...normalizedQuotas.value].sort(
      (a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name),
    );
  }
  return normalizedQuotas.value;
});

const overflows = computed(
  () => props.maxVisible > 0 && sortedQuotas.value.length > props.maxVisible,
);

// Toggle mode ("Show all") — used on the provider detail cards.
const expanded = ref(false);
const canCollapse = computed(() => overflows.value && !props.paginate);
const hiddenCount = computed(
  () => sortedQuotas.value.length - props.maxVisible,
);

// Pagination mode (left/right) — used on the Quota Tracker, where one account
// can hold many quota rows.
const canPaginate = computed(() => overflows.value && props.paginate);
const page = ref(0);
const pageCount = computed(() =>
  props.maxVisible > 0
    ? Math.max(1, Math.ceil(sortedQuotas.value.length / props.maxVisible))
    : 1,
);
// Keep the page in range when the quota list shrinks (e.g. after a refresh).
watch(pageCount, (count) => {
  if (page.value > count - 1) page.value = count - 1;
});

const visibleQuotas = computed(() => {
  if (canPaginate.value) {
    const start = page.value * props.maxVisible;
    return sortedQuotas.value.slice(start, start + props.maxVisible);
  }
  if (canCollapse.value && !expanded.value) {
    return sortedQuotas.value.slice(0, props.maxVisible);
  }
  return sortedQuotas.value;
});
const pageStart = computed(() => page.value * props.maxVisible + 1);
const pageEnd = computed(() =>
  Math.min((page.value + 1) * props.maxVisible, sortedQuotas.value.length),
);

function formatResetTimeDisplay(resetTime: string | null) {
  if (!resetTime) return null;
  try {
    const date = new Date(resetTime);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    let dayStr = "";
    if (date >= today && date < tomorrow) dayStr = "Today";
    else if (
      date >= tomorrow &&
      date < new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000)
    )
      dayStr = "Tomorrow";
    else
      dayStr = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    const timeStr = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return `${dayStr}, ${timeStr}`;
  } catch {
    return null;
  }
}

function colors(remaining: number) {
  if (remaining > 70)
    return {
      text: "text-green-600 dark:text-green-400",
      bg: "bg-green-500",
      bgLight: "bg-green-500/10",
      emoji: "🟢",
    };
  if (remaining >= 30)
    return {
      text: "text-yellow-600 dark:text-yellow-400",
      bg: "bg-yellow-500",
      bgLight: "bg-yellow-500/10",
      emoji: "🟡",
    };
  return {
    text: "text-red-600 dark:text-red-400",
    bg: "bg-red-500",
    bgLight: "bg-red-500/10",
    emoji: "🔴",
  };
}
</script>

<template>
  <div v-if="quotas.length" :class="compact ? 'space-y-1' : 'space-y-2'">
    <div v-if="!compact" class="flex items-center justify-between gap-2">
      <div class="text-[10px] text-muted-foreground">
        {{ sortedQuotas.length }} quota{{ sortedQuotas.length > 1 ? "s" : "" }}
      </div>
      <div
        v-if="showSortLabel"
        class="rounded-md border border-border bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground"
      >
        Sorted by account remaining
      </div>
    </div>

    <div class="overflow-x-auto">
      <table class="w-full table-fixed text-left">
        <tbody>
          <tr
            v-for="quota in visibleQuotas"
            :key="`${quota.name}-${quota.index}`"
            class="border-b border-border/60 transition-colors hover:bg-muted/50"
          >
            <td class="w-[30%] py-0.5 px-1">
              <div class="flex min-w-0 items-center gap-1">
                <span v-if="!compact" class="shrink-0 text-[10px]">{{
                  colors(quota.remaining).emoji
                }}</span>
                <span
                  class="truncate text-[10px] font-medium"
                  :class="compact ? 'text-[10px]' : 'text-sm'"
                  >{{ quota.name }}</span
                >
              </div>
            </td>
            <td class="w-[45%] py-0.5 px-1">
              <div
                v-if="quota.balance !== undefined"
                :class="compact ? 'text-xs' : 'text-sm'"
              >
                <span
                  class="font-medium"
                  :class="colors(quota.remaining).text"
                  >{{ formatBalance(quota.balance) }}</span
                ><span class="text-muted-foreground">{{
                  quota.unit ? ` ${quota.unit}` : ""
                }}</span>
              </div>
              <div v-else :class="compact ? 'space-y-0.5' : 'space-y-1.5'">
                <div
                  :class="[
                    compact ? 'h-[3px]' : 'h-1.5',
                    colors(quota.remaining).bgLight,
                    quota.remaining === 0
                      ? 'border-border'
                      : 'border-transparent',
                  ]"
                  class="overflow-hidden rounded-full border"
                >
                  <div
                    :class="colors(quota.remaining).bg"
                    class="h-full transition-all duration-300"
                    :style="{ width: `${Math.min(quota.remaining, 100)}%` }"
                  />
                </div>
                <div
                  class="flex items-center justify-between"
                  :class="compact ? 'text-[9px]' : 'text-xs'"
                >
                  <span class="text-muted-foreground"
                    >{{ quota.used.toLocaleString() }} /
                    {{
                      quota.total > 0 ? quota.total.toLocaleString() : "∞"
                    }}</span
                  >
                  <span
                    class="font-medium"
                    :class="colors(quota.remaining).text"
                    >{{ quota.remaining }}%</span
                  >
                </div>
              </div>
            </td>
            <td class="w-[21%] py-0.5 px-1">
              <template v-if="quota.balance === undefined">
                <template
                  v-if="
                    formatResetTime(quota.resetAt) !== '-' ||
                    formatResetTimeDisplay(quota.resetAt)
                  "
                >
                  <div
                    class="truncate text-[10px] font-medium"
                    :title="formatResetTimeDisplay(quota.resetAt) || ''"
                  >
                    {{
                      formatResetTime(quota.resetAt) !== "-"
                        ? formatResetTime(quota.resetAt)
                        : formatResetTimeDisplay(quota.resetAt)
                    }}
                  </div>
                </template>
                <div v-else class="text-[10px] italic text-muted-foreground">
                  N/A
                </div>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <button
      v-if="canCollapse"
      type="button"
      class="flex w-full items-center justify-center gap-1 rounded-md py-1 font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      :class="compact ? 'text-[10px]' : 'text-xs'"
      @click.stop="expanded = !expanded"
    >
      <span class="material-symbols-outlined text-[14px]">{{
        expanded ? "expand_less" : "expand_more"
      }}</span>
      {{ expanded ? "Show less" : `Show all (${hiddenCount} more)` }}
    </button>

    <div
      v-if="canPaginate"
      class="flex items-center justify-between gap-2 pt-0.5 font-medium text-muted-foreground"
      :class="compact ? 'text-[10px]' : 'text-xs'"
    >
      <button
        type="button"
        class="grid size-5 place-items-center rounded-md transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
        :disabled="page <= 0"
        aria-label="Previous quotas"
        @click.stop="page = Math.max(0, page - 1)"
      >
        <span class="material-symbols-outlined text-[14px]">chevron_left</span>
      </button>
      <span class="tabular-nums"
        >{{ pageStart }}–{{ pageEnd }} of {{ sortedQuotas.length }}</span
      >
      <button
        type="button"
        class="grid size-5 place-items-center rounded-md transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
        :disabled="page >= pageCount - 1"
        aria-label="Next quotas"
        @click.stop="page = Math.min(pageCount - 1, page + 1)"
      >
        <span class="material-symbols-outlined text-[14px]">chevron_right</span>
      </button>
    </div>
  </div>
</template>
