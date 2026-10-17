<script setup lang="ts">
// Port of v1 free-tracker/page.js
import { computed, onMounted, onUnmounted, ref } from "vue";
import { api } from "@/lib/api";
import type { FreeTrackerModel, FreeTrackerSource } from "@/types/api";
import Card from "@/components/ui/card.vue";
import Skeleton from "@/components/ui/skeleton.vue";
import Toggle from "@/components/ui/toggle.vue";

const REFRESH_INTERVAL_MS = 60_000;
const AUTO_REFRESH_STORAGE_KEY = "freeTrackerAutoRefresh";

const sources = ref<FreeTrackerSource[]>([]);
const loading = ref(true);
const refreshing = ref(false);
const error = ref<string | null>(null);
const fetchedAt = ref<string | null>(null);
const autoRefresh = ref(true);
const hasHydratedAutoRefresh = ref(false);
const countdown = ref(60);
const togglingId = ref<string | null>(null);

let intervalId: number | undefined;
let countdownId: number | undefined;

function colors(remainingPercentage: number) {
  if (remainingPercentage > 70)
    return {
      text: "text-green-600 dark:text-green-400",
      bg: "bg-green-500",
      bgLight: "bg-green-500/10",
      emoji: "🟢",
    };
  if (remainingPercentage >= 30)
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

function formatFetchedAt(iso: string | null) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return null;
  }
}

function shortModelLabel(modelId: string, prefix?: string) {
  if (!modelId) return "";
  if (prefix && modelId.startsWith(prefix)) return modelId.slice(prefix.length);
  const parts = modelId.split("/");
  return parts[parts.length - 1] || modelId;
}

function rowColors(row: FreeTrackerModel) {
  const remaining = Math.min(100, Math.max(0, row.remainingPercent ?? 0));
  return { remaining, colors: colors(remaining) };
}

