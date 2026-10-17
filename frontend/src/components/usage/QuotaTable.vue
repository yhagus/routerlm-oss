<script setup lang="ts">
// Port of v1 usage/components/ProviderLimits/QuotaTable.js
import { computed } from "vue";
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
  }>(),
  { compact: false, sortMode: "default", showSortLabel: false },
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
            v-for="quota in sortedQuotas"
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
  </div>
</template>
