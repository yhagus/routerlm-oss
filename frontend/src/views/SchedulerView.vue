<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import Card from "@/components/ui/card.vue";
import Button from "@/components/ui/button.vue";
import { api } from "@/lib/api";

const queryClient = useQueryClient();
const schedulers = useQuery({
  queryKey: ["schedulers"],
  queryFn: api.scheduler.list,
  refetchInterval: 10000,
});

const schedulerList = computed(
  () =>
    (schedulers.data.value || []) as Array<{
      id: string;
      name: string;
      description: string;
      interval: string;
      enabled: boolean;
      history: Array<{
        timestamp: string;
        status: "success" | "failure" | "skipped";
        detail?: string;
        durationMs?: number;
      }>;
    }>,
);

const expandedId = ref<string | null>(null);
const togglingId = ref<string | null>(null);

function toggle(id: string) {
  expandedId.value = expandedId.value === id ? null : id;
}

async function toggleEnabled(id: string, enabled: boolean) {
  if (togglingId.value) return;
  togglingId.value = id;
  try {
    await api.scheduler.toggle(id, enabled);
    await queryClient.invalidateQueries({ queryKey: ["schedulers"] });
  } catch (error) {
    console.error("Failed to toggle scheduler:", error);
  } finally {
    togglingId.value = null;
  }
}

function statusIcon(enabled: boolean) {
  return enabled ? "play_circle" : "pause_circle";
}

function statusColor(enabled: boolean) {
  return enabled ? "text-success" : "text-muted-foreground";
}

function formatTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString();
}

function formatDuration(ms?: number) {
  if (ms === undefined) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusBadgeColor(status: string) {
  if (status === "success") return "bg-success/15 text-success";
  if (status === "failure") return "bg-destructive/15 text-destructive";
  return "bg-muted text-muted-foreground";
}
</script>

<template>
  <div class="theme-v2 space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold">Scheduler</h1>
        <p class="text-sm text-muted-foreground">
          Background job status, configuration, and run history
        </p>
      </div>
    </div>

    <Card v-if="schedulerList.length" class="divide-y divide-border">
      <div
        v-for="scheduler in schedulerList"
        :key="scheduler.id"
        class="cursor-pointer p-5 transition-colors hover:bg-sidebar/50"
        @click="toggle(scheduler.id)"
      >
        <div class="flex items-start justify-between">
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <span
                :class="statusColor(scheduler.enabled)"
                class="material-symbols-outlined text-lg"
              >
                {{ statusIcon(scheduler.enabled) }}
              </span>
              <h3 class="font-medium">{{ scheduler.name }}</h3>
              <span
                v-if="scheduler.history?.length"
                class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
              >
                {{ scheduler.history.length }}
              </span>
            </div>
            <p class="mt-1 text-sm text-muted-foreground">
              {{ scheduler.description }}
            </p>
          </div>
          <div class="flex items-center gap-3">
            <div class="text-right text-sm">
              <div
                :class="
                  scheduler.enabled ? 'text-success' : 'text-muted-foreground'
                "
                class="font-medium"
              >
                {{ scheduler.enabled ? "Enabled" : "Disabled" }}
              </div>
              <div class="text-xs text-muted-foreground">
                Interval: {{ scheduler.interval }}
              </div>
            </div>
            <button
              v-if="scheduler.id !== 'tokenRefresh'"
              class="shrink-0 rounded-full p-1 transition-colors hover:bg-sidebar"
              :class="togglingId === scheduler.id ? 'opacity-50' : ''"
              :disabled="togglingId === scheduler.id"
              :title="scheduler.enabled ? 'Disable' : 'Enable'"
              @click.stop="toggleEnabled(scheduler.id, !scheduler.enabled)"
            >
              <span
                :class="statusColor(scheduler.enabled)"
                class="material-symbols-outlined text-lg"
              >
                {{ scheduler.enabled ? "toggle_on" : "toggle_off" }}
              </span>
            </button>
          </div>
        </div>

        <!-- History panel (expanded) -->
        <div
          v-if="expandedId === scheduler.id && scheduler.history?.length"
          class="mt-4 space-y-2 rounded-lg border border-border bg-background p-4"
        >
          <h4
            class="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Recent runs
          </h4>
          <div class="max-h-64 overflow-y-auto space-y-1">
            <div
              v-for="entry in scheduler.history"
              :key="entry.timestamp"
              class="flex items-center justify-between rounded px-3 py-2 text-xs transition-colors hover:bg-sidebar/30"
            >
              <div class="flex items-center gap-2">
                <span
                  :class="statusBadgeColor(entry.status)"
                  class="rounded-full px-2 py-0.5 text-xs font-medium"
                >
                  {{ entry.status }}
                </span>
                <span class="text-muted-foreground">{{
                  formatTime(entry.timestamp)
                }}</span>
              </div>
              <div class="flex items-center gap-2 text-muted-foreground">
                <span v-if="entry.detail" class="truncate max-w-[200px]">{{
                  entry.detail
                }}</span>
                <span v-if="entry.durationMs" class="text-xs">{{
                  formatDuration(entry.durationMs)
                }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Empty history state -->
        <div
          v-else-if="expandedId === scheduler.id"
          class="mt-4 rounded-lg border border-border bg-background p-4 text-center text-xs text-muted-foreground"
        >
          No runs recorded yet
        </div>
      </div>
    </Card>

    <Card v-else class="p-8 text-center text-muted-foreground">
      Loading scheduler configuration...
    </Card>
  </div>
</template>