async function load(silent = false) {
  if (!silent) refreshing.value = true;
  try {
    const data = await api.freeTracker.get();
    sources.value = Array.isArray(data.sources) ? data.sources : [];
    fetchedAt.value =
      (data as Record<string, any>).fetchedAt || new Date().toISOString();
    error.value = null;
    countdown.value = Math.round(REFRESH_INTERVAL_MS / 1000);
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : "Failed to load free model quotas";
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

async function togglePublic(sourceId: string, publicVisible: boolean) {
  togglingId.value = sourceId;
  sources.value = sources.value.map((source) =>
    source.id === sourceId ? { ...source, publicVisible } : source,
  );
  try {
    await api.freeTracker.setVisibility(sourceId, publicVisible);
  } catch (err) {
    sources.value = sources.value.map((source) =>
      source.id === sourceId
        ? { ...source, publicVisible: !publicVisible }
        : source,
    );
    error.value =
      err instanceof Error ? err.message : "Failed to update public visibility";
  } finally {
    togglingId.value = null;
  }
}

function stopTimers() {
  if (intervalId) {
    window.clearInterval(intervalId);
    intervalId = undefined;
  }
  if (countdownId) {
    window.clearInterval(countdownId);
    countdownId = undefined;
  }
}

function startTimers() {
  stopTimers();
  countdown.value = Math.round(REFRESH_INTERVAL_MS / 1000);
  intervalId = window.setInterval(() => load(true), REFRESH_INTERVAL_MS);
  countdownId = window.setInterval(() => {
    countdown.value =
      countdown.value <= 1
        ? Math.round(REFRESH_INTERVAL_MS / 1000)
        : countdown.value - 1;
  }, 1000);
}

onMounted(() => {
  const stored = localStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
  if (stored === "false") autoRefresh.value = false;
  if (stored === "true") autoRefresh.value = true;
  hasHydratedAutoRefresh.value = true;
  load();
});

onUnmounted(stopTimers);

const showSkeleton = computed(
  () => loading.value && sources.value.length === 0 && !error.value,
);

function onAutoRefreshChange(value: boolean) {
  autoRefresh.value = value;
  if (hasHydratedAutoRefresh.value)
    localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, String(value));
  if (value) startTimers();
  else stopTimers();
}
</script>

<template>
  <div
    v-if="showSkeleton"
    class="theme-v2 flex flex-col gap-4 px-1 sm:px-0"
    role="status"
    aria-label="Loading free models"
  >
    <Card v-for="index in 2" :key="index" class="space-y-3 p-4">
      <div class="flex items-center gap-2">
        <Skeleton class="size-8 rounded-md" />
        <Skeleton class="h-4 w-40" />
      </div>
      <Skeleton v-for="row in 4" :key="row" class="h-8 w-full" />
    </Card>
  </div>

  <div v-else class="theme-v2 flex min-w-0 flex-col gap-4 px-1 sm:px-0">
    <div
      class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
    >
      <div class="min-w-0">
        <p class="text-sm text-muted-foreground">
          Free model pool status from free sources. Toggle Public to show a card
          on the client portal.
        </p>
        <p
          v-if="fetchedAt && formatFetchedAt(fetchedAt)"
          class="mt-0.5 text-[11px] text-muted-foreground"
        >
          Updated {{ formatFetchedAt(fetchedAt) }}
        </p>
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <button
          type="button"
          class="flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-input px-3 text-xs transition-colors hover:bg-accent"
          :title="autoRefresh ? 'Disable auto-refresh' : 'Enable auto-refresh'"
          @click="onAutoRefreshChange(!autoRefresh)"
        >
          <span
            class="material-symbols-outlined text-[14px]"
            :class="autoRefresh ? 'text-primary' : 'text-muted-foreground'"
          >
            {{ autoRefresh ? "toggle_on" : "toggle_off" }}
          </span>
          <span class="hidden sm:inline">Auto-refresh</span>
          <span
            v-if="autoRefresh"
            class="text-[10px] tabular-nums text-muted-foreground"
            >({{ countdown }}s)</span
          >
        </button>

        <button
          type="button"
          :disabled="refreshing"
          class="flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-input px-3 text-xs transition-colors hover:bg-accent disabled:opacity-50"
          title="Refresh now"
          @click="load()"
        >
          <span
            class="material-symbols-outlined text-[14px]"
            :class="refreshing && 'animate-spin'"
            >refresh</span
          >
          <span class="hidden sm:inline">{{
            refreshing ? "Refreshing..." : "Refresh"
          }}</span>
        </button>
      </div>
    </div>

    <div
      v-if="error"
      class="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {{ error }}
    </div>

    <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <Card v-for="source in sources" :key="source.id" class="min-w-0 p-0">
        <div class="border-b border-border px-3 py-2">
          <div class="flex items-center justify-between gap-2">
            <div class="flex min-w-0 items-center gap-2">
              <div
                class="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-md bg-accent text-[11px] font-bold text-accent-foreground"
              >
                <span>{{
                  (source.name || "FR").slice(0, 2).toUpperCase()
                }}</span>
                <img
                  :src="source.icon || '/providers/inferhub.png'"
                  :alt="source.name"
                  class="absolute inset-0 size-full object-contain"
                  @error="($event.target as HTMLImageElement).remove()"
                />
              </div>
              <div class="min-w-0">
                <h3 class="truncate text-sm font-semibold">
                  {{ source.name }}
                </h3>
                <a
                  v-if="source.sourceUrl"
                  :href="source.sourceUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="block truncate text-[11px] text-muted-foreground hover:text-primary"
                  >{{ source.sourceUrl.replace(/^https?:\/\//, "") }}</a
                >
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <div
                class="flex items-center gap-1.5"
                :title="
                  source.publicVisible === true
                    ? 'Visible on client Free Tracker'
                    : 'Hidden from clients'
                "
              >
                <span
                  class="hidden text-[10px] text-muted-foreground sm:inline"
                  >{{ source.publicVisible ? "Public" : "Private" }}</span
                >
                <Toggle
                  size="sm"
                  :checked="source.publicVisible === true"
                  :disabled="togglingId === source.id || loading"
                  @change="(next: boolean) => togglePublic(source.id, next)"
                />
              </div>
              <button
                type="button"
                :disabled="refreshing || loading"
                class="flex size-9 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent disabled:opacity-50"
                title="Refresh"
                aria-label="Refresh free models"
                @click="load()"
              >
                <span
                  class="material-symbols-outlined text-[18px] text-muted-foreground"
                  :class="(refreshing || loading) && 'animate-spin'"
                  >refresh</span
                >
              </button>
            </div>
          </div>
          <p
            v-if="source.note"
            class="mt-1.5 text-[10px] leading-relaxed text-muted-foreground"
          >
            {{ source.note }}
          </p>
        </div>

        <div class="px-2 py-1.5">
          <div
            v-if="loading && sources.length === 0"
            class="py-5 text-center text-muted-foreground"
          >
            <span class="material-symbols-outlined animate-spin text-[28px]"
              >progress_activity</span
            >
          </div>
          <div
            v-else-if="!source.models?.length"
            class="py-5 text-center text-muted-foreground"
          >
            <p class="text-xs">No free models found</p>
          </div>
          <div v-else class="space-y-1">
            <div class="px-1 text-[10px] text-muted-foreground">
              {{ source.models.length }} model{{
                source.models.length === 1 ? "" : "s"
              }}
            </div>
            <div class="overflow-x-auto">
              <table class="w-full table-fixed text-left">
                <tbody>
                  <tr
                    v-for="row in source.models"
                    :key="row.id"
                    class="border-b border-border/60 last:border-b-0 hover:bg-muted/50"
                  >
                    <td class="w-[34%] px-2.25 py-1.5">
                      <div class="min-w-0">
                        <code
                          class="block truncate text-[11px] font-mono font-medium"
                          :title="row.id"
                          >{{ shortModelLabel(row.id, row.poolPrefix) }}</code
                        >
                        <span
                          class="block truncate text-[10px] text-muted-foreground"
                        >
                          {{ row.poolName
                          }}<span class="text-muted-foreground/70">
                            ·
                            {{
                              row.kind === "shared" ? "Shared" : "Open"
                            }}</span
                          >
                        </span>
                      </div>
                    </td>
                    <td class="w-[46%] px-2.25 py-1.5">
                      <div v-if="row.kind === 'shared'" class="space-y-1">
                        <div
                          class="h-1 overflow-hidden rounded-full"
                          :class="rowColors(row).colors.bgLight"
                        >
                          <div
                            class="h-full transition-all duration-300"
                            :class="rowColors(row).colors.bg"
                            :style="{ width: `${rowColors(row).remaining}%` }"
                          />
                        </div>
                        <div
                          class="flex items-center justify-between text-[10px] text-muted-foreground"
                        >
                          <span class="tabular-nums"
                            >{{ row.usedPercent }}% used</span
                          >
                          <span
                            class="font-medium tabular-nums"
                            :class="rowColors(row).colors.text"
                            >{{ rowColors(row).remaining }}% left</span
                          >
                        </div>
                      </div>
                      <span v-else class="text-[10px] text-muted-foreground"
                        >No meter</span
                      >
                    </td>
                    <td class="w-[20%] px-2.25 py-1.5 text-right">
                      <span
                        v-if="row.kind === 'shared'"
                        class="inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums"
                        :class="rowColors(row).colors.text"
                      >
                        <span class="text-[10px]">{{
                          rowColors(row).colors.emoji
                        }}</span>
                        <span>{{ rowColors(row).remaining }}%</span>
                      </span>
                      <span v-else class="text-[10px] text-muted-foreground"
                        >—</span
                      >
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Card>
    </div>

    <Card v-if="!error && sources.length === 0" class="p-4">
      <p class="text-sm text-muted-foreground">No free sources available.</p>
    </Card>
  </div>
</template>
